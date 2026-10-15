/**
 * Normalizes and checks whether a path matches any exclusion patterns.
 */
export class ExclusionsMatcher {
  private patterns: string[];

  constructor(patterns: string[] = ['**/.git', '**/node_modules', '**/dist', '**/build', '**/coverage']) {
    this.patterns = patterns.map(p => p.replace(/\\/g, '/').replace(/^\/+/, ''));
  }

  public isExcluded(relativePath: string): boolean {
    const norm = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    if (!norm) {
      return false;
    }

    const segments = norm.split('/');

    for (const pattern of this.patterns) {
      if (this.matchPattern(norm, segments, pattern)) {
        return true;
      }
    }

    return false;
  }

  private matchPattern(norm: string, segments: string[], pattern: string): boolean {
    // If pattern starts with '**/', match against any trailing suffix or segment
    if (pattern.startsWith('**/')) {
      const subPattern = pattern.substring(3);
      if (!subPattern.includes('/')) {
        // Single segment match anywhere in path (e.g. **/.git matches any segment === '.git')
        if (segments.some(s => this.wildcardMatch(s, subPattern))) {
          return true;
        }
      }
      if (this.wildcardMatch(norm, subPattern) || norm.startsWith(subPattern.replace(/\/\*\*?$/, '') + '/')) {
        return true;
      }
    }

    // Exact or prefix match
    if (this.wildcardMatch(norm, pattern)) {
      return true;
    }

    // If pattern targets a directory like 'dist' or 'dist/**', check if path starts with it
    const cleanPat = pattern.replace(/\/\*\*?$/, '');
    if (norm === cleanPat || norm.startsWith(cleanPat + '/')) {
      return true;
    }

    return false;
  }

  private wildcardMatch(str: string, pattern: string): boolean {
    if (pattern === str || pattern === '*') {
      return true;
    }
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '.*')
      .replace(/(?<!\.)\*/g, '[^/]*')
      .replace(/\?/g, '[^/]');
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(str);
  }
}
