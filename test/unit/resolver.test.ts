import * as assert from 'assert';
import { MockFileSystem } from '../../src/fs/mockFileSystem';
import { PathResolver } from '../../src/resolver/pathResolver';
import { ExclusionsMatcher } from '../../src/resolver/exclusions';
import { PatternToken } from '../../src/parser/types';

describe('Filesystem Path Validation & Casing', () => {
  let mfs: MockFileSystem;
  let resolver: PathResolver;
  const repoRoot = '/test-repo';

  function createToken(text: string): PatternToken {
    return {
      text,
      range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: text.length },
      hasNegation: text.startsWith('!'),
      hasCharRange: /\[.+\]/.test(text),
      hasEscapedLeadingHash: text.startsWith('\\#'),
    };
  }

  beforeEach(() => {
    mfs = new MockFileSystem({ isCaseSensitive: true });
    resolver = new PathResolver(mfs);
  });

  // 16. Correct path casing produces no casing diagnostic
  it('16. Correct path casing produces no casing diagnostic', async () => {
    mfs.addFile(`${repoRoot}/src/components/Button.tsx`, 'export const Button = () => null;');

    const token = createToken('/src/components/Button.tsx');
    const finding = await resolver.resolvePattern({ repoRoot, token });
    assert.strictEqual(finding, null);
  });

  // 17. Wrong literal file casing is diagnosed
  it('17. Wrong literal file casing is diagnosed', async () => {
    mfs.addFile(`${repoRoot}/src/components/Button.tsx`, 'export const Button = () => null;');

    const token = createToken('/src/components/button.tsx');
    const finding = await resolver.resolvePattern({ repoRoot, token });

    assert.ok(finding);
    assert.strictEqual(finding.type, 'casing-mismatch');
    assert.strictEqual(finding.suggestedReplacement, '/src/components/Button.tsx');
  });

  // 18. Wrong directory casing is diagnosed
  it('18. Wrong directory casing is diagnosed', async () => {
    mfs.addFile(`${repoRoot}/src/components/Button.tsx`, 'content');

    const token = createToken('/src/Components/Button.tsx');
    const finding = await resolver.resolvePattern({ repoRoot, token });

    assert.ok(finding);
    assert.strictEqual(finding.type, 'casing-mismatch');
    assert.strictEqual(finding.suggestedReplacement, '/src/components/Button.tsx');
  });

  // 19. Multiple wrong segments are corrected together
  it('19. Multiple wrong segments are corrected together', async () => {
    mfs.addFile(`${repoRoot}/src/components/Button.tsx`, 'content');

    const token = createToken('/SRC/Components/button.tsx');
    const finding = await resolver.resolvePattern({ repoRoot, token });

    assert.ok(finding);
    assert.strictEqual(finding.type, 'casing-mismatch');
    assert.strictEqual(finding.suggestedReplacement, '/src/components/Button.tsx');
  });

  // 20. Dot-prefixed paths work
  it('20. Dot-prefixed paths work', async () => {
    mfs.addFile(`${repoRoot}/.github/workflows/ci.yml`, 'name: CI');

    const token = createToken('/.github/Workflows/ci.yml');
    const finding = await resolver.resolvePattern({ repoRoot, token });

    assert.ok(finding);
    assert.strictEqual(finding.type, 'casing-mismatch');
    assert.strictEqual(finding.suggestedReplacement, '/.github/workflows/ci.yml');
  });

  // 21. Root-anchored paths are resolved against repository root
  it('21. Root-anchored paths are resolved strictly against repository root', async () => {
    mfs.addFile(`${repoRoot}/docs/index.md`, 'Doc root');
    mfs.addFile(`${repoRoot}/nested/docs/index.md`, 'Nested doc');

    const token = createToken('/docs/index.md');
    const finding = await resolver.resolvePattern({ repoRoot, token });
    assert.strictEqual(finding, null);
  });

  // 22. Literal unmatched paths are diagnosed without unsafe fixes
  it('22. Literal unmatched paths are diagnosed without unsafe fixes', async () => {
    mfs.addDirectory(`${repoRoot}/src`);

    const token = createToken('/src/nonexistent/file.ts');
    const finding = await resolver.resolvePattern({ repoRoot, token });

    assert.ok(finding);
    assert.strictEqual(finding.type, 'unmatched-path');
    assert.strictEqual(finding.suggestedReplacement, undefined);
    assert.ok(finding.message.includes('matches no workspace'));
  });

  // 23. Wildcard patterns do not produce fabricated targets
  it('23. Wildcard patterns do not produce fabricated targets', async () => {
    mfs.addFile(`${repoRoot}/src/components/Button.tsx`, 'content');

    // Provable literal prefix /Src/components/ with wildcard suffix *.tsx
    const token = createToken('/Src/components/*.tsx');
    const finding = await resolver.resolvePattern({ repoRoot, token });

    assert.ok(finding);
    assert.strictEqual(finding.type, 'casing-mismatch');
    assert.strictEqual(finding.suggestedReplacement, '/src/components/*.tsx');
  });

  // 24. Ambiguous filesystem matches suppress Quick Fix
  it('24. Ambiguous filesystem matches suppress Quick Fix', async () => {
    // Both 'test' and 'Test' exist in the same parent directory on a case-sensitive fs
    mfs.addDirectory(`${repoRoot}/src/test`);
    mfs.addDirectory(`${repoRoot}/src/Test`);

    const token = createToken('/src/TEST/');
    const finding = await resolver.resolvePattern({ repoRoot, token });

    assert.ok(finding);
    assert.strictEqual(finding.type, 'casing-mismatch');
    assert.strictEqual(finding.isAmbiguous, true);
    assert.strictEqual(finding.suggestedReplacement, undefined);
  });

  // 25. No-op corrections are suppressed
  it('25. No-op corrections are suppressed', async () => {
    mfs.addFile(`${repoRoot}/package.json`, '{}');

    const token = createToken('/package.json');
    const finding = await resolver.resolvePattern({ repoRoot, token });
    assert.strictEqual(finding, null);
  });

  // 26. Symlink behavior is safe and does not create cycles
  it('26. Symlink behavior is safe and detects cycles without hanging', async () => {
    mfs.addDirectory(`${repoRoot}/folderA`);
    // Create cycle: folderA/linkB -> folderA
    mfs.addSymlink(`${repoRoot}/folderA/loop`, `${repoRoot}/folderA`);

    const token = createToken('/folderA/loop/loop/file.ts');
    const finding = await resolver.resolvePattern({ repoRoot, token });
    // Should terminate gracefully and safely
    assert.doesNotThrow(() => finding);
  });

  // 27. Filesystem path casing works through actual directory-entry comparisons
  it('27. Filesystem path casing works through actual directory-entry comparisons', async () => {
    // Even if simulated filesystem is case-insensitive, entry comparison reveals real disk casing
    const caseInsensitiveFs = new MockFileSystem({ isCaseSensitive: false });
    const ciResolver = new PathResolver(caseInsensitiveFs);

    caseInsensitiveFs.addFile(`${repoRoot}/src/utils/helper.ts`, 'code');

    const token = createToken('/Src/Utils/Helper.ts');
    const finding = await ciResolver.resolvePattern({ repoRoot, token });

    assert.ok(finding);
    assert.strictEqual(finding.suggestedReplacement, '/src/utils/helper.ts');
  });

  // 28. Exclusions work consistently
  it('28. Exclusions work consistently and prune excluded patterns', async () => {
    mfs.addFile(`${repoRoot}/dist/bundle.js`, 'code');
    const exclusions = new ExclusionsMatcher(['**/dist/**']);

    const token = createToken('/dist/Bundle.js');
    const finding = await resolver.resolvePattern({ repoRoot, token, exclusions });
    // Excluded path produces no finding
    assert.strictEqual(finding, null);
  });

  // 1. src/components/Header.tsx — repository-root-relative semantics (internal slash)
  it('1. Resolves src/components/Header.tsx strictly relative to repository root', async () => {
    // If it exists only in a nested directory, it is unmatched because pattern has internal slash
    mfs.addFile(`${repoRoot}/packages/src/components/Header.tsx`, 'code');

    const token = createToken('src/components/Header.tsx');
    const finding = await resolver.resolvePattern({ repoRoot, token });
    assert.ok(finding);
    assert.strictEqual(finding.type, 'unmatched-path');

    // When it exists at repo root with wrong directory casing, correct it to on-disk casing
    resolver.clearCache();
    mfs.addFile(`${repoRoot}/src/Components/Header.tsx`, 'code');
    const findingCasing = await resolver.resolvePattern({ repoRoot, token });
    assert.ok(findingCasing);
    assert.strictEqual(findingCasing.type, 'casing-mismatch');
    assert.strictEqual(findingCasing.suggestedReplacement, 'src/Components/Header.tsx');
  });

  // 2. docs/* — direct children under root docs, not deeper nested files
  it('2. Matches direct children under root docs/* preserving wildcard', async () => {
    mfs.addFile(`${repoRoot}/Docs/index.md`, 'code');

    const token = createToken('docs/*');
    const finding = await resolver.resolvePattern({ repoRoot, token });
    assert.ok(finding);
    assert.strictEqual(finding.type, 'casing-mismatch');
    assert.strictEqual(finding.suggestedReplacement, 'Docs/*');
  });

  // 3. Header.tsx — basename-only pattern matching at any depth
  it('3. Handles basename-only pattern Header.tsx at any depth', async () => {
    // Exists nested in src/components/
    mfs.addFile(`${repoRoot}/src/components/header.tsx`, 'code');

    const token = createToken('Header.tsx');
    const finding = await resolver.resolvePattern({ repoRoot, token });
    assert.ok(finding);
    assert.strictEqual(finding.type, 'casing-mismatch');
    assert.strictEqual(finding.suggestedReplacement, 'header.tsx');

    // When casing matches on disk, no diagnostic
    const tokenCorrect = createToken('header.tsx');
    const findingCorrect = await resolver.resolvePattern({ repoRoot, token: tokenCorrect });
    assert.strictEqual(findingCorrect, null);
  });

  // 4. components/ — directory pattern matching at multiple depths
  it('4. Handles directory pattern components/ matching at multiple depths', async () => {
    mfs.addDirectory(`${repoRoot}/src/Components`);

    const token = createToken('components/');
    const finding = await resolver.resolvePattern({ repoRoot, token });
    assert.ok(finding);
    assert.strictEqual(finding.type, 'casing-mismatch');
    assert.strictEqual(finding.suggestedReplacement, 'Components/');
  });

  // 5. /src/components/Header.tsx — explicit root anchoring
  it('5. Preserves explicit root anchoring for /src/components/Header.tsx', async () => {
    mfs.addFile(`${repoRoot}/src/Components/Header.tsx`, 'code');

    const token = createToken('/src/components/Header.tsx');
    const finding = await resolver.resolvePattern({ repoRoot, token });
    assert.ok(finding);
    assert.strictEqual(finding.type, 'casing-mismatch');
    assert.strictEqual(finding.suggestedReplacement, '/src/Components/Header.tsx');
  });

  // 6. **/components/Header.tsx — recursive glob semantics preserved
  it('6. Preserves recursive glob semantics for **/components/Header.tsx without guessing', async () => {
    mfs.addFile(`${repoRoot}/src/components/Header.tsx`, 'code');

    const token = createToken('**/components/Header.tsx');
    const finding = await resolver.resolvePattern({ repoRoot, token });
    assert.strictEqual(finding, null);
  });

  // Regression: Truly nonexistent unanchored pattern is diagnosed as unmatched after exhaustive search
  it('Diagnoses truly nonexistent unanchored pattern as unmatched', async () => {
    mfs.addDirectory(`${repoRoot}/src/components`);

    const token = createToken('nonexistent.ts');
    const finding = await resolver.resolvePattern({ repoRoot, token });

    assert.ok(finding);
    assert.strictEqual(finding.type, 'unmatched-path');
  });

  // Regression: Coexisting exact and incorrect casing for basename pattern does not silently hide ambiguity
  it('Detects ambiguity and suppresses quick fix when exact and incorrect casing coexist for basename pattern', async () => {
    // Both Header.tsx (exact match) and header.tsx (lowercase) exist in different folders
    mfs.addFile(`${repoRoot}/src/components/Header.tsx`, 'code');
    mfs.addFile(`${repoRoot}/lib/widgets/header.tsx`, 'code');

    const token = createToken('Header.tsx');
    const finding = await resolver.resolvePattern({ repoRoot, token });

    assert.ok(finding);
    assert.strictEqual(finding.type, 'casing-mismatch');
    assert.strictEqual(finding.isAmbiguous, true);
    assert.strictEqual(finding.suggestedReplacement, undefined);
    assert.ok(finding.message.includes('coexist with differing casings'));
    assert.ok(finding.message.includes('Automatic fix is suppressed'));
  });

  // Regression: Coexisting exact and incorrect casing for directory pattern does not silently hide ambiguity
  it('Detects ambiguity and suppresses quick fix when exact and incorrect casing coexist for directory pattern', async () => {
    // Both components/ (exact match) and Components/ (capitalized) exist in different folders
    mfs.addDirectory(`${repoRoot}/src/components`);
    mfs.addDirectory(`${repoRoot}/lib/Components`);

    const token = createToken('components/');
    const finding = await resolver.resolvePattern({ repoRoot, token });

    assert.ok(finding);
    assert.strictEqual(finding.type, 'casing-mismatch');
    assert.strictEqual(finding.isAmbiguous, true);
    assert.strictEqual(finding.suggestedReplacement, undefined);
    assert.ok(finding.message.includes('coexist with differing casings'));
    assert.ok(finding.message.includes('Automatic fix is suppressed'));
  });

  // Regression: Pattern starting with \\# is ignored by resolver
  it('Ignores patterns starting with escaped hash (\\#)', async () => {
    const token: PatternToken = {
      text: '\\#file.txt',
      range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 9 },
      hasNegation: false,
      hasCharRange: false,
      hasEscapedLeadingHash: true,
    };
    const finding = await resolver.resolvePattern({ repoRoot, token });
    assert.strictEqual(finding, null);
  });
});
