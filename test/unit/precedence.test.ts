import * as assert from 'assert';
import * as path from 'path';
import { PrecedenceManager, MAX_CODEOWNERS_FILE_SIZE } from '../../src/discovery/precedenceManager';
import { findRepositoryRoot } from '../../src/discovery/repoRoot';
import { MockFileSystem } from '../../src/fs/mockFileSystem';

describe('Discovery & Precedence', () => {
  let mfs: MockFileSystem;
  let manager: PrecedenceManager;
  const repoRoot = '/test-repo';

  beforeEach(() => {
    mfs = new MockFileSystem();
    manager = new PrecedenceManager(mfs);
  });

  // 1. .github/CODEOWNERS takes precedence over root CODEOWNERS
  it('1. .github/CODEOWNERS takes precedence over root CODEOWNERS', async () => {
    mfs.addFile(`${repoRoot}/.github/CODEOWNERS`, '* @github-team');
    mfs.addFile(`${repoRoot}/CODEOWNERS`, '* @root-team');

    const result = await manager.discover(repoRoot);
    assert.strictEqual(
      result.effectiveFilePath,
      path.join(repoRoot, '.github', 'CODEOWNERS')
    );
    assert.strictEqual(result.inactiveFilePaths.length, 1);
    assert.strictEqual(
      result.inactiveFilePaths[0],
      path.join(repoRoot, 'CODEOWNERS')
    );
  });

  // 2. Root CODEOWNERS takes precedence over docs/CODEOWNERS when .github is absent
  it('2. Root CODEOWNERS takes precedence over docs/CODEOWNERS when .github is absent', async () => {
    mfs.addFile(`${repoRoot}/CODEOWNERS`, '* @root-team');
    mfs.addFile(`${repoRoot}/docs/CODEOWNERS`, '* @docs-team');

    const result = await manager.discover(repoRoot);
    assert.strictEqual(result.effectiveFilePath, path.join(repoRoot, 'CODEOWNERS'));
    assert.strictEqual(result.inactiveFilePaths.length, 1);
    assert.strictEqual(
      result.inactiveFilePaths[0],
      path.join(repoRoot, 'docs', 'CODEOWNERS')
    );
  });

  // 3. docs/CODEOWNERS works when higher-priority locations are absent
  it('3. docs/CODEOWNERS works when higher-priority locations are absent', async () => {
    mfs.addFile(`${repoRoot}/docs/CODEOWNERS`, '* @docs-team');

    const result = await manager.discover(repoRoot);
    assert.strictEqual(
      result.effectiveFilePath,
      path.join(repoRoot, 'docs', 'CODEOWNERS')
    );
    assert.strictEqual(result.inactiveFilePaths.length, 0);
  });

  // 4. Multiple workspace roots are handled independently
  it('4. Multiple workspace roots are handled independently', async () => {
    const repoA = '/workspace/repoA';
    const repoB = '/workspace/repoB';

    mfs.addFile(`${repoA}/.github/CODEOWNERS`, '* @team-a');
    mfs.addFile(`${repoB}/docs/CODEOWNERS`, '* @team-b');

    const resultA = await manager.discover(repoA);
    const resultB = await manager.discover(repoB);

    assert.strictEqual(
      resultA.effectiveFilePath,
      path.join(repoA, '.github', 'CODEOWNERS')
    );
    assert.strictEqual(
      resultB.effectiveFilePath,
      path.join(repoB, 'docs', 'CODEOWNERS')
    );
  });

  // 5. Missing CODEOWNERS is handled cleanly
  it('5. Missing CODEOWNERS is handled cleanly', async () => {
    const result = await manager.discover('/empty-repo');
    assert.strictEqual(result.effectiveFilePath, null);
    assert.strictEqual(result.inactiveFilePaths.length, 0);
    assert.strictEqual(result.findings.length, 0);
  });

  // 6. Opening an inactive lower-precedence file produces informational diagnostic
  it('6. Opening an inactive lower-precedence file is handled consistently', async () => {
    mfs.addFile(`${repoRoot}/.github/CODEOWNERS`, '* @github-team');
    const inactivePath = path.join(repoRoot, 'docs', 'CODEOWNERS');
    mfs.addFile(inactivePath, '* @docs-team');

    const check = await manager.isEffective(inactivePath, repoRoot);
    assert.strictEqual(check.isEffective, false);
    assert.ok(check.reason && check.reason.includes('higher-precedence file exists'));
  });

  // Repository root upward discovery (.git directory)
  it('Discovers repo root by walking upward to .git directory', async () => {
    mfs.addDirectory('/my-project/.git');
    mfs.addDirectory('/my-project/packages/frontend/src');

    const discovered = await findRepositoryRoot(
      '/my-project/packages/frontend/src',
      mfs
    );
    assert.strictEqual(discovered, '/my-project');
  });

  // Repository root upward discovery (.git worktree file)
  it('Discovers repo root by walking upward to .git worktree file', async () => {
    mfs.addFile('/worktree-repo/.git', 'gitdir: /main-repo/.git/worktrees/feat');
    mfs.addDirectory('/worktree-repo/subdir');

    const discovered = await findRepositoryRoot('/worktree-repo/subdir', mfs);
    assert.strictEqual(discovered, '/worktree-repo');
  });

  // Fallback to workspace root when no .git exists
  it('Falls back to workspace directory when no .git is found', async () => {
    mfs.addDirectory('/plain-dir/subdir');
    const discovered = await findRepositoryRoot(
      '/plain-dir/subdir',
      mfs,
      '/plain-dir'
    );
    assert.strictEqual(discovered, '/plain-dir');
  });

  // 3 MB size limit enforcement
  it('Enforces 3 MB file size limit and skips validation with diagnostic', async () => {
    const largeFilePath = `${repoRoot}/.github/CODEOWNERS`;
    mfs.addFile(largeFilePath, '# Large', MAX_CODEOWNERS_FILE_SIZE + 100);

    const result = await manager.discover(repoRoot);
    assert.strictEqual(result.fileTooLarge, true);
    assert.strictEqual(result.findings.length, 1);
    assert.strictEqual(result.findings[0].type, 'file-too-large');
    assert.ok(result.findings[0].message.includes('3 MB size limit'));
  });
});
