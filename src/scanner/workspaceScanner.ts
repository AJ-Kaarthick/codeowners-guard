import * as path from 'path';
import * as vscode from 'vscode';
import { findRepositoryRoot } from '../discovery/repoRoot';
import { PrecedenceManager } from '../discovery/precedenceManager';
import { IFileSystem } from '../fs/fileSystem';
import { DiagnosticManager } from '../diagnostics/diagnosticManager';
import { CodeownersParser } from '../parser/codeownersParser';
import { PathResolver } from '../resolver/pathResolver';
import { ExclusionsMatcher } from '../resolver/exclusions';
import { DiagnosticFinding } from '../parser/types';

export class WorkspaceScanner implements vscode.Disposable {
  private parser = new CodeownersParser();
  private precedenceManager: PrecedenceManager;
  private pathResolver: PathResolver;
  private disposables: vscode.Disposable[] = [];
  private editDebounceTimers = new Map<string, NodeJS.Timeout>();
  private fsEventDebounceTimer: NodeJS.Timeout | null = null;
  private isScanning = false;

  constructor(
    private fs: IFileSystem,
    private diagnosticManager: DiagnosticManager
  ) {
    this.precedenceManager = new PrecedenceManager(fs);
    this.pathResolver = new PathResolver(fs);
  }

  public getPathResolver(): PathResolver {
    return this.pathResolver;
  }

  public getPrecedenceManager(): PrecedenceManager {
    return this.precedenceManager;
  }

  /**
   * Initializes workspace-level watchers and scans all effective CODEOWNERS files.
   */
  public async initialize(): Promise<void> {
    this.setupListeners();
    await this.scanWorkspace();
  }

  /**
   * Scans all workspace roots and their effective CODEOWNERS files.
   */
  public async scanWorkspace(): Promise<void> {
    if (this.isScanning) {
      return;
    }
    this.isScanning = true;

    try {
      const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
      if (workspaceFolders.length === 0) {
        return;
      }

      // Track discovered repo roots to avoid redundant duplicate scans
      const processedRepoRoots = new Set<string>();

      for (const folder of workspaceFolders) {
        const folderPath = folder.uri.fsPath;
        const repoRoot = await findRepositoryRoot(folderPath, this.fs, folderPath);

        if (processedRepoRoots.has(repoRoot)) {
          continue;
        }
        processedRepoRoots.add(repoRoot);

        const discovery = await this.precedenceManager.discover(repoRoot);

        // Emit diagnostics for inactive files
        for (const inactivePath of discovery.inactiveFilePaths) {
          const inactiveUri = vscode.Uri.file(inactivePath);
          const relEffective = discovery.effectiveFilePath
            ? path.relative(repoRoot, discovery.effectiveFilePath)
            : 'higher-precedence location';

          const finding: DiagnosticFinding = {
            type: 'inactive-file',
            message: `This CODEOWNERS file is inactive because a higher-precedence file exists at '${relEffective}'.`,
            range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 },
            severity: 'info',
          };
          this.diagnosticManager.setDiagnostics(inactiveUri, [finding]);
        }

        // If file too large or missing
        if (!discovery.effectiveFilePath) {
          continue;
        }

        const effectiveUri = vscode.Uri.file(discovery.effectiveFilePath);

        if (discovery.fileTooLarge) {
          this.diagnosticManager.setDiagnostics(effectiveUri, discovery.findings);
          continue;
        }

        await this.scanFile(effectiveUri, repoRoot);
      }
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Scans a specific CODEOWNERS file.
   */
  public async scanFile(uri: vscode.Uri, explicitRepoRoot?: string): Promise<DiagnosticFinding[]> {
    const filePath = uri.fsPath;
    const repoRoot = explicitRepoRoot ?? (await findRepositoryRoot(path.dirname(filePath), this.fs));

    // Verify precedence
    const precCheck = await this.precedenceManager.isEffective(filePath, repoRoot);
    if (!precCheck.isEffective) {
      if (precCheck.reason) {
        const finding: DiagnosticFinding = {
          type: 'inactive-file',
          message: precCheck.reason,
          range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 },
          severity: 'info',
        };
        this.diagnosticManager.setDiagnostics(uri, [finding]);
        return [finding];
      }
      this.diagnosticManager.clearDiagnostics(uri);
      return [];
    }

    let content: string;
    try {
      const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
      if (doc) {
        content = doc.getText();
      } else {
        content = await this.fs.readFile(filePath);
      }
    } catch {
      this.diagnosticManager.clearDiagnostics(uri);
      return [];
    }

    // Parse file
    const parsed = this.parser.parse(content);
    const findings: DiagnosticFinding[] = [...parsed.findings];

    // Read exclusions configuration
    const config = vscode.workspace.getConfiguration('codeownersGuard');
    const configuredExcludes: string[] = config.get('exclude') ?? [
      '**/.git',
      '**/node_modules',
      '**/dist',
      '**/build',
      '**/coverage',
    ];
    const exclusions = new ExclusionsMatcher(configuredExcludes);

    // Resolve rules against filesystem
    for (const rule of parsed.rules) {
      if (!rule.patternToken) {
        continue;
      }

      const resolverFinding = await this.pathResolver.resolvePattern({
        repoRoot,
        token: rule.patternToken,
        exclusions,
      });

      if (resolverFinding) {
        findings.push(resolverFinding);
      }
    }

    this.diagnosticManager.setDiagnostics(uri, findings);
    return findings;
  }

