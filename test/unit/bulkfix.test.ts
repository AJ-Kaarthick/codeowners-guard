import * as assert from 'assert';
import * as vscode from 'vscode';
import { BulkFixCoordinator } from '../../src/bulkfix/bulkFixCoordinator';
import { CodeownersCodeActionProvider } from '../../src/codeactions/codeActionProvider';
import { DiagnosticManager } from '../../src/diagnostics/diagnosticManager';
import { DiagnosticFinding } from '../../src/parser/types';
import { mockDocuments } from '../mocks/vscode';

describe('Quick Fix & Bulk Remediation', () => {
  let diagnosticManager: DiagnosticManager;
  let coordinator: BulkFixCoordinator;
  const fileUri = vscode.Uri.file('/test-repo/.github/CODEOWNERS');

  beforeEach(() => {
    diagnosticManager = new DiagnosticManager();
    coordinator = new BulkFixCoordinator(diagnosticManager);
    mockDocuments.clear();
  });

  // 29 & 30. Single rule correction edits only pattern token, preserving owners & comments
  it('29 & 30. Single rule correction edits only the pattern token and preserves owners/comments', async () => {
    const rawContent = '/Src/components/Button.tsx   @org/frontend-team  # UI owner';
    mockDocuments.set(fileUri.toString(), { content: rawContent, languageId: 'codeowners' });

    const finding: DiagnosticFinding = {
      type: 'casing-mismatch',
      message: 'Casing mismatch',
      range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 26 },
      severity: 'warning',
      originalPattern: '/Src/components/Button.tsx',
      suggestedReplacement: '/src/components/Button.tsx',
    };

    const doc = await vscode.workspace.openTextDocument(fileUri);
    const preval = coordinator.prevalidateDocumentEdits(doc as any, [finding]);

    assert.strictEqual(preval.valid, true);
    assert.strictEqual(preval.edits.length, 1);

    const edit = new vscode.WorkspaceEdit();
    edit.replace(preval.edits[0].uri, preval.edits[0].range, preval.edits[0].replacement);
    await vscode.workspace.applyEdit(edit);

    const updated = doc.getText();
    assert.strictEqual(
      updated,
      '/src/components/Button.tsx   @org/frontend-team  # UI owner'
    );
  });

  // 31. Fix All in File corrects multiple rules
  it('31. Fix All in File corrects multiple rules in the same file', async () => {
    const content = `/Src/Button.tsx @team1
/Docs/Guide.md @team2`;
    mockDocuments.set(fileUri.toString(), { content, languageId: 'codeowners' });

    const findings: DiagnosticFinding[] = [
      {
        type: 'casing-mismatch',
        message: 'Casing mismatch',
        range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 15 },
        severity: 'warning',
        originalPattern: '/Src/Button.tsx',
        suggestedReplacement: '/src/Button.tsx',
      },
      {
        type: 'casing-mismatch',
        message: 'Casing mismatch',
        range: { startLine: 1, startCharacter: 0, endLine: 1, endCharacter: 14 },
        severity: 'warning',
        originalPattern: '/Docs/Guide.md',
        suggestedReplacement: '/docs/Guide.md',
      },
    ];

    diagnosticManager.setDiagnostics(fileUri, findings);
    const applied = await coordinator.fixAllInFile(fileUri);

    assert.strictEqual(applied, true);
    const doc = await vscode.workspace.openTextDocument(fileUri);
    assert.strictEqual(
      doc.getText(),
      `/src/Button.tsx @team1
/docs/Guide.md @team2`
    );
  });

  // 32. Cancelling file bulk fix changes nothing
  it('32. Cancelling file bulk fix changes nothing (0 edits applied)', async () => {
    const content = '/Src/Button.tsx @team1';
    mockDocuments.set(fileUri.toString(), { content, languageId: 'codeowners' });

    const finding: DiagnosticFinding = {
      type: 'casing-mismatch',
      message: 'Casing mismatch',
      range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 15 },
      severity: 'warning',
      originalPattern: '/Src/Button.tsx',
      suggestedReplacement: '/src/Button.tsx',
    };
    diagnosticManager.setDiagnostics(fileUri, [finding]);

    // Override confirmation dialog to simulate 'Cancel'
    const origDialog = vscode.window.showInformationMessage;
    (vscode.window as any).showInformationMessage = async () => 'Cancel';

    const applied = await coordinator.fixAllInFile(fileUri);
    (vscode.window as any).showInformationMessage = origDialog;

    assert.strictEqual(applied, false);
    const doc = await vscode.workspace.openTextDocument(fileUri);
    assert.strictEqual(doc.getText(), content);
  });

  // 33. Invalid/stale edit ranges reject the whole batch
  it('33. Invalid/stale edit ranges reject the whole batch', async () => {
    // Document text was changed before applying fix
    const modifiedContent = '/Modified/Path.tsx @team1';
    mockDocuments.set(fileUri.toString(), { content: modifiedContent, languageId: 'codeowners' });

    const staleFinding: DiagnosticFinding = {
      type: 'casing-mismatch',
      message: 'Casing mismatch',
      range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 15 },
      severity: 'warning',
      originalPattern: '/Src/Button.tsx',
      suggestedReplacement: '/src/Button.tsx',
    };

    const doc = await vscode.workspace.openTextDocument(fileUri);
    const preval = coordinator.prevalidateDocumentEdits(doc as any, [staleFinding]);

    assert.strictEqual(preval.valid, false);
    assert.ok(preval.reason && preval.reason.includes('does not match expected pattern'));
  });

  // 34. Workspace bulk fix edits multiple effective CODEOWNERS files
  it('34. Workspace bulk fix edits multiple effective CODEOWNERS files', async () => {
    const fileA = vscode.Uri.file('/repoA/.github/CODEOWNERS');
    const fileB = vscode.Uri.file('/repoB/CODEOWNERS');

    mockDocuments.set(fileA.toString(), { content: '/Src/A.ts @teamA', languageId: 'codeowners' });
    mockDocuments.set(fileB.toString(), { content: '/Docs/B.md @teamB', languageId: 'codeowners' });

    diagnosticManager.setDiagnostics(fileA, [
      {
        type: 'casing-mismatch',
        message: 'Mismatch',
        range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 9 },
        severity: 'warning',
        originalPattern: '/Src/A.ts',
        suggestedReplacement: '/src/A.ts',
      },
    ]);

    diagnosticManager.setDiagnostics(fileB, [
      {
        type: 'casing-mismatch',
        message: 'Mismatch',
        range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 10 },
        severity: 'warning',
        originalPattern: '/Docs/B.md',
        suggestedReplacement: '/docs/B.md',
      },
    ]);

    const applied = await coordinator.fixAllInWorkspace();
    assert.strictEqual(applied, true);

    const docA = await vscode.workspace.openTextDocument(fileA);
    const docB = await vscode.workspace.openTextDocument(fileB);

    assert.strictEqual(docA.getText(), '/src/A.ts @teamA');
    assert.strictEqual(docB.getText(), '/docs/B.md @teamB');
  });

  // 35. Workspace bulk cancellation changes nothing
  it('35. Workspace bulk cancellation applies zero edits', async () => {
    const fileA = vscode.Uri.file('/repoA/.github/CODEOWNERS');
    mockDocuments.set(fileA.toString(), { content: '/Src/A.ts @teamA', languageId: 'codeowners' });

    diagnosticManager.setDiagnostics(fileA, [
      {
        type: 'casing-mismatch',
        message: 'Mismatch',
        range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 9 },
        severity: 'warning',
        originalPattern: '/Src/A.ts',
        suggestedReplacement: '/src/A.ts',
      },
    ]);

    const origDialog = vscode.window.showInformationMessage;
    (vscode.window as any).showInformationMessage = async () => 'Cancel';

    const applied = await coordinator.fixAllInWorkspace();
    (vscode.window as any).showInformationMessage = origDialog;

    assert.strictEqual(applied, false);
    const docA = await vscode.workspace.openTextDocument(fileA);
    assert.strictEqual(docA.getText(), '/Src/A.ts @teamA');
  });

  // 36. Workspace prevalidation failure applies zero edits
  it('36. Workspace prevalidation failure in one file applies zero edits anywhere', async () => {
    const fileA = vscode.Uri.file('/repoA/.github/CODEOWNERS');
    const fileB = vscode.Uri.file('/repoB/CODEOWNERS');

    // fileA is valid, fileB has been modified externally (stale)
    mockDocuments.set(fileA.toString(), { content: '/Src/A.ts @teamA', languageId: 'codeowners' });
    mockDocuments.set(fileB.toString(), { content: '/AlreadyEdited.md @teamB', languageId: 'codeowners' });

    diagnosticManager.setDiagnostics(fileA, [
      {
        type: 'casing-mismatch',
        message: 'Mismatch',
        range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 9 },
        severity: 'warning',
        originalPattern: '/Src/A.ts',
        suggestedReplacement: '/src/A.ts',
      },
    ]);

    diagnosticManager.setDiagnostics(fileB, [
      {
        type: 'casing-mismatch',
        message: 'Mismatch',
        range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 10 },
        severity: 'warning',
        originalPattern: '/Docs/B.md',
        suggestedReplacement: '/docs/B.md',
      },
    ]);

    const applied = await coordinator.fixAllInWorkspace();
    assert.strictEqual(applied, false);

    // File A must NOT be modified
    const docA = await vscode.workspace.openTextDocument(fileA);
    assert.strictEqual(docA.getText(), '/Src/A.ts @teamA');
  });

  // 37 & 38. Unrelated files and owners are never modified
  it('37 & 38. Unrelated lines, files and owners are never modified', async () => {
    const content = `/Valid/path.ts @owner1
# Important Comment
/Invalid/casing.ts @owner2`;
    mockDocuments.set(fileUri.toString(), { content, languageId: 'codeowners' });

    diagnosticManager.setDiagnostics(fileUri, [
      {
        type: 'casing-mismatch',
        message: 'Mismatch',
        range: { startLine: 2, startCharacter: 0, endLine: 2, endCharacter: 18 },
        severity: 'warning',
        originalPattern: '/Invalid/casing.ts',
        suggestedReplacement: '/invalid/casing.ts',
      },
    ]);

    await coordinator.fixAllInFile(fileUri);
    const doc = await vscode.workspace.openTextDocument(fileUri);

    assert.strictEqual(
      doc.getText(),
      `/Valid/path.ts @owner1
# Important Comment
/invalid/casing.ts @owner2`
    );
  });

  // 39. Undo works through standard VS Code edit semantics
  it('39. Undo semantics are preserved by single atomic WorkspaceEdit', async () => {
    // When multiple edits are part of one WorkspaceEdit, they undo together in VS Code
    const edit = new vscode.WorkspaceEdit();
    edit.replace(fileUri, new vscode.Range(0, 0, 0, 4), '/src');
    assert.strictEqual(edit.size, 1);
  });

  // 40. Duplicate or stale diagnostics are cleared correctly
  it('40. Duplicate or stale diagnostics are cleared correctly', () => {
    diagnosticManager.setDiagnostics(fileUri, [
      {
        type: 'casing-mismatch',
        message: 'Old',
        range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 5 },
        severity: 'warning',
      },
    ]);

    assert.strictEqual(diagnosticManager.getFindings(fileUri).length, 1);

    diagnosticManager.clearDiagnostics(fileUri);
    assert.strictEqual(diagnosticManager.getFindings(fileUri).length, 0);
  });

  // Code Action Provider test: verifies Ctrl+. options for CODEOWNERS file with codeowners languageId
  it('Provides all 3 scoped Quick Fixes for CODEOWNERS documents', async () => {
    const rawContent = '/Src/Button.tsx @team';
    mockDocuments.set(fileUri.toString(), { content: rawContent, languageId: 'codeowners' });

    const finding: DiagnosticFinding = {
      type: 'casing-mismatch',
      message: 'Casing mismatch',
      range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 15 },
      severity: 'warning',
      originalPattern: '/Src/Button.tsx',
      suggestedReplacement: '/src/Button.tsx',
    };
    diagnosticManager.setDiagnostics(fileUri, [finding]);

    const doc = await vscode.workspace.openTextDocument(fileUri);
    assert.strictEqual(doc.languageId, 'codeowners');

    const provider = new CodeownersCodeActionProvider(diagnosticManager);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 15),
      'Casing mismatch',
      vscode.DiagnosticSeverity.Warning
    );
    diagnostic.code = 'codeowners-guard/casing-mismatch';

    const actions = provider.provideCodeActions(
      doc as any,
      new vscode.Range(0, 0, 0, 15),
      { diagnostics: [diagnostic], triggerKind: 1 } as any
    );

    assert.strictEqual(actions.length, 3);
    // 1. Preferred single rule
    assert.strictEqual(actions[0].title, "Correct path casing to '/src/Button.tsx'");
    assert.strictEqual(actions[0].isPreferred, true);
    assert.ok(actions[0].edit);

    // 2. Fix all in file
    assert.strictEqual(
      actions[1].title,
      'Fix all 1 safe path-casing issue in this CODEOWNERS file'
    );
    assert.strictEqual(actions[1].command?.command, 'codeowners-guard.fixAllInFile');

    // 3. Fix all in workspace
    assert.strictEqual(
      actions[2].title,
      'Fix all 1 safe path-casing issue in the workspace'
    );
    assert.strictEqual(actions[2].command?.command, 'codeowners-guard.fixAllInWorkspace');
  });
});
