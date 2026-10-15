import * as vscode from 'vscode';
import { DiagnosticManager } from '../diagnostics/diagnosticManager';
import { DiagnosticFinding } from '../parser/types';

export interface PrevalidationResult {
  valid: boolean;
  reason?: string;
  edits: Array<{ uri: vscode.Uri; range: vscode.Range; replacement: string }>;
}

export class BulkFixCoordinator {
  constructor(
    private diagnosticManager: DiagnosticManager,
    private rescanCallback?: (uris: vscode.Uri[]) => Promise<void>
  ) {}

  /**
   * Applies all safe path-casing fixes in a single CODEOWNERS file.
   */
  public async fixAllInFile(uri: vscode.Uri): Promise<boolean> {
    const document = await vscode.workspace.openTextDocument(uri);
    const findings = this.diagnosticManager.getSafeCasingFindingsForUri(uri);

    if (findings.length === 0) {
      vscode.window.showInformationMessage('No safe path-casing issues found in this file.');
      return false;
    }

    // Confirmation dialog
    const fileName = vscode.workspace.asRelativePath(uri);
    const title = `Apply ${findings.length} safe path-casing fix${findings.length > 1 ? 'es' : ''} in ${fileName}?`;
    const message = `${title}\n\nAll edits are prevalidated and applied as a coordinated WorkspaceEdit. If prevalidation fails or the user cancels, no edits are applied.`;

    const choice = await vscode.window.showInformationMessage(
      message,
      { modal: true },
      'Apply Fixes',
      'Cancel'
    );

    if (choice !== 'Apply Fixes') {
      return false;
    }

    // Prevalidate all edits against live document
    const prevalidation = this.prevalidateDocumentEdits(document, findings);
    if (!prevalidation.valid) {
      vscode.window.showWarningMessage(
        `Prevalidation failed: ${prevalidation.reason}. No edits were applied.`
      );
      return false;
    }

    // Coordinated WorkspaceEdit
    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of prevalidation.edits) {
      workspaceEdit.replace(edit.uri, edit.range, edit.replacement);
    }

    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    if (applied && this.rescanCallback) {
      await this.rescanCallback([uri]);
    }

    return applied;
  }

  /**
   * Applies all safe path-casing fixes across all effective CODEOWNERS files in workspace.
   */
  public async fixAllInWorkspace(): Promise<boolean> {
    const findingsByFile = this.diagnosticManager.getAllSafeCasingFindings();
    let totalFixes = 0;
    const affectedUris: vscode.Uri[] = [];

    for (const [uriStr, findings] of findingsByFile.entries()) {
      if (findings.length > 0) {
        totalFixes += findings.length;
        affectedUris.push(vscode.Uri.parse(uriStr));
      }
    }

    if (totalFixes === 0 || affectedUris.length === 0) {
      vscode.window.showInformationMessage('No safe path-casing issues found in the workspace.');
      return false;
    }

    // Build confirmation summary
    const fileCount = affectedUris.length;
    const fileListSummary = affectedUris
      .slice(0, 5)
      .map(u => `• ${vscode.workspace.asRelativePath(u)}`)
      .join('\n');
    const extra = fileCount > 5 ? `\n...and ${fileCount - 5} more file(s)` : '';

    const title = `Apply ${totalFixes} safe path-casing fix${totalFixes > 1 ? 'es' : ''} across ${fileCount} file${fileCount > 1 ? 's' : ''}?`;
    const message = `${title}\n\nAffected files:\n${fileListSummary}${extra}\n\nAll edits are prevalidated and applied as a coordinated WorkspaceEdit. If prevalidation fails or the user cancels, no edits are applied.`;

    const choice = await vscode.window.showInformationMessage(
      message,
      { modal: true },
      'Apply Fixes',
      'Cancel'
    );

    if (choice !== 'Apply Fixes') {
      return false;
    }

    // Prevalidate all edits across all documents
    const allEdits: Array<{ uri: vscode.Uri; range: vscode.Range; replacement: string }> = [];

    for (const uri of affectedUris) {
      const document = await vscode.workspace.openTextDocument(uri);
      const findings = findingsByFile.get(uri.toString()) ?? [];
      const prevalidation = this.prevalidateDocumentEdits(document, findings);

      if (!prevalidation.valid) {
        vscode.window.showWarningMessage(
          `Prevalidation failed in ${vscode.workspace.asRelativePath(uri)}: ${prevalidation.reason}. No edits were applied.`
        );
        return false;
      }

      allEdits.push(...prevalidation.edits);
    }

    // Coordinated WorkspaceEdit across all documents
    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of allEdits) {
      workspaceEdit.replace(edit.uri, edit.range, edit.replacement);
    }

    const applied = await vscode.workspace.applyEdit(workspaceEdit);
    if (applied && this.rescanCallback) {
      await this.rescanCallback(affectedUris);
    }

    return applied;
  }

  /**
   * Prevalidates edits against live document text and checks for overlapping ranges.
   */
  public prevalidateDocumentEdits(
    document: vscode.TextDocument,
    findings: DiagnosticFinding[]
  ): PrevalidationResult {
    const edits: Array<{ uri: vscode.Uri; range: vscode.Range; replacement: string }> = [];

    // Sort findings in reverse document order to prevent coordinate shift issues
    const sorted = [...findings].sort((a, b) => {
      if (a.range.startLine !== b.range.startLine) {
        return b.range.startLine - a.range.startLine;
      }
      return b.range.startCharacter - a.range.startCharacter;
    });

    for (const f of sorted) {
      if (!f.suggestedReplacement || !f.originalPattern) {
        return { valid: false, reason: 'Finding lacks suggested replacement or original pattern', edits: [] };
      }

      const range = new vscode.Range(
        f.range.startLine,
        f.range.startCharacter,
        f.range.endLine,
        f.range.endCharacter
      );

      // Verify that live document text at range strictly matches original pattern
      const liveText = document.getText(range);
      if (liveText !== f.originalPattern) {
        return {
          valid: false,
          reason: `Document text '${liveText}' on line ${f.range.startLine + 1} does not match expected pattern '${f.originalPattern}'`,
          edits: [],
        };
      }

      edits.push({
        uri: document.uri,
        range,
        replacement: f.suggestedReplacement,
      });
    }

    return { valid: true, edits };
  }
}
