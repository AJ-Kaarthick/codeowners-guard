import * as path from 'path';
import { DirEntry, IFileSystem } from '../fs/fileSystem';
import { DiagnosticFinding, PatternToken } from '../parser/types';
import { ExclusionsMatcher } from './exclusions';

export interface ResolveOptions {
  repoRoot: string;
  token: PatternToken;
  exclusions?: ExclusionsMatcher;
}

export class PathResolver {
  private dirCache = new Map<string, DirEntry[]>();

  constructor(private fs: IFileSystem) {}

  public clearCache(dirPath?: string): void {
    if (dirPath) {
      this.dirCache.delete(path.resolve(dirPath));
    } else {
      this.dirCache.clear();
    }
  }

  private async getEntries(dir: string): Promise<DirEntry[]> {
    const resolved = path.resolve(dir);
    let entries = this.dirCache.get(resolved);
    if (!entries) {
      entries = await this.fs.readDir(resolved);
      this.dirCache.set(resolved, entries);
    }
    return entries;
  }

  /**
   * Resolves a CODEOWNERS pattern against the filesystem.
   * Emits casing mismatch or unmatched path findings when provable.
   */
  public async resolvePattern(options: ResolveOptions): Promise<DiagnosticFinding | null> {
    const { repoRoot, token, exclusions } = options;
    const rawPattern = token.text;

    // GitHub CODEOWNERS unsupported patterns: handled by parser
    if (token.hasNegation || token.hasCharRange || token.hasEscapedLeadingHash) {
      return null;
    }

    const hasLeadingSlash = rawPattern.startsWith('/');
    const hasTrailingSlash = rawPattern.endsWith('/') && rawPattern.length > 1;

    // Check if pattern contains wildcard characters
    const hasWildcard = rawPattern.includes('*') || rawPattern.includes('?');

    // Split pattern into segments
    // Clean leading and trailing slashes for segment processing
    const cleanPattern = rawPattern.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!cleanPattern) {
      return null;
    }

    const segments = cleanPattern.split('/');

    // Check exclusions on the pattern
    if (exclusions && exclusions.isExcluded(cleanPattern)) {
      return null;
    }

    // Git / GitHub CODEOWNERS pattern anchoring rule:
    // A pattern is relative to the repository root if it has a leading slash OR an internal slash,
    // unless it begins with recursive wildcard '**/'
    const isRecursiveWildcard = rawPattern.startsWith('**/');
    const hasInternalSlash = segments.length > 1;
    const isRootRelative = (hasLeadingSlash || hasInternalSlash) && !isRecursiveWildcard;

