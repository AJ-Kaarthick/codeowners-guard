import * as fs from 'fs';
import * as path from 'path';
import { DirEntry, FileStat, IFileSystem } from './fileSystem';

export class NodeFileSystem implements IFileSystem {
  public async readDir(dirPath: string): Promise<DirEntry[]> {
    try {
      const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true });
      const entries: DirEntry[] = [];

      for (const dirent of dirents) {
        let isDir = dirent.isDirectory();
        let isFile = dirent.isFile();
        const isSymlink = dirent.isSymbolicLink();

        if (isSymlink) {
          // Resolve symlink target safely without throwing on broken links
          try {
            const targetStat = await fs.promises.stat(path.join(dirPath, dirent.name));
            isDir = targetStat.isDirectory();
            isFile = targetStat.isFile();
          } catch {
            // Broken symlink
            isDir = false;
            isFile = false;
          }
        }

        entries.push({
          name: dirent.name,
          isDirectory: isDir,
          isFile: isFile,
          isSymbolicLink: isSymlink,
        });
      }

      return entries;
    } catch {
      return [];
    }
  }

  public async stat(filePath: string): Promise<FileStat | null> {
    try {
      const s = await fs.promises.stat(filePath);
      return {
        size: s.size,
        isDirectory: s.isDirectory(),
        isFile: s.isFile(),
        isSymbolicLink: s.isSymbolicLink(),
        mtimeMs: s.mtimeMs,
      };
    } catch {
      return null;
    }
  }

  public async readFile(filePath: string): Promise<string> {
    return fs.promises.readFile(filePath, 'utf8');
  }

  public async realpath(filePath: string): Promise<string> {
    try {
      return await fs.promises.realpath(filePath);
    } catch {
      return filePath;
    }
  }

  public async exists(targetPath: string): Promise<boolean> {
    try {
      await fs.promises.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}
