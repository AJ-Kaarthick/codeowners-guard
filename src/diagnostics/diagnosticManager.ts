import * as vscode from 'vscode';
import { DiagnosticFinding, FindingSeverity } from '../parser/types';

export const DIAGNOSTIC_SOURCE = 'CODEOWNERS Guard';

export const DIAGNOSTIC_CODES = {
  CASING_MISMATCH: 'codeowners-guard/casing-mismatch',
  UNMATCHED_PATH: 'codeowners-guard/unmatched-path',
  UNSUPPORTED_SYNTAX: 'codeowners-guard/unsupported-syntax',
  OVERRIDDEN_PATTERN: 'codeowners-guard/overridden-pattern',
  INACTIVE_FILE: 'codeowners-guard/inactive-file',
  FILE_TOO_LARGE: 'codeowners-guard/file-too-large',
} as const;

export class DiagnosticManager {
  private collection: vscode.DiagnosticCollection;
  private findingsMap = new Map<string, DiagnosticFinding[]>();

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection('codeowners-guard');
  }

  public setDiagnostics(uri: vscode.Uri, findings: DiagnosticFinding[]): void {
    const key = uri.toString();
    this.findingsMap.set(key, findings);

    const diagnostics: vscode.Diagnostic[] = findings.map(f => {
      const range = new vscode.Range(
        f.range.startLine,
        f.range.startCharacter,
        f.range.endLine,
        f.range.endCharacter
      );

      const severity = this.convertSeverity(f.severity);
      const diagnostic = new vscode.Diagnostic(range, f.message, severity);
      diagnostic.source = DIAGNOSTIC_SOURCE;
      diagnostic.code = this.getDiagnosticCode(f.type);
      return diagnostic;
    });

    this.collection.set(uri, diagnostics);
  }

  public clearDiagnostics(uri: vscode.Uri): void {
    const key = uri.toString();
    this.findingsMap.delete(key);
    this.collection.delete(uri);
  }

  public clearAll(): void {
    this.findingsMap.clear();
    this.collection.clear();
  }

  public getFindings(uri: vscode.Uri): DiagnosticFinding[] {
    return this.findingsMap.get(uri.toString()) ?? [];
  }

  /**
   * Returns all safe, unambiguous casing findings across all tracked files.
   */
  public getAllSafeCasingFindings(): Map<string, DiagnosticFinding[]> {
    const result = new Map<string, DiagnosticFinding[]>();
    for (const [uriStr, findings] of this.findingsMap.entries()) {
      const safe = findings.filter(
        f => f.type === 'casing-mismatch' && !f.isAmbiguous && Boolean(f.suggestedReplacement)
      );
      if (safe.length > 0) {
        result.set(uriStr, safe);
      }
    }
    return result;
  }

  public getSafeCasingFindingsForUri(uri: vscode.Uri): DiagnosticFinding[] {
    const findings = this.findingsMap.get(uri.toString()) ?? [];
    return findings.filter(
      f => f.type === 'casing-mismatch' && !f.isAmbiguous && Boolean(f.suggestedReplacement)
    );
  }

  public dispose(): void {
    this.collection.dispose();
    this.findingsMap.clear();
  }

  private convertSeverity(sev: FindingSeverity): vscode.DiagnosticSeverity {
    switch (sev) {
      case 'error':
        return vscode.DiagnosticSeverity.Error;
      case 'warning':
        return vscode.DiagnosticSeverity.Warning;
      case 'info':
      default:
        return vscode.DiagnosticSeverity.Information;
    }
  }

  private getDiagnosticCode(type: string): string {
    switch (type) {
      case 'casing-mismatch':
        return DIAGNOSTIC_CODES.CASING_MISMATCH;
      case 'unmatched-path':
        return DIAGNOSTIC_CODES.UNMATCHED_PATH;
      case 'unsupported-syntax':
        return DIAGNOSTIC_CODES.UNSUPPORTED_SYNTAX;
      case 'overridden-pattern':
        return DIAGNOSTIC_CODES.OVERRIDDEN_PATTERN;
      case 'inactive-file':
        return DIAGNOSTIC_CODES.INACTIVE_FILE;
      case 'file-too-large':
        return DIAGNOSTIC_CODES.FILE_TOO_LARGE;
      default:
        return 'codeowners-guard/general';
    }
  }
}
