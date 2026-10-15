import * as path from 'path';
import { IFileSystem } from '../fs/fileSystem';

/**
 * Discovers the enclosing Git repository root by walking upward from a directory
 * looking for a `.git` directory or worktree `.git` file.
 * Falls back to the provided fallback directory if no `.git` marker is found.
 */
export async function findRepositoryRoot(
  startDir: string,
  fs: IFileSystem,
  fallbackDir: string = startDir
): Promise<string> {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (true) {
    const gitMarker = path.join(current, '.git');
    const stat = await fs.stat(gitMarker);
    if (stat !== null) {
      // Found .git directory or worktree .git file
      return current;
    }

    if (current === root) {
      break;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return fallbackDir;
}
