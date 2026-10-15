import * as path from 'path';
import { DirEntry, FileStat, IFileSystem } from './fileSystem';

interface MockNode {
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  symlinkTarget?: string;
  content?: string;
  size?: number;
  mtimeMs?: number;
}

export class MockFileSystem implements IFileSystem {
  private nodes = new Map<string, MockNode>();
  public isCaseSensitive: boolean;

  constructor(options: { isCaseSensitive?: boolean } = {}) {
    this.isCaseSensitive = options.isCaseSensitive ?? true;
  }

  private normalizeKey(p: string): string {
    const resolved = path.posix.normalize(p.replace(/\\/g, '/'));
    return this.isCaseSensitive ? resolved : resolved.toLowerCase();
  }

  public addDirectory(dirPath: string): void {
    const norm = path.posix.normalize(dirPath.replace(/\\/g, '/'));
    const segments = norm.split('/').filter(Boolean);
    let curr = norm.startsWith('/') ? '/' : '';

    for (const seg of segments) {
      curr = curr === '/' ? `/${seg}` : `${curr}/${seg}`;
      const key = this.normalizeKey(curr);
      if (!this.nodes.has(key)) {
        this.nodes.set(key, {
          isDirectory: true,
          isFile: false,
          isSymlink: false,
          mtimeMs: Date.now(),
        });
      }
    }
  }

  public addFile(filePath: string, content = '', size?: number): void {
    const dir = path.posix.dirname(filePath);
    if (dir && dir !== '.') {
      this.addDirectory(dir);
    }
    const key = this.normalizeKey(filePath);
    this.nodes.set(key, {
      isDirectory: false,
      isFile: true,
      isSymlink: false,
      content,
      size: size ?? Buffer.byteLength(content, 'utf8'),
      mtimeMs: Date.now(),
    });
  }

  public addSymlink(linkPath: string, targetPath: string): void {
    const dir = path.posix.dirname(linkPath);
    if (dir && dir !== '.') {
      this.addDirectory(dir);
    }
    const key = this.normalizeKey(linkPath);
    this.nodes.set(key, {
      isDirectory: false,
      isFile: false,
      isSymlink: true,
      symlinkTarget: targetPath,
      mtimeMs: Date.now(),
    });
  }

  public async readDir(dirPath: string): Promise<DirEntry[]> {
    const norm = path.posix.normalize(dirPath.replace(/\\/g, '/'));
    const entries = new Map<string, DirEntry>();

    for (const [key, node] of this.nodes.entries()) {
      // Find direct children
      // To preserve actual casing in entry name, we track the original segments
      const keyNorm = path.posix.normalize(key);
      if (keyNorm.startsWith(norm) && keyNorm !== norm) {
        const rel = keyNorm.substring(norm.length).replace(/^\//, '');
        const seg = rel.split('/')[0];
        if (seg && !entries.has(seg)) {
          let isDir = node.isDirectory;
          let isFile = node.isFile;
          if (node.isSymlink && node.symlinkTarget) {
            const targetStat = await this.stat(node.symlinkTarget);
            if (targetStat) {
              isDir = targetStat.isDirectory;
              isFile = targetStat.isFile;
            }
          }
          entries.set(seg, {
            name: seg,
            isDirectory: rel.includes('/') ? true : isDir,
            isFile: rel.includes('/') ? false : isFile,
            isSymbolicLink: node.isSymlink,
          });
        }
      }
    }

    return Array.from(entries.values());
  }

  public async stat(targetPath: string): Promise<FileStat | null> {
    const key = this.normalizeKey(targetPath);
    const node = this.nodes.get(key);
    if (!node) {
      return null;
    }

    if (node.isSymlink && node.symlinkTarget) {
      // Resolve symlink target
      const visited = new Set<string>();
      visited.add(key);
      let currTarget = node.symlinkTarget;
      while (currTarget) {
        const nextKey = this.normalizeKey(currTarget);
        if (visited.has(nextKey)) {
          // Cycle detected!
          return null;
        }
        visited.add(nextKey);
        const nextNode = this.nodes.get(nextKey);
        if (!nextNode) {
          return null;
        }
        if (nextNode.isSymlink && nextNode.symlinkTarget) {
          currTarget = nextNode.symlinkTarget;
        } else {
          return {
            size: nextNode.size ?? 0,
            isDirectory: nextNode.isDirectory,
            isFile: nextNode.isFile,
            isSymbolicLink: true,
            mtimeMs: nextNode.mtimeMs ?? Date.now(),
          };
        }
      }
    }

    return {
      size: node.size ?? 0,
      isDirectory: node.isDirectory,
      isFile: node.isFile,
      isSymbolicLink: node.isSymlink,
      mtimeMs: node.mtimeMs ?? Date.now(),
    };
  }

  public async readFile(targetPath: string): Promise<string> {
    const key = this.normalizeKey(targetPath);
    const node = this.nodes.get(key);
    if (!node || !node.isFile) {
      throw new Error(`File not found: ${targetPath}`);
    }
    return node.content ?? '';
  }

  public async realpath(targetPath: string): Promise<string> {
    const key = this.normalizeKey(targetPath);
    const node = this.nodes.get(key);
    if (node && node.isSymlink && node.symlinkTarget) {
      return node.symlinkTarget;
    }
    return targetPath;
  }

  public async exists(targetPath: string): Promise<boolean> {
    const key = this.normalizeKey(targetPath);
    return this.nodes.has(key);
  }
}