  private setupListeners(): void {
    // 1. Text document opened
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument(doc => {
        if (this.isCodeownersDocument(doc)) {
          this.scanFile(doc.uri);
        }
      })
    );

    // 2. Text document edited (debounced 300ms)
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        if (this.isCodeownersDocument(event.document)) {
          const key = event.document.uri.toString();
          const existing = this.editDebounceTimers.get(key);
          if (existing) {
            clearTimeout(existing);
          }
          const timer = setTimeout(() => {
            this.editDebounceTimers.delete(key);
            this.scanFile(event.document.uri);
          }, 300);
          this.editDebounceTimers.set(key, timer);
        }
      })
    );

    // 3. Text document saved
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(doc => {
        if (this.isCodeownersDocument(doc)) {
          this.scanFile(doc.uri);
        }
      })
    );

    // 4. Document closed: clear any pending debounce timer
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument(doc => {
        const key = doc.uri.toString();
        const existing = this.editDebounceTimers.get(key);
        if (existing) {
          clearTimeout(existing);
          this.editDebounceTimers.delete(key);
        }
      })
    );

    // 5. Filesystem watcher on workspace (create/delete/rename)
    // Debounces burst file operations, invalidates path resolver directory cache,
    // and rescans active CODEOWNERS files without a full recursive workspace crawl
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
    const onFsEvent = (uri: vscode.Uri) => {
      // Invalidate directory cache for the affected folder
      const dir = path.dirname(uri.fsPath);
      this.pathResolver.clearCache(dir);

      if (this.fsEventDebounceTimer) {
        clearTimeout(this.fsEventDebounceTimer);
      }
      this.fsEventDebounceTimer = setTimeout(() => {
        this.fsEventDebounceTimer = null;
        this.scanWorkspace();
      }, 300);
    };

    this.disposables.push(fileWatcher.onDidCreate(onFsEvent));
    this.disposables.push(fileWatcher.onDidDelete(onFsEvent));
    this.disposables.push(fileWatcher.onDidChange(onFsEvent));
    this.disposables.push(fileWatcher);

    // 6. Workspace folders changed
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.pathResolver.clearCache();
        this.scanWorkspace();
      })
    );
  }

  private isCodeownersDocument(doc: vscode.TextDocument): boolean {
    const fileName = path.basename(doc.fileName);
    return fileName === 'CODEOWNERS' || doc.languageId === 'codeowners';
  }

  public dispose(): void {
    for (const timer of this.editDebounceTimers.values()) {
      clearTimeout(timer);
    }
    this.editDebounceTimers.clear();

    if (this.fsEventDebounceTimer) {
      clearTimeout(this.fsEventDebounceTimer);
      this.fsEventDebounceTimer = null;
    }

    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
