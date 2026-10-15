import * as assert from 'assert';
import { CodeownersParser } from '../../src/parser/codeownersParser';

describe('CODEOWNERS Parser', () => {
  let parser: CodeownersParser;

  beforeEach(() => {
    parser = new CodeownersParser();
  });

  // 7. Blank lines and comments are ignored
  it('7. Blank lines and full-line comments are categorized correctly', () => {
    const content = `
# Comment line 1
    # Indented comment

/src/ @team
`;
    const result = parser.parse(content);
    assert.strictEqual(result.lines[0].kind, 'empty');
    assert.strictEqual(result.lines[1].kind, 'comment');
    assert.strictEqual(result.lines[2].kind, 'comment');
    assert.strictEqual(result.rules.length, 1);
    assert.strictEqual(result.rules[0].patternToken?.text, '/src/');
  });

  // 8. Multiple owners are preserved
  it('8. Multiple owners are preserved with exact ranges and kinds', () => {
    const content = '/docs/ @alice @org/docs-team user@example.com';
    const result = parser.parse(content);
    const rule = result.rules[0];

    assert.strictEqual(rule.owners.length, 3);
    assert.strictEqual(rule.owners[0].text, '@alice');
    assert.strictEqual(rule.owners[0].kind, 'user');
    assert.strictEqual(rule.owners[1].text, '@org/docs-team');
    assert.strictEqual(rule.owners[1].kind, 'team');
    assert.strictEqual(rule.owners[2].text, 'user@example.com');
    assert.strictEqual(rule.owners[2].kind, 'email');
  });

  // 9. Email-style owners are preserved
  it('9. Email-style owners are preserved', () => {
    const content = '*.js dev.lead@company.co.uk';
    const result = parser.parse(content);
    const rule = result.rules[0];

    assert.strictEqual(rule.owners.length, 1);
    assert.strictEqual(rule.owners[0].text, 'dev.lead@company.co.uk');
    assert.strictEqual(rule.owners[0].kind, 'email');
  });

  // 10. Comments are not swallowed into path edits
  it('10. Inline comments are not swallowed into pattern or owners', () => {
    const content = '/src/components/ @frontend # Review required for UI components';
    const result = parser.parse(content);
    const rule = result.rules[0];

    assert.strictEqual(rule.patternToken?.text, '/src/components/');
    assert.strictEqual(rule.owners.length, 1);
    assert.strictEqual(rule.owners[0].text, '@frontend');
    assert.ok(rule.inlineComment);
    assert.strictEqual(
      rule.inlineComment?.text,
      '# Review required for UI components'
    );
  });

  // 11. Empty owner lists are permitted
  it('11. Empty owner lists are permitted (unowned rule in GitHub CODEOWNERS)', () => {
    const content = '/docs/public/';
    const result = parser.parse(content);
    const rule = result.rules[0];

    assert.strictEqual(rule.patternToken?.text, '/docs/public/');
    assert.strictEqual(rule.owners.length, 0);
    assert.strictEqual(result.findings.length, 0);
  });

  // 12. Duplicate exact patterns are identified in rule order
  it('12. Duplicate exact patterns are identified with last rule overriding earlier ones', () => {
    const content = `/src/Button.tsx @team-old
/src/Button.tsx @team-new`;
    const result = parser.parse(content);

    assert.strictEqual(result.findings.length, 1);
    const finding = result.findings[0];
    assert.strictEqual(finding.type, 'overridden-pattern');
    assert.strictEqual(finding.ruleLineNumber, 0);
    assert.strictEqual(finding.overriddenByLineNumber, 1);
    assert.ok(finding.message.includes('overridden by an exact duplicate rule on line 2'));
  });

  // 13. '!' syntax is reported as unsupported
  it('13. "!" negation syntax is reported as unsupported', () => {
    const content = '!/build/ @admin';
    const result = parser.parse(content);

    const finding = result.findings.find(f => f.type === 'unsupported-syntax');
    assert.ok(finding);
    assert.ok(finding.message.includes("GitHub CODEOWNERS does not support '!' negation"));
  });

  // 14. '[ ]' character-range syntax is reported as unsupported
  it('14. "[ ]" character-range syntax is reported as unsupported', () => {
    const content = '/src/[a-z]*.ts @frontend';
    const result = parser.parse(content);

    const finding = result.findings.find(f => f.type === 'unsupported-syntax');
    assert.ok(finding);
    assert.ok(
      finding.message.includes(
        "GitHub CODEOWNERS does not support '[ ]' character range"
      )
    );
  });

  // 15. Malformed/ambiguous patterns do not crash the parser
  it('15. Malformed/ambiguous patterns do not crash the parser', () => {
    const weirdInputs = [
      '\\\\\\',
      '#',
      '   ',
      '!@#$%',
      '/path/with\\ escaped\\ spaces @user',
      '*.ts @user # comment without space#',
    ];

    for (const input of weirdInputs) {
      assert.doesNotThrow(() => {
        parser.parse(input);
      });
    }
  });

  // Escaped space in pattern token
  it('Parses escaped spaces in pattern token without breaking owner parsing', () => {
    const content = '/my\\ path/my\\ file.ts @author';
    const result = parser.parse(content);
    const rule = result.rules[0];

    assert.strictEqual(rule.patternToken?.text, '/my\\ path/my\\ file.ts');
    assert.strictEqual(rule.owners.length, 1);
    assert.strictEqual(rule.owners[0].text, '@author');
  });

  // Regression test: pattern beginning with escaped hash \#
  it('Reports pattern starting with escaped hash (\\#) as unsupported syntax', () => {
    const content = '\\#special-file.txt @security-team';
    const result = parser.parse(content);

    const finding = result.findings.find(f => f.type === 'unsupported-syntax');
    assert.ok(finding);
    assert.ok(
      finding.message.includes("GitHub CODEOWNERS does not support patterns starting with '\\#'")
    );
  });
});
