import * as path from 'path';
import * as vscode from 'vscode';
import { BulkFixCoordinator } from '../bulkfix/bulkFixCoordinator';
import { WorkspaceScanner } from '../scanner/workspaceScanner';

export function registerCommands(
  context: vscode.ExtensionContext,
  scanner: WorkspaceScanner,
  bulkFixer: BulkFixCoordinator
): void {
  // 1. Scan Current File
  context.subscriptions.push(
    vscode.commands.registerCommand('codeowners-guard.scanCurrentFile', async (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;

      if (!targetUri) {
        vscode.window.showInformationMessage('No active editor found to scan.');
        return;
      }

      const fileName = path.basename(targetUri.fsPath);
      const isCodeowners =
        fileName === 'CODEOWNERS' ||
        vscode.window.activeTextEditor?.document.languageId === 'codeowners';

      if (!isCodeowners) {
        vscode.window.showInformationMessage(
          `Current file '${fileName}' is not a CODEOWNERS file.`
        );
        return;
      }

      await scanner.scanFile(targetUri);
      vscode.window.showInformationMessage(`CODEOWNERS Guard: Scanned ${fileName}`);
    })
  );

  // 2. Scan Workspace
  context.subscriptions.push(
    vscode.commands.registerCommand('codeowners-guard.scanWorkspace', async () => {
      await scanner.scanWorkspace();
      vscode.window.showInformationMessage('CODEOWNERS Guard: Workspace scan complete.');
    })
  );

  // 3. Fix All in Current File
  context.subscriptions.push(
    vscode.commands.registerCommand('codeowners-guard.fixAllInFile', async (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;

      if (!targetUri) {
        vscode.window.showInformationMessage('No active editor found to fix.');
        return;
      }

      const fileName = path.basename(targetUri.fsPath);
      const isCodeowners =
        fileName === 'CODEOWNERS' ||
        vscode.window.activeTextEditor?.document.languageId === 'codeowners';

      if (!isCodeowners) {
        vscode.window.showInformationMessage(
          `Current file '${fileName}' is not a CODEOWNERS file.`
        );
        return;
      }

      await bulkFixer.fixAllInFile(targetUri);
    })
  );

  // 4. Fix All in Workspace
  context.subscriptions.push(
    vscode.commands.registerCommand('codeowners-guard.fixAllInWorkspace', async () => {
      await bulkFixer.fixAllInWorkspace();
    })
  );
}
