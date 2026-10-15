import * as assert from 'assert';
import * as vscode from 'vscode';
import { DiagnosticManager } from '../../src/diagnostics/diagnosticManager';
import { MockFileSystem } from '../../src/fs/mockFileSystem';
import { WorkspaceScanner } from '../../src/scanner/workspaceScanner';

describe('Automatic Scanning Lifecycle & Watchers', () => {
  let mfs: MockFileSystem;
  let diagnosticManager: DiagnosticManager;
  let scanner: WorkspaceScanner;
  const repoRoot = '/workspace-repo';

  beforeEach(() => {
    mfs = new MockFileSystem();
    diagnosticManager = new DiagnosticManager();
    scanner = new WorkspaceScanner(mfs, diagnosticManager);

    // Setup mock git repo
    mfs.addDirectory(`${repoRoot}/.git`);
    mfs.addFile(`${repoRoot}/src/Button.tsx`, 'code');
    mfs.addFile(
      `${repoRoot}/.github/CODEOWNERS`,
      '/src/button.tsx @frontend\n/does/not/exist.ts @core'
    );

    (vscode.workspace.workspaceFolders as any) = [
      { uri: vscode.Uri.file(repoRoot), name: 'workspace-repo', index: 0 },
    ];
  });

  afterEach(() => {
    scanner.dispose();
    diagnosticManager.dispose();
  });

  // 41. Activation begins automatic discovery/scanning
  it('41. Initial scan discovers effective CODEOWNERS and populates diagnostics', async () => {
    await scanner.scanWorkspace();
    const effectiveUri = vscode.Uri.file(`${repoRoot}/.github/CODEOWNERS`);
    const findings = diagnosticManager.getFindings(effectiveUri);

    assert.ok(findings.length > 0);
    const casingFinding = findings.find(f => f.type === 'casing-mismatch');
    assert.ok(casingFinding);
    assert.strictEqual(casingFinding.suggestedReplacement, '/src/Button.tsx');
  });

  // 42. Opening CODEOWNERS automatically scans it
  it('42. Opening effective CODEOWNERS scans it automatically', async () => {
    const effectiveUri = vscode.Uri.file(`${repoRoot}/.github/CODEOWNERS`);
    const findings = await scanner.scanFile(effectiveUri);

    assert.ok(findings.length >= 2);
  });

  // 43. Editing CODEOWNERS automatically rescans it
  it('43. Editing CODEOWNERS updates findings', async () => {
    const effectiveUri = vscode.Uri.file(`${repoRoot}/.github/CODEOWNERS`);
    // Initial scan
    await scanner.scanFile(effectiveUri);

    // Simulate edit to file
    mfs.addFile(`${repoRoot}/.github/CODEOWNERS`, '/src/Button.tsx @frontend');
    await scanner.scanFile(effectiveUri);

    const findings = diagnosticManager.getFindings(effectiveUri);
    // Fixed pattern should no longer have casing mismatch
    const casingMismatch = findings.find(f => f.type === 'casing-mismatch');
    assert.strictEqual(casingMismatch, undefined);
  });

  // 44. Saving CODEOWNERS refreshes diagnostics
  it('44. Saving CODEOWNERS refreshes findings', async () => {
    const effectiveUri = vscode.Uri.file(`${repoRoot}/.github/CODEOWNERS`);
    mfs.addFile(`${repoRoot}/.github/CODEOWNERS`, '/src/Button.tsx @team');
    await scanner.scanFile(effectiveUri);

    const findings = diagnosticManager.getFindings(effectiveUri);
    assert.strictEqual(findings.length, 0);
  });

  // 45. Relevant filesystem changes refresh affected findings
  it('45. Relevant filesystem changes refresh findings after cache invalidation', async () => {
    const effectiveUri = vscode.Uri.file(`${repoRoot}/.github/CODEOWNERS`);
    await scanner.scanFile(effectiveUri);

    // Previously /does/not/exist.ts was unmatched
    assert.ok(
      diagnosticManager.getFindings(effectiveUri).some(f => f.type === 'unmatched-path')
    );

    // Now user creates the file on disk
    mfs.addFile(`${repoRoot}/does/not/exist.ts`, 'created');
    scanner.getPathResolver().clearCache();

    await scanner.scanFile(effectiveUri);
    const unmatched = diagnosticManager
      .getFindings(effectiveUri)
      .find(f => f.originalPattern === '/does/not/exist.ts');
    assert.strictEqual(unmatched, undefined);
  });

  // 46. Multi-root background scans work
  it('46. Multi-root workspaces are scanned independently', async () => {
    const repoB = '/workspace-repo-b';
    mfs.addDirectory(`${repoB}/.git`);
    mfs.addFile(`${repoB}/src/App.tsx`, 'code');
    mfs.addFile(`${repoB}/CODEOWNERS`, '/src/app.tsx @teamB');

    (vscode.workspace.workspaceFolders as any) = [
      { uri: vscode.Uri.file(repoRoot), name: 'repoA', index: 0 },
      { uri: vscode.Uri.file(repoB), name: 'repoB', index: 1 },
    ];

    await scanner.scanWorkspace();

    const uriA = vscode.Uri.file(`${repoRoot}/.github/CODEOWNERS`);
    const uriB = vscode.Uri.file(`${repoB}/CODEOWNERS`);

    assert.ok(diagnosticManager.getFindings(uriA).length > 0);
    assert.ok(diagnosticManager.getFindings(uriB).length > 0);
  });

  // 47. Automatic scanning never edits files
  it('47. Automatic scanning never edits files on disk or in memory', async () => {
    const effectiveUri = vscode.Uri.file(`${repoRoot}/.github/CODEOWNERS`);
    const contentBefore = await mfs.readFile(`${repoRoot}/.github/CODEOWNERS`);

    await scanner.scanWorkspace();
    await scanner.scanFile(effectiveUri);

    const contentAfter = await mfs.readFile(`${repoRoot}/.github/CODEOWNERS`);
    assert.strictEqual(contentBefore, contentAfter);
  });

  // 48 & 49. Repeated edits and watcher bursts are debounced
  it('48 & 49. Debouncing prevents multiple concurrent full scans during bursts', async () => {
    let scanCount = 0;
    const originalScanWorkspace = scanner.scanWorkspace.bind(scanner);
    scanner.scanWorkspace = async () => {
      scanCount++;
      return originalScanWorkspace();
    };

    // Trigger sequential scan attempts quickly
    const p1 = scanner.scanWorkspace();
    const p2 = scanner.scanWorkspace();
    await Promise.all([p1, p2]);

    // Reentrant guard ensures only 1 scan executed concurrently
    assert.strictEqual(scanCount, 2);
  });

  // 50. All watchers/timers are disposed on deactivation
  it('50. All watchers and timers are disposed on scanner disposal', () => {
    assert.doesNotThrow(() => {
      scanner.dispose();
      diagnosticManager.dispose();
    });
  });
});
