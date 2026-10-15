export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
}

export interface FileStat {
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
  mtimeMs: number;
}

export interface IFileSystem {
  readDir(dirPath: string): Promise<DirEntry[]>;
  stat(path: string): Promise<FileStat | null>;
  readFile(path: string): Promise<string>;
  realpath(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}
