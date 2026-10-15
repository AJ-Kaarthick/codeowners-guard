export class Position {
  constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
  public readonly start: Position;
  public readonly end: Position;

  constructor(
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number
  ) {
    this.start = new Position(startLine, startCharacter);
    this.end = new Position(endLine, endCharacter);
  }

  public get startLine(): number {
    return this.start.line;
  }
  public get startCharacter(): number {
    return this.start.character;
  }
  public get endLine(): number {
    return this.end.line;
  }
  public get endCharacter(): number {
    return this.end.character;
  }
}

export class Uri {
  public scheme: string;
  public path: string;
  public fsPath: string;

  constructor(fsPath: string, scheme = 'file') {
    this.fsPath = fsPath;
    this.path = fsPath;
    this.scheme = scheme;
  }

  public static file(p: string): Uri {
    return new Uri(p, 'file');
  }

  public static parse(val: string): Uri {
    const clean = val.replace(/^file:\/\//, '');
    return new Uri(clean, 'file');
  }

  public toString(): string {
    return `file://${this.fsPath}`;
  }
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export class Diagnostic {
  public source?: string;
  public code?: string | number | { value: string | number; target: Uri };

  constructor(
    public range: Range,
    public message: string,
    public severity: DiagnosticSeverity = DiagnosticSeverity.Error
  ) {}
}

export class DiagnosticCollection {
  private map = new Map<string, Diagnostic[]>();

  constructor(public readonly name: string) {}

  public set(uri: Uri, diagnostics: Diagnostic[]): void {
    this.map.set(uri.toString(), diagnostics);
  }

  public get(uri: Uri): Diagnostic[] | undefined {
    return this.map.get(uri.toString());
  }

  public delete(uri: Uri): void {
    this.map.delete(uri.toString());
  }

  public clear(): void {
    this.map.clear();
  }

  public dispose(): void {
    this.clear();
  }
}

export class WorkspaceEdit {
  public entries = new Map<string, Array<{ range: Range; newText: string }>>();

  public replace(uri: Uri, range: Range, newText: string): void {
    const key = uri.toString();
    const list = this.entries.get(key) ?? [];
    list.push({ range, newText });
    this.entries.set(key, list);
  }

  public get size(): number {
    let count = 0;
    for (const edits of this.entries.values()) {
      count += edits.length;
    }
    return count;
  }
}

export enum CodeActionKind {
  QuickFix = 'quickfix',
  Refactor = 'refactor',
  Source = 'source',
}

export class CodeAction {
  public isPreferred?: boolean;
  public diagnostics?: Diagnostic[];
  public edit?: WorkspaceEdit;
  public command?: { command: string; title: string; arguments?: any[] };

  constructor(public title: string, public kind?: CodeActionKind) {}
}

export class Disposable {
  constructor(private callOnDispose: () => any) {}
  public dispose(): any {
    return this.callOnDispose();
  }
  public static from(...disposables: { dispose(): any }[]): Disposable {
    return new Disposable(() => {
      for (const d of disposables) {
        d.dispose();
      }
    });
  }
}

export interface MockTextDocument {
  uri: Uri;
  fileName: string;
  languageId: string;
  version: number;
  getText(range?: Range): string;
}

// In-memory document store for test simulation
export const mockDocuments = new Map<string, { content: string; languageId: string }>();

export const workspace = {
  workspaceFolders: [] as Array<{ uri: Uri; name: string; index: number }>,
  textDocuments: [] as MockTextDocument[],

  asRelativePath(pathOrUri: string | Uri): string {
    const p = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath;
    return p.replace(/\\/g, '/').split('/').slice(-2).join('/');
  },

  openTextDocument: async (uriOrFileName: Uri | string): Promise<MockTextDocument> => {
    const uri = typeof uriOrFileName === 'string' ? Uri.file(uriOrFileName) : uriOrFileName;
    const docEntry = mockDocuments.get(uri.toString()) ?? {
      content: '',
      languageId: 'codeowners',
    };

    return {
      uri,
      fileName: uri.fsPath,
      languageId: docEntry.languageId,
      version: 1,
      getText: (range?: Range) => {
        if (!range) {
          return docEntry.content;
        }
        const lines = docEntry.content.split(/\r?\n/);
        if (range.start.line === range.end.line) {
          const line = lines[range.start.line] ?? '';
          return line.substring(range.start.character, range.end.character);
        }
        return docEntry.content;
      },
    };
  },

  applyEdit: async (edit: WorkspaceEdit): Promise<boolean> => {
    for (const [uriStr, edits] of edit.entries.entries()) {
      const doc = mockDocuments.get(uriStr);
      if (doc) {
        let content = doc.content;
        const lines = content.split(/\r?\n/);
        // Apply edits in reverse order
        const sorted = [...edits].sort((a, b) => b.range.start.line - a.range.start.line);
        for (const e of sorted) {
          const line = lines[e.range.start.line] ?? '';
          lines[e.range.start.line] =
            line.substring(0, e.range.start.character) +
            e.newText +
            line.substring(e.range.end.character);
        }
        doc.content = lines.join('\n');
      }
    }
    return true;
  },

  getConfiguration: (_section?: string) => ({
    get: <T>(_key: string, defaultValue?: T): T => defaultValue as T,
  }),

  createFileSystemWatcher: (_glob: string) => ({
    onDidCreate: (_fn: any) => new Disposable(() => {}),
    onDidDelete: (_fn: any) => new Disposable(() => {}),
    onDidChange: (_fn: any) => new Disposable(() => {}),
    dispose: () => {},
  }),

  onDidOpenTextDocument: (_fn: any) => new Disposable(() => {}),
  onDidChangeTextDocument: (_fn: any) => new Disposable(() => {}),
  onDidSaveTextDocument: (_fn: any) => new Disposable(() => {}),
  onDidCloseTextDocument: (_fn: any) => new Disposable(() => {}),
  onDidChangeWorkspaceFolders: (_fn: any) => new Disposable(() => {}),
};

export const window = {
  activeTextEditor: undefined as any,
  showInformationMessage: async (
    _message: string,
    _options?: any,
    ...items: string[]
  ): Promise<string | undefined> => {
    return items[0] ?? 'Apply Fixes';
  },
  showWarningMessage: async (
    _message: string,
    _options?: any,
    ...items: string[]
  ): Promise<string | undefined> => {
    return items[0];
  },
  showErrorMessage: async (
    _message: string,
    _options?: any,
    ...items: string[]
  ): Promise<string | undefined> => {
    return items[0];
  },
};

export const languages = {
  createDiagnosticCollection: (name: string) => new DiagnosticCollection(name),
  registerCodeActionsProvider: () => new Disposable(() => {}),
};

export const commands = {
  registerCommand: (_command: string, _callback: any) => new Disposable(() => {}),
};
