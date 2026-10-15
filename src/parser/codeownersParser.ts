import {
  CodeownersLine,
  CommentToken,
  DiagnosticFinding,
  OwnerKind,
  OwnerToken,
  ParsedCodeownersFile,
  PatternToken,
  SourceRange,
} from './types';

/**
 * Deterministic parser for GitHub CODEOWNERS files.
 * Preserves exact token ranges, formatting, owners, and comments.
 */
export class CodeownersParser {
  public parse(content: string): ParsedCodeownersFile {
    const lines = content.split(/\r?\n/);
    const parsedLines: CodeownersLine[] = [];
    const rules: CodeownersLine[] = [];
    const findings: DiagnosticFinding[] = [];

    // Map of patternText -> array of rule lines that defined it
    const patternHistory = new Map<string, CodeownersLine[]>();

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const raw = lines[lineIndex];
      const parsedLine = this.parseLine(raw, lineIndex);
      parsedLines.push(parsedLine);

      if (parsedLine.kind === 'rule' && parsedLine.patternToken) {
        rules.push(parsedLine);
        const token = parsedLine.patternToken;

        // Unsupported syntax checks
        if (token.hasNegation) {
          findings.push({
            type: 'unsupported-syntax',
            message: "GitHub CODEOWNERS does not support '!' negation syntax. GitHub may ignore this pattern.",
            range: token.range,
            severity: 'warning',
            originalPattern: token.text,
            ruleLineNumber: lineIndex,
          });
        }

        if (token.hasCharRange) {
          findings.push({
            type: 'unsupported-syntax',
            message: "GitHub CODEOWNERS does not support '[ ]' character range syntax. GitHub may ignore this pattern.",
            range: token.range,
            severity: 'warning',
            originalPattern: token.text,
            ruleLineNumber: lineIndex,
          });
        }

        if (token.hasEscapedLeadingHash) {
          findings.push({
            type: 'unsupported-syntax',
            message: "GitHub CODEOWNERS does not support patterns starting with '\\#'. Escaping a leading '#' does not make it a valid path pattern, and GitHub may ignore this rule.",
            range: token.range,
            severity: 'warning',
            originalPattern: token.text,
            ruleLineNumber: lineIndex,
          });
        }

        // Track pattern occurrences for duplicate/overridden analysis
        const existing = patternHistory.get(token.text);
        if (existing) {
          existing.push(parsedLine);
        } else {
          patternHistory.set(token.text, [parsedLine]);
        }
      }
    }

    // Detect exact duplicate / overridden patterns
    for (const [patternText, ruleGroup] of patternHistory.entries()) {
      if (ruleGroup.length > 1) {
        // Every rule except the last one is overridden
        for (let i = 0; i < ruleGroup.length - 1; i++) {
          const earlierRule = ruleGroup[i];
          const lastRule = ruleGroup[ruleGroup.length - 1];
          if (earlierRule.patternToken) {
            findings.push({
              type: 'overridden-pattern',
              message: `Pattern '${patternText}' is overridden by an exact duplicate rule on line ${lastRule.lineNumber + 1}. CODEOWNERS uses the last matching pattern.`,
              range: earlierRule.patternToken.range,
              severity: 'info',
              originalPattern: patternText,
              ruleLineNumber: earlierRule.lineNumber,
              overriddenByLineNumber: lastRule.lineNumber,
            });
          }
        }
      }
    }

    return {
      lines: parsedLines,
      rules,
      findings,
    };
  }

  private parseLine(raw: string, lineNumber: number): CodeownersLine {
    // 1. Check for empty or purely whitespace line
    if (/^\s*$/.test(raw)) {
      return {
        lineNumber,
        raw,
        kind: 'empty',
        owners: [],
      };
    }

    // 2. Check for full line comment
    const trimmedStart = raw.search(/\S/);
    if (trimmedStart !== -1 && raw[trimmedStart] === '#') {
      return {
        lineNumber,
        raw,
        kind: 'comment',
        owners: [],
        inlineComment: {
          text: raw.substring(trimmedStart),
          range: {
            startLine: lineNumber,
            startCharacter: trimmedStart,
            endLine: lineNumber,
            endCharacter: raw.length,
          },
        },
      };
    }

    // 3. Parse tokens for rule: pattern, owners, inline comment
    let index = 0;
    const len = raw.length;

    // Skip leading whitespace
    while (index < len && /\s/.test(raw[index])) {
      index++;
    }

    // Parse pattern token (supports escaped spaces '\ ' and escaped hashes '\#')
    const patternStart = index;
    let patternText = '';
    while (index < len) {
      if (raw[index] === '\\' && index + 1 < len) {
        patternText += raw[index] + raw[index + 1];
        index += 2;
        continue;
      }
      if (/\s/.test(raw[index])) {
        break;
      }
      patternText += raw[index];
      index++;
    }

    const patternRange: SourceRange = {
      startLine: lineNumber,
      startCharacter: patternStart,
      endLine: lineNumber,
      endCharacter: index,
    };

    const hasNegation = patternText.startsWith('!');
    const hasCharRange = /\[.+\]/.test(patternText.replace(/\\\[|\\\]/g, ''));
    const hasEscapedLeadingHash = patternText.startsWith('\\#');

    const patternToken: PatternToken = {
      text: patternText,
      range: patternRange,
      hasNegation,
      hasCharRange,
      hasEscapedLeadingHash,
    };

    // Parse owners and inline comment
    const owners: OwnerToken[] = [];
    let inlineComment: CommentToken | undefined;

    while (index < len) {
      // Skip whitespace
      while (index < len && /\s/.test(raw[index])) {
        index++;
      }
      if (index >= len) {
        break;
      }

      // Check if this token starts a comment
      if (raw[index] === '#') {
        inlineComment = {
          text: raw.substring(index),
          range: {
            startLine: lineNumber,
            startCharacter: index,
            endLine: lineNumber,
            endCharacter: len,
          },
        };
        break;
      }

      // Read owner token
      const ownerStart = index;
      let ownerText = '';
      while (index < len) {
        if (raw[index] === '\\' && index + 1 < len) {
          ownerText += raw[index] + raw[index + 1];
          index += 2;
          continue;
        }
        if (/\s/.test(raw[index])) {
          break;
        }
        ownerText += raw[index];
        index++;
      }

      let kind: OwnerKind = 'invalid';
      if (ownerText.startsWith('@')) {
        kind = ownerText.includes('/') ? 'team' : 'user';
      } else if (ownerText.includes('@')) {
        kind = 'email';
      }

      owners.push({
        text: ownerText,
        range: {
          startLine: lineNumber,
          startCharacter: ownerStart,
          endLine: lineNumber,
          endCharacter: index,
        },
        kind,
      });
    }

    return {
      lineNumber,
      raw,
      kind: 'rule',
      patternToken,
      owners,
      inlineComment,
    };
  }
}
