export interface SourceRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

export type CodeownersLineKind = 'empty' | 'comment' | 'rule';

export type OwnerKind = 'user' | 'team' | 'email' | 'invalid';

export interface PatternToken {
  text: string;
  range: SourceRange;
  hasNegation: boolean;
  hasCharRange: boolean;
  hasEscapedLeadingHash: boolean;
}

export interface OwnerToken {
  text: string;
  range: SourceRange;
  kind: OwnerKind;
}

export interface CommentToken {
  text: string;
  range: SourceRange;
}

export interface CodeownersLine {
  lineNumber: number;
  raw: string;
  kind: CodeownersLineKind;
  patternToken?: PatternToken;
  owners: OwnerToken[];
  inlineComment?: CommentToken;
}

export type FindingSeverity = 'error' | 'warning' | 'info';

export type FindingType =
  | 'casing-mismatch'
  | 'unmatched-path'
  | 'unsupported-syntax'
  | 'overridden-pattern'
  | 'inactive-file'
  | 'file-too-large';

export interface DiagnosticFinding {
  type: FindingType;
  message: string;
  range: SourceRange;
  severity: FindingSeverity;
  originalPattern?: string;
  suggestedReplacement?: string;
  ruleLineNumber?: number;
  overriddenByLineNumber?: number;
  isAmbiguous?: boolean;
}

export interface ParsedCodeownersFile {
  lines: CodeownersLine[];
  rules: CodeownersLine[];
  findings: DiagnosticFinding[];
}
