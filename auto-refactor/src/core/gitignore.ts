import * as fs from 'fs';
import * as path from 'path';

/**
 * Pragmatic `.gitignore` matcher (a commonly-used subset of the git spec).
 *
 * Supported:
 *   - `#` comments and blank lines
 *   - `!` negation (last matching rule wins)
 *   - trailing `/`  => directory-only pattern (matches the dir and everything beneath it)
 *   - leading `/`   => anchored to the .gitignore's own directory (root of this matcher)
 *   - `*`           => matches within a single path segment
 *   - `**`          => matches across segments
 *   - `?`           => single non-separator char
 *   - a pattern with no `/` also matches a file's basename at any depth (e.g. `*.log`)
 *
 * NOT supported (deliberately out of scope for a lint tool): the "star-star-slash" prefix,
 * character classes [...], brace expansion, and the rarer precedence edge cases. For those,
 * the explicit exclude list remains the source of truth.
 */

interface Pattern {
  negated: boolean;
  dirOnly: boolean;
  slashless: boolean;
  regex: RegExp;
}

function globToRegExp(glob: string): RegExp {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i += 2;
        if (glob[i] === '/') i++; // consume separator after **
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp('^' + re + '$');
}

/**
 * Build a predicate that returns true if `rel` (a path relative to `root`, using
 * forward slashes) should be ignored per the root `.gitignore`. If no `.gitignore`
 * exists, the predicate always returns false.
 */
export function loadGitignore(root: string): (rel: string) => boolean {
  const giPath = path.join(root, '.gitignore');
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(giPath, 'utf8').split(/\r?\n/);
  } catch {
    return () => false;
  }

  const patterns: Pattern[] = [];
  for (let raw of lines) {
    raw = raw.trim();
    if (!raw || raw.startsWith('#')) continue;
    let negated = false;
    if (raw.startsWith('!')) {
      negated = true;
      raw = raw.slice(1).trim();
    }
    let dirOnly = false;
    if (raw.endsWith('/')) {
      dirOnly = true;
      raw = raw.slice(0, -1);
    }
    if (raw.startsWith('/')) raw = raw.slice(1); // anchor to this dir
    const slashless = !raw.includes('/');
    let body = globToRegExp(raw).source; // reuse the anchored body
    const regex = new RegExp('^' + body + (dirOnly ? '(/.*)?$' : '$'));
    patterns.push({ negated, dirOnly, slashless, regex });
  }

  if (patterns.length === 0) return () => false;

  return (rel: string): boolean => {
    const norm = rel.split(path.sep).join('/');
    let ignored = false;
    for (const p of patterns) {
      let hit = p.regex.test(norm);
      if (!hit && p.slashless) {
        const base = norm.includes('/') ? norm.slice(norm.lastIndexOf('/') + 1) : norm;
        hit = p.regex.test(base);
      }
      if (hit) ignored = !p.negated;
    }
    return ignored;
  };
}
