import * as vscode from 'vscode';
import { BulkFixCoordinator } from './bulkfix/bulkFixCoordinator';
import { CodeownersCodeActionProvider } from './codeactions/codeActionProvider';
import { registerCommands } from './commands/commandRegistry';
import { DiagnosticManager } from './diagnostics/diagnosticManager';
import { NodeFileSystem } from './fs/nodeFileSystem';
import { WorkspaceScanner } from './scanner/workspaceScanner';

let scanner: WorkspaceScanner | null = null;
let diagnosticManager: DiagnosticManager | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const fs = new NodeFileSystem();
  diagnosticManager = new DiagnosticManager();
  scanner = new WorkspaceScanner(fs, diagnosticManager);

  const bulkFixer = new BulkFixCoordinator(diagnosticManager, async (uris: vscode.Uri[]) => {
    for (const u of uris) {
      await scanner?.scanFile(u);
    }
  });

  // Register Code Action Provider for CODEOWNERS files
  const documentSelector: vscode.DocumentSelector = [
    { language: 'codeowners' },
    { pattern: '**/CODEOWNERS' },
    { pattern: '**/.github/CODEOWNERS' },
    { pattern: '**/docs/CODEOWNERS' },
  ];

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      documentSelector,
      new CodeownersCodeActionProvider(diagnosticManager),
      {
        providedCodeActionKinds: CodeownersCodeActionProvider.providedCodeActionKinds,
      }
    )
  );

  // Register fallback commands
  registerCommands(context, scanner, bulkFixer);

  // Add diagnostic manager and scanner to subscriptions for cleanup on deactivation
  context.subscriptions.push(diagnosticManager);
  context.subscriptions.push(scanner);

  // Kick off initial automatic discovery and scan
  await scanner.initialize();
}

export function deactivate(): void {
  if (scanner) {
    scanner.dispose();
    scanner = null;
  }
  if (diagnosticManager) {
    diagnosticManager.dispose();
    diagnosticManager = null;
  }
}
