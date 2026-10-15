import * as vscode from 'vscode';
import { DIAGNOSTIC_CODES, DiagnosticManager } from '../diagnostics/diagnosticManager';

export class CodeownersCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  constructor(private diagnosticManager: DiagnosticManager) {}

  public provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    // Filter diagnostics relevant to casing mismatch
    const casingDiagnostics = context.diagnostics.filter(
      d => d.code === DIAGNOSTIC_CODES.CASING_MISMATCH
    );

    if (casingDiagnostics.length === 0) {
      return actions;
    }

    // Get findings for current document
    const fileFindings = this.diagnosticManager.getSafeCasingFindingsForUri(document.uri);
    const allFindingsMap = this.diagnosticManager.getAllSafeCasingFindings();

    let workspaceSafeCount = 0;
    for (const findings of allFindingsMap.values()) {
      workspaceSafeCount += findings.length;
    }

    const fileSafeCount = fileFindings.length;

    // For each casing diagnostic intersecting the requested range:
    for (const diagnostic of casingDiagnostics) {
      const finding = fileFindings.find(
        f =>
          f.range.startLine === diagnostic.range.start.line &&
          f.range.startCharacter === diagnostic.range.start.character
      );

      // Only offer fixes if finding is unambiguous and has a replacement
      if (!finding || finding.isAmbiguous || !finding.suggestedReplacement) {
        continue;
      }

      // 1. Single rule fix (Preferred)
      // Live prevalidation: ensure document at range still matches original pattern
      const currentText = document.getText(diagnostic.range);
      if (currentText === finding.originalPattern) {
        const singleFix = new vscode.CodeAction(
          `Correct path casing to '${finding.suggestedReplacement}'`,
          vscode.CodeActionKind.QuickFix
        );
        singleFix.isPreferred = true;
        singleFix.diagnostics = [diagnostic];

        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, diagnostic.range, finding.suggestedReplacement);
        singleFix.edit = edit;

        actions.push(singleFix);
      }

      // 2. Fix all in current file
      const fileFix = new vscode.CodeAction(
        `Fix all ${fileSafeCount} safe path-casing issue${fileSafeCount > 1 ? 's' : ''} in this CODEOWNERS file`,
        vscode.CodeActionKind.QuickFix
      );
      fileFix.command = {
        command: 'codeowners-guard.fixAllInFile',
        title: 'Fix all safe issues in file',
        arguments: [document.uri],
      };
      fileFix.diagnostics = [diagnostic];
      actions.push(fileFix);

      // 3. Fix all in workspace
      const workspaceFix = new vscode.CodeAction(
        `Fix all ${workspaceSafeCount} safe path-casing issue${workspaceSafeCount > 1 ? 's' : ''} in the workspace`,
        vscode.CodeActionKind.QuickFix
      );
      workspaceFix.command = {
        command: 'codeowners-guard.fixAllInWorkspace',
        title: 'Fix all safe issues in workspace',
      };
      workspaceFix.diagnostics = [diagnostic];
      actions.push(workspaceFix);

      // We only emit the batch actions once per selection
      break;
    }

    return actions;
  }
}
