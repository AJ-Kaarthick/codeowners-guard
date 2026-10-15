import * as path from 'path';
import { IFileSystem } from '../fs/fileSystem';
import { DiagnosticFinding } from '../parser/types';

export const MAX_CODEOWNERS_FILE_SIZE = 3 * 1024 * 1024; // 3 MB

export interface CodeownersDiscoveryResult {
  repoRoot: string;
  effectiveFilePath: string | null;
  inactiveFilePaths: string[];
  allFound: string[];
  fileTooLarge: boolean;
  findings: DiagnosticFinding[];
}

export class PrecedenceManager {
  constructor(private fs: IFileSystem) {}

  /**
   * Relative candidate locations in GitHub precedence order.
   */
  public static readonly CANDIDATES = [
    path.join('.github', 'CODEOWNERS'),
    'CODEOWNERS',
    path.join('docs', 'CODEOWNERS'),
  ];

  /**
   * Discovers the effective and inactive CODEOWNERS files for a repository root.
   */
  public async discover(repoRoot: string): Promise<CodeownersDiscoveryResult> {
    const existing: string[] = [];

    for (const rel of PrecedenceManager.CANDIDATES) {
      const fullPath = path.join(repoRoot, rel);
      const stat = await this.fs.stat(fullPath);
      if (stat && stat.isFile) {
        existing.push(fullPath);
      }
    }

    if (existing.length === 0) {
      return {
        repoRoot,
        effectiveFilePath: null,
        inactiveFilePaths: [],
        allFound: [],
        fileTooLarge: false,
        findings: [],
      };
    }

    const effectiveFilePath = existing[0];
    const inactiveFilePaths = existing.slice(1);
    const findings: DiagnosticFinding[] = [];

    // Check size limit of effective file
    const effectiveStat = await this.fs.stat(effectiveFilePath);
    let fileTooLarge = false;
    if (effectiveStat && effectiveStat.size >= MAX_CODEOWNERS_FILE_SIZE) {
      fileTooLarge = true;
      findings.push({
        type: 'file-too-large',
        message: `CODEOWNERS file exceeds GitHub's 3 MB size limit (${(effectiveStat.size / (1024 * 1024)).toFixed(2)} MB). Automatic validation is skipped.`,
        range: {
          startLine: 0,
          startCharacter: 0,
          endLine: 0,
          endCharacter: 0,
        },
        severity: 'info',
      });
    }

    return {
      repoRoot,
      effectiveFilePath,
      inactiveFilePaths,
      allFound: existing,
      fileTooLarge,
      findings,
    };
  }

  /**
   * Checks if a given file path is the effective CODEOWNERS file for its repo.
   */
  public async isEffective(filePath: string, repoRoot: string): Promise<{
    isEffective: boolean;
    effectivePath: string | null;
    reason?: string;
  }> {
    const discovery = await this.discover(repoRoot);
    if (!discovery.effectiveFilePath) {
      return { isEffective: false, effectivePath: null };
    }

    const normalizedTarget = path.resolve(filePath);
    const normalizedEffective = path.resolve(discovery.effectiveFilePath);

    if (normalizedTarget === normalizedEffective) {
      return { isEffective: true, effectivePath: discovery.effectiveFilePath };
    }

    const relEffective = path.relative(repoRoot, discovery.effectiveFilePath);
    return {
      isEffective: false,
      effectivePath: discovery.effectiveFilePath,
      reason: `This CODEOWNERS file is inactive because a higher-precedence file exists at '${relEffective}'.`,
    };
  }
}