    if (hasWildcard) {
      return this.resolveWildcardPattern(
        repoRoot,
        token,
        segments,
        hasLeadingSlash,
        hasTrailingSlash,
        isRootRelative,
        exclusions
      );
    } else {
      return this.resolveLiteralPattern(
        repoRoot,
        token,
        segments,
        hasLeadingSlash,
        hasTrailingSlash,
        isRootRelative
      );
    }
  }

  /**
   * Resolves a fully literal pattern (no * or ?).
   */
  private async resolveLiteralPattern(
    repoRoot: string,
    token: PatternToken,
    segments: string[],
    hasLeadingSlash: boolean,
    hasTrailingSlash: boolean,
    isRootRelative: boolean
  ): Promise<DiagnosticFinding | null> {
    if (!isRootRelative) {
      // Multi-depth pattern without internal slash: e.g. 'Header.tsx' or 'components/'
      return this.resolveMultiDepthPattern(repoRoot, token, segments[0], hasTrailingSlash);
    }

    // Root-relative pattern: e.g. '/src/components/Header.tsx' or 'src/components/Header.tsx'
    const visitedDirs = new Set<string>();
    let currentDir = repoRoot;
    visitedDirs.add(path.resolve(currentDir));

    const correctedSegments: string[] = [];
    let hasCasingDifference = false;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const entries = await this.getEntries(currentDir);

      // Exact match check
      const exactMatch = entries.find(e => e.name === seg);
      if (exactMatch) {
        correctedSegments.push(exactMatch.name);
        currentDir = path.join(currentDir, exactMatch.name);
        if (exactMatch.isDirectory) {
          const resolvedCurrent = path.resolve(currentDir);
          if (visitedDirs.has(resolvedCurrent)) {
            // Symlink loop detected, abort safely
            return null;
          }
          visitedDirs.add(resolvedCurrent);
        }
        continue;
      }

      // Case-insensitive candidate check
      const caseCandidates = entries.filter(e => e.name.toLowerCase() === seg.toLowerCase());

      if (caseCandidates.length === 1) {
        const candidate = caseCandidates[0];
        correctedSegments.push(candidate.name);
        hasCasingDifference = true;
        currentDir = path.join(currentDir, candidate.name);
        if (candidate.isDirectory) {
          const resolvedCurrent = path.resolve(currentDir);
          if (visitedDirs.has(resolvedCurrent)) {
            return null;
          }
          visitedDirs.add(resolvedCurrent);
        }
      } else if (caseCandidates.length > 1) {
        // Ambiguous match (e.g. both 'foo' and 'Foo' exist)
        return {
          type: 'casing-mismatch',
          message: `CODEOWNERS path casing for '${seg}' is ambiguous: multiple matching entries exist on disk.`,
          range: token.range,
          severity: 'warning',
          originalPattern: token.text,
          isAmbiguous: true,
        };
      } else {
        // Segment does not exist on disk relative to repo root
        return {
          type: 'unmatched-path',
          message: `Literal path '${token.text}' matches no workspace path.`,
          range: token.range,
          severity: 'warning',
          originalPattern: token.text,
        };
      }
    }

    if (hasCasingDifference) {
      let replacement = correctedSegments.join('/');
      if (hasLeadingSlash) {
        replacement = '/' + replacement;
      }
      if (hasTrailingSlash) {
        replacement = replacement + '/';
      }

      // Suppress no-op correction
      if (replacement === token.text) {
        return null;
      }

      return {
        type: 'casing-mismatch',
        message: 'CODEOWNERS path casing does not match the filesystem.',
        range: token.range,
        severity: 'warning',
        originalPattern: token.text,
        suggestedReplacement: replacement,
      };
    }

    return null;
  }

  /**
   * Resolves a multi-depth pattern with no internal slash (e.g. 'Header.tsx' or 'components/').
   * Matches across any depth in the workspace according to Git/GitHub CODEOWNERS semantics.
   */
  private async resolveMultiDepthPattern(
    repoRoot: string,
    token: PatternToken,
    targetName: string,
    isDirectoryOnly: boolean
  ): Promise<DiagnosticFinding | null> {
    const candidates = new Set<string>();
    const lowerTarget = targetName.toLowerCase();

    const queue: string[] = [repoRoot];
    const visited = new Set<string>();
    let isExhaustive = true;

    while (queue.length > 0) {
      if (visited.size >= 500) {
        isExhaustive = false;
        break;
      }

      const dir = queue.shift()!;
      const resolved = path.resolve(dir);
      if (visited.has(resolved)) {
        continue;
      }
      visited.add(resolved);

      const entries = await this.getEntries(dir);
      for (const entry of entries) {
        if (entry.isDirectory) {
          queue.push(path.join(dir, entry.name));
        }

        if (entry.name.toLowerCase() === lowerTarget) {
          if (!isDirectoryOnly || entry.isDirectory) {
            candidates.add(entry.name);
          }
        }
      }
    }

    if (candidates.size === 1) {
      const foundName = Array.from(candidates)[0];
      if (foundName !== targetName) {
        // If search was non-exhaustive, we cannot be certain no other casings exist
        if (!isExhaustive) {
          return {
            type: 'casing-mismatch',
            message: `CODEOWNERS path casing for '${token.text}' may not match disk casing '${foundName}', but workspace search was non-exhaustive. Automatic fix is suppressed.`,
            range: token.range,
            severity: 'warning',
            originalPattern: token.text,
            isAmbiguous: true,
          };
        }

        const replacement = isDirectoryOnly ? `${foundName}/` : foundName;
        return {
          type: 'casing-mismatch',
          message: 'CODEOWNERS path casing does not match the filesystem.',
          range: token.range,
          severity: 'warning',
          originalPattern: token.text,
          suggestedReplacement: replacement,
        };
      }
      // Exact casing match found across all matching occurrences
      return null;
    } else if (candidates.size > 1) {
      // Conflicting or coexisting casings found across workspace
      const candidateList = Array.from(candidates).map(c => isDirectoryOnly ? `${c}/` : c);
      const hasExactMatch = candidates.has(targetName);
      const explanation = hasExactMatch
        ? `Paths matching '${token.text}' coexist with differing casings in the workspace (${candidateList.map(c => `'${c}'`).join(', ')}). Automatic fix is suppressed to avoid altering ownership semantics.`
        : `Multiple paths matching '${token.text}' exist in the workspace with differing casings (${candidateList.map(c => `'${c}'`).join(', ')}). Automatic fix is suppressed due to ambiguity.`;

      return {
        type: 'casing-mismatch',
        message: explanation,
        range: token.range,
        severity: 'warning',
        originalPattern: token.text,
        isAmbiguous: true,
      };
    }

    if (isExhaustive) {
      return {
        type: 'unmatched-path',
        message: `Literal path '${token.text}' matches no workspace path.`,
        range: token.range,
        severity: 'warning',
        originalPattern: token.text,
      };
    }

    // Inconclusive search (hit directory cap): suppress finding
    return null;
  }

  /**
   * Resolves a pattern containing wildcards (* or ?).
   * Only validates and corrects the provable literal prefix.
   */
  private async resolveWildcardPattern(
    repoRoot: string,
    token: PatternToken,
    segments: string[],
    hasLeadingSlash: boolean,
    hasTrailingSlash: boolean,
    isRootRelative: boolean,
    _exclusions?: ExclusionsMatcher
  ): Promise<DiagnosticFinding | null> {
    // If not root-relative (e.g. starts with '**/'), preserve recursive glob semantics without guessing
    if (!isRootRelative) {
      return null;
    }

    // Find index of first wildcard segment
    const firstWildcardIndex = segments.findIndex(s => s.includes('*') || s.includes('?'));
    if (firstWildcardIndex <= 0) {
      // Wildcard in the very first segment (e.g. *.ts or /*.ts): no literal directory prefix to validate
      return null;
    }

    // Literal prefix segments before the wildcard
    const literalSegments = segments.slice(0, firstWildcardIndex);
    const wildcardSegments = segments.slice(firstWildcardIndex);

    let currentDir = repoRoot;
    const correctedLiteralSegments: string[] = [];
    let hasCasingDifference = false;
    const visitedDirs = new Set<string>();
    visitedDirs.add(path.resolve(currentDir));

    for (const seg of literalSegments) {
      const entries = await this.getEntries(currentDir);
      const exactMatch = entries.find(e => e.name === seg);

      if (exactMatch) {
        correctedLiteralSegments.push(exactMatch.name);
        currentDir = path.join(currentDir, exactMatch.name);
        if (exactMatch.isDirectory) {
          const resolved = path.resolve(currentDir);
          if (visitedDirs.has(resolved)) {
            return null;
          }
          visitedDirs.add(resolved);
        }
        continue;
      }

      const caseCandidates = entries.filter(e => e.name.toLowerCase() === seg.toLowerCase());
      if (caseCandidates.length === 1) {
        const candidate = caseCandidates[0];
        correctedLiteralSegments.push(candidate.name);
        hasCasingDifference = true;
        currentDir = path.join(currentDir, candidate.name);
        if (candidate.isDirectory) {
          const resolved = path.resolve(currentDir);
          if (visitedDirs.has(resolved)) {
            return null;
          }
          visitedDirs.add(resolved);
        }
      } else if (caseCandidates.length > 1) {
        // Ambiguous literal prefix: suppress fix
        return {
          type: 'casing-mismatch',
          message: `CODEOWNERS path prefix casing for '${seg}' is ambiguous.`,
          range: token.range,
          severity: 'warning',
          originalPattern: token.text,
          isAmbiguous: true,
        };
      } else {
        // Prefix directory does not exist relative to root
        return {
          type: 'unmatched-path',
          message: `Literal path prefix for '${token.text}' matches no workspace directory.`,
          range: token.range,
          severity: 'warning',
          originalPattern: token.text,
        };
      }
    }

    if (hasCasingDifference) {
      // Reassemble with literal prefix corrected and wildcards untouched
      const fullSegments = [...correctedLiteralSegments, ...wildcardSegments];
      let replacement = fullSegments.join('/');
      if (hasLeadingSlash) {
        replacement = '/' + replacement;
      }
      if (hasTrailingSlash) {
        replacement = replacement + '/';
      }

      if (replacement === token.text) {
        return null;
      }

      return {
        type: 'casing-mismatch',
        message: 'CODEOWNERS path casing does not match the filesystem.',
        range: token.range,
        severity: 'warning',
        originalPattern: token.text,
        suggestedReplacement: replacement,
      };
    }

    return null;
  }
}
