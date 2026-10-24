/**
 * Module: Static Analysis Engine — Destructive Operand Provenance & Automatic Variable Taint
 * File Path: src/analyzers/shell-safety-taint.ts
 * Architecture Role: Pure lexical judgement layer behind the shell-safety analyzer; decides
 *   whether a recursive delete names a path the author meant, and whether a PowerShell binding
 *   shadows a read-only automatic variable.
 * Dependencies & Triggers: No imports beyond the type contract; consumed by ShellSafetyAnalyzer
 *   once per scanned script or module.
 * Responsibilities:
 *   1. Split an argument list into tokens while honouring quotes and bracket nesting;
 *   2. Extract the operand of a recursive delete for the PowerShell, POSIX shell and JavaScript
 *      dialects, including the multi-line JavaScript call shape;
 *   3. Collect single-assignment, loop and callback bindings so an operand's provenance can be
 *      followed transitively;
 *   4. Classify an operand as safe, forbidden-by-shape, or tainted through an alias chain;
 *   5. Report PowerShell bindings that shadow a read-only automatic variable.
 * Exit Semantics & Design Rationale: Pure and total; every function returns a value and none
 *   throws. The judgement is a taint analysis rather than a blanket "operand must be a literal"
 *   rule, because this corpus legitimately deletes scratch and fixture directories in dozens of
 *   places: a blanket rule would be wrong on all of them, and a guard that is wrong that often is
 *   a guard that gets switched off. No legitimate scratch path is derived from a home or drive
 *   root, so a tainted operand is always a real defect. Provenance is followed transitively and
 *   through loop aliases because the incident that motivated this rule reached the profile two
 *   hops away: a home root joined with a relative segment, iterated, then deleted through the loop
 *   variable — a single-assignment reading of `=` alone reported that file clean.
 */

/** Rule identifier for a recursive delete whose operand traces to a root or home expression. */
export const RULE_GUARD_DESTR_001 = 'GUARD-DESTR-001';

/** Rule identifier for a binding that shadows a read-only PowerShell automatic variable. */
export const RULE_GUARD_VAR_001 = 'GUARD-VAR-001';

/** Lexical dialect deciding which delete syntax and operand grammar applies to one file. */
export type DeleteDialect = 'powershell' | 'shell' | 'javascript';

/**
 * Expressions that denote a home, profile or filesystem root.
 *
 * A root is never a legitimate recursive-delete operand, so this list needs no allowance for
 * intent. The POSIX entries cover the top-level system directories and one level beneath them,
 * because deleting either destroys data no script owns.
 */
export const FORBIDDEN_OPERANDS: readonly RegExp[] = Object.freeze([
    /^\.$/,
    /^\.\.$/,
    /^[/\\]$/,
    /^[A-Za-z]:[/\\]?$/,
    /^~[/\\]?$/,
    /^\$HOME$/i,
    /^\$\{HOME\}$/i,
    /^\$PSHOME$/i,
    /^\$PROFILE$/i,
    /^\$env:(?:USERPROFILE|HOMEPATH|HOME|SYSTEMDRIVE|SYSTEMROOT|WINDIR|PROGRAMFILES)$/i,
    /^\$\{env:(?:USERPROFILE|HOMEPATH|HOME|SYSTEMDRIVE|SYSTEMROOT|WINDIR|PROGRAMFILES)\}$/i,
    /^%(?:USERPROFILE|HOMEPATH|HOMEDRIVE|SYSTEMDRIVE|SYSTEMROOT|WINDIR)%$/i,
    /^\/(?:home|users|root|etc|usr|var|bin|sbin|lib|opt|boot|dev|proc|sys)(?:\/[^/]*)?$/i,
]);

/**
 * Sub-expressions that introduce a taint source.
 *
 * A binding whose right-hand side contains any of these is tainted, and everything derived from a
 * tainted binding inherits the taint.
 */
export const TAINT_SOURCES: readonly RegExp[] = Object.freeze([
    /\$HOME\b/i,
    /\$\{HOME\}/i,
    /\$PSHOME\b/i,
    /\$PROFILE\b/i,
    /\$env:(?:USERPROFILE|HOMEPATH|HOME|SYSTEMDRIVE|SYSTEMROOT|WINDIR)\b/i,
    /\$\{env:(?:USERPROFILE|HOMEPATH|HOME|SYSTEMDRIVE|SYSTEMROOT|WINDIR)\}/i,
    /%(?:USERPROFILE|HOMEPATH|HOMEDRIVE|SYSTEMDRIVE|SYSTEMROOT|WINDIR)%/i,
    /\bos\s*\.\s*homedir\s*\(/,
    /\bprocess\s*\.\s*env\s*\.\s*(?:USERPROFILE|HOMEPATH|HOME|SystemDrive|SystemRoot|windir)\b/,
    /\bprocess\s*\.\s*env\s*\[\s*['"](?:USERPROFILE|HOMEPATH|HOME|SystemDrive|SystemRoot|windir)['"]\s*\]/,
]);

/**
 * Read-only automatic variables, each verified by probing `Set-Variable -ErrorAction Stop` and
 * keeping only the names PowerShell rejected with a read-only or constant error.
 *
 * Writable look-alikes are excluded on measurement: `$PROFILE`, `$PWD`, `$INPUT`, `$ARGS`,
 * `$MATCHES`, `$LASTEXITCODE`, `$PSITEM`, `$THIS` and `$STACKTRACE` all accept an assignment, so
 * they are not the failure being guarded. `$ARGS` in particular is the argument array every
 * wrapper in the parity library legitimately owns, and flagging it would reject correct code.
 * Type-constrained names are excluded for the same reason: assigning the right type succeeds and
 * is idiomatic, so reporting them would block code that works.
 */
export const READONLY_AUTOMATIC_VARIABLES: readonly string[] = Object.freeze([
    'home',
    'pshome',
    'pid',
    'host',
    'error',
    'executioncontext',
    'shellid',
    'psversiontable',
    'iswindows',
    'islinux',
    'ismacos',
    'psculture',
    'psuiculture',
    'psedition',
]);

/** Lookup form of the automatic-variable list, so membership tests stay O(1). */
const READONLY_AUTOMATIC_SET: ReadonlySet<string> = new Set(READONLY_AUTOMATIC_VARIABLES);

/** PowerShell delete cmdlets and their common aliases. */
const PS_DELETE_RE = /\b(?:Remove-Item|rm|del|erase|rd|rmdir)\b/i;

/** POSIX shell delete command. */
const SH_DELETE_RE = /\brm\b/;

/** JavaScript recursive-delete entry points; `rimraf`, `removeSync` and `rmtree` recurse by nature. */
const JS_DELETE_RE =
    /\b(?:rmSync|rimraf|removeSync)\s*\(|\bfs\s*\.\s*rm\s*\(|\bshutil\s*\.\s*rmtree\s*\(/;

/** JavaScript delete calls that need no recursion flag because they recurse by definition. */
const JS_INHERENTLY_RECURSIVE_RE = /\brimraf\b|\bremoveSync\b|\brmtree\b/;

/** Recursion may be decided at run time (`-Recurse:$flag`), so any mention counts. */
const PS_RECURSIVE_RE = /-Recurse|\s-[a-zA-Z]*[rR]\b/;

/** POSIX recursion flag, short or long form. */
const SH_RECURSIVE_RE = /(?:^|\s)(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/;

/** JavaScript recursion flag inside the options object. */
const JS_RECURSIVE_RE = /\brecursive\s*:\s*true\b/;

/** How far forward a multi-line JavaScript call may state `recursive: true`. */
const JS_STATEMENT_WINDOW = 6;

/**
 * Line prefixes that open something other than a statement.
 *
 * A comment opens with its marker; a string element opens with a quote. The container prefixes are
 * here because a fixture corpus writes its samples as array elements (`['rm -rf /']`), and an array
 * literal is never a delete statement: a real `Remove-Item` or `rm` never begins with a bracket,
 * brace or comma. Without this, the guard reported its own negative corpus.
 */
const NON_STATEMENT_PREFIX_RE = /^(?:#|\/\/|\*|["'`]|\[["'`])/;

/** Powershell automatic-variable write shapes: plain, compound, cast, foreach and multi-assign. */
const PS_ASSIGN_RE = /\$([A-Za-z_][A-Za-z0-9_]*)\s*(?:=[^=]|\+=|-=|\*=)/g;
const PS_FOREACH_RE = /foreach\s*\(\s*\$([A-Za-z_][A-Za-z0-9_]*)\s+in\b/gi;
const PS_CAST_ASSIGN_RE = /\[[A-Za-z_][A-Za-z0-9_.[\]]*\]\s*\$([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
const PS_MULTI_ASSIGN_RE = /\$([A-Za-z_][A-Za-z0-9_]*)\s*,[^=\r\n]*=/g;

/** Binding shapes that carry provenance: assignment, the three loop forms, and callbacks. */
const ASSIGN_RE = /(?:^|[\s(,])(?:const|let|var)?\s*\$?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\r\n]*)$/;
const PS_LOOP_RE = /foreach\s*\(\s*\$([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^)]*)/i;
const SH_LOOP_RE = /\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;\r\n]*)/;
const JS_LOOP_RE = /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s+of\s+([^)]*)\)/;
const JS_EACH_RE = /\.\s*forEach\s*\(\s*\(?\s*([A-Za-z_][A-Za-z0-9_]*)/;

/** Upper bound on identifiers visited while following one provenance chain. */
const TAINT_VISIT_LIMIT = 64;

/** A PowerShell binding that writes a read-only automatic variable. */
export interface AutomaticVariableShadow {
    /** Variable name as written, without the leading `$`. */
    readonly name: string;
    /** One-based line number of the offending write. */
    readonly line: number;
}

/**
 * Resolves the lexical dialect of a file path.
 *
 * @param filePath - Repository-relative or absolute path.
 * @returns The dialect, or null when the file carries no delete syntax this layer judges.
 */
export function dialectOf(filePath: string): DeleteDialect | null {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.ps1') || lower.endsWith('.psm1')) return 'powershell';
    if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'shell';
    if (/\.(?:ts|tsx|js|mjs|cjs|mts|cts)$/.test(lower)) return 'javascript';
    return null;
}

/**
 * Reports whether a line opens a comment or a string element instead of a statement.
 *
 * Self-probe corpora and message tables both keep executable-looking text inside quotes, and must
 * not be read as code.
 *
 * @param trimmedLine - Line with outer whitespace removed.
 * @returns True when the line must not be parsed as an executable statement.
 */
export function isNonStatementLine(trimmedLine: string): boolean {
    return trimmedLine === '' || NON_STATEMENT_PREFIX_RE.test(trimmedLine);
}

/** One step of the argument tokenizer's lexical state. */
interface TokenizerState {
    /** Token text accumulated so far. */
    current: string;
    /** Bracket nesting depth; a space only separates tokens at depth zero. */
    depth: number;
    /** Open quote character, or the empty string when outside a literal. */
    quote: string;
}

/** Characters that open a quoted literal; each is closed by itself. */
const QUOTE_OPENERS: ReadonlySet<string> = new Set(['"', "'"]);

/** Characters that raise the bracket nesting depth. */
const DEPTH_OPENERS: ReadonlySet<string> = new Set(['(', '[', '{']);

/** Characters that lower the bracket nesting depth. */
const DEPTH_CLOSERS: ReadonlySet<string> = new Set([')', ']', '}']);

/**
 * Applies one character to the tokenizer state.
 *
 * Extracted so the loop body stays a flat dispatch: the quote branch, then the bracket and
 * separator branch, then the accumulate branch. Character classes are set lookups rather than
 * `||` chains so the predicate cost stays flat as the syntax grows.
 *
 * @param state - Mutable lexical state.
 * @param char - Character to consume.
 * @param tokens - Token accumulator the state flushes into.
 * @returns Nothing; the state and the accumulator carry the result.
 */
function consumeTokenChar(state: TokenizerState, char: string, tokens: string[]): void {
    if (state.quote !== '') {
        state.current += char;
        if (char === state.quote) state.quote = '';
        return;
    }
    if (QUOTE_OPENERS.has(char)) {
        state.quote = char;
        state.current += char;
        return;
    }
    if (DEPTH_OPENERS.has(char)) state.depth += 1;
    if (DEPTH_CLOSERS.has(char)) state.depth = Math.max(0, state.depth - 1);
    const atTokenBoundary = char === ' ' && state.depth === 0;
    if (atTokenBoundary) {
        if (state.current !== '') tokens.push(state.current);
        state.current = '';
        return;
    }
    state.current += char;
}

/**
 * Splits an argument list into tokens, honouring quotes and bracket nesting.
 *
 * @param text - Argument text.
 * @returns Tokens in source order.
 */
export function splitArguments(text: string): string[] {
    const tokens: string[] = [];
    const state: TokenizerState = { current: '', depth: 0, quote: '' };
    for (const char of text) consumeTokenChar(state, char, tokens);
    if (state.current !== '') tokens.push(state.current);
    return tokens;
}

/**
 * Extracts the operand of a PowerShell recursive delete.
 *
 * @param line - Source line.
 * @returns The operand expression, an empty string when the delete names none, or null when the
 *   line is not a recursive delete.
 */
function parsePowerShellOperand(line: string): string | null {
    if (!PS_DELETE_RE.test(line) || !PS_RECURSIVE_RE.test(line)) return null;
    const command = /\b(?:Remove-Item|rm|del|erase|rd|rmdir)\b([\s\S]*)/i.exec(line);
    if (!command) return null;
    const tokens = splitArguments(command[1].replace(/[|;].*$/, '').trim());
    const namedIndex = tokens.findIndex((token) => /^-(?:LiteralPath|Path|LP)$/i.test(token));
    if (namedIndex >= 0) {
        const next = tokens[namedIndex + 1];
        return next !== undefined && !next.startsWith('-') ? next.split(',')[0].trim() : '';
    }
    const positional = tokens.find((token) => !token.startsWith('-'));
    return (positional ?? '').split(',')[0].trim();
}

/**
 * Extracts the operand of a POSIX shell recursive `rm`.
 *
 * @param line - Source line.
 * @returns The first operand, an empty string when none is named, or null when the line is not a
 *   recursive delete.
 */
function parseShellOperand(line: string): string | null {
    if (!SH_DELETE_RE.test(line) || !SH_RECURSIVE_RE.test(line)) return null;
    const command = /\brm\b([\s\S]*)/.exec(line);
    if (!command) return null;
    const tokens = splitArguments(command[1].replace(/[|;&].*$/, '').trim());
    return tokens.find((token) => !token.startsWith('-')) ?? '';
}

/**
 * Extracts the operand of a JavaScript recursive delete.
 *
 * The recursion flag may sit on a later line of the same call, so a forward window is scanned.
 *
 * @param lines - File lines.
 * @param index - Zero-based index of the candidate line.
 * @returns The first argument expression, an empty string when none is named, or null when the
 *   line is not a recursive delete.
 */
function parseJavaScriptOperand(lines: readonly string[], index: number): string | null {
    const line = lines[index];
    if (line === undefined || !JS_DELETE_RE.test(line)) return null;
    if (!JS_INHERENTLY_RECURSIVE_RE.test(line)) {
        const window = lines.slice(index, index + JS_STATEMENT_WINDOW).join(' ');
        if (!JS_RECURSIVE_RE.test(window)) return null;
    }
    const open = line.indexOf('(');
    if (open < 0) return null;
    const inner = line.slice(open + 1).replace(/\)\s*[;,)]?\s*$/, '');
    const target = splitArguments(inner)[0];
    return target === undefined ? '' : target.replace(/,$/, '').trim();
}

/**
 * Extracts the operand of a recursive delete in the given dialect.
 *
 * @param lines - File lines.
 * @param index - Zero-based index of the candidate line.
 * @param dialect - Lexical dialect of the file.
 * @returns The operand expression, an empty string when the delete names none, or null when the
 *   line is not a recursive delete.
 */
export function parseDeleteOperand(
    lines: readonly string[],
    index: number,
    dialect: DeleteDialect,
): string | null {
    if (dialect === 'powershell') return parsePowerShellOperand(lines[index] ?? '');
    if (dialect === 'shell') return parseShellOperand(lines[index] ?? '');
    return parseJavaScriptOperand(lines, index);
}

/**
 * Reads single-assignment bindings so an operand's provenance can be traced.
 *
 * Loop variables are bindings too, and they are the shape the motivating incident took: the delete
 * named a variable introduced by `foreach`, one alias away from the tainted collection.
 *
 * @param lines - File lines.
 * @returns Identifier to every right-hand side bound to it.
 */
export function collectBindings(lines: readonly string[]): Map<string, string[]> {
    const bindings = new Map<string, string[]>();
    const bind = (name: string, source: string): void => {
        const existing = bindings.get(name);
        if (existing === undefined) bindings.set(name, [source]);
        else existing.push(source);
    };
    for (const line of lines) {
        const assign = ASSIGN_RE.exec(line);
        if (assign) bind(assign[1], assign[2]);
        const psLoop = PS_LOOP_RE.exec(line);
        if (psLoop) bind(psLoop[1], psLoop[2]);
        const shLoop = SH_LOOP_RE.exec(line);
        if (shLoop) bind(shLoop[1], shLoop[2]);
        const jsLoop = JS_LOOP_RE.exec(line);
        if (jsLoop) bind(jsLoop[1], jsLoop[2]);
        const jsEach = JS_EACH_RE.exec(line);
        if (jsEach) bind(jsEach[1], line);
    }
    return bindings;
}

/**
 * Reports whether an expression mentions a taint source directly.
 *
 * @param expression - Source fragment.
 * @returns True when a home or root expression appears.
 */
export function mentionsTaintSource(expression: string): boolean {
    return TAINT_SOURCES.some((pattern) => pattern.test(expression));
}

/**
 * Expands one identifier into its bound right-hand sides, reporting a taint hit on the way.
 *
 * Extracted from the walk so the search stays a single loop over the queue. Inline, the three
 * nested loops (queue, identifiers, sources) were reported as an O(N^3) compute hotspot, and the
 * nesting made the bound on the walk harder to see than the work it does.
 *
 * @param name - Identifier to expand.
 * @param trail - Aliases that led to this identifier, nearest last.
 * @param bindings - Identifier to right-hand sides.
 * @param queue - Walk accumulator the expansions are pushed onto.
 * @returns The alias trail when a source was reached, otherwise null.
 */
function expandIdentifier(
    name: string,
    trail: string[],
    bindings: Map<string, string[]>,
    queue: Array<[string, string[]]>,
): string[] | null {
    const sources = bindings.get(name);
    if (sources === undefined) return null;
    const nextTrail = [...trail, name];
    for (const source of sources) {
        if (mentionsTaintSource(source)) return nextTrail;
        queue.push([source, nextTrail]);
    }
    return null;
}

/**
 * Reports whether an operand is, or is transitively derived from, a home or root expression.
 *
 * @param operand - Operand expression.
 * @param bindings - Identifier to right-hand sides.
 * @returns Identifiers that carried the taint, nearest first; empty when the operand is clean.
 */
export function taintChain(operand: string, bindings: Map<string, string[]>): string[] {
    if (mentionsTaintSource(operand)) return [];
    const seen = new Set<string>();
    const queue: Array<[string, string[]]> = [[operand, []]];
    let head = 0;
    while (head < queue.length && seen.size < TAINT_VISIT_LIMIT) {
        const [expression, trail] = queue[head++]!;
        for (const token of expression.matchAll(/\$?([A-Za-z_][A-Za-z0-9_]*)/g)) {
            const name = token[1];
            if (seen.has(name)) continue;
            seen.add(name);
            const hit = expandIdentifier(name, trail, bindings, queue);
            if (hit !== null) return hit;
        }
    }
    return [];
}

/**
 * Normalises an operand for comparison: quotes stripped, whitespace trimmed.
 *
 * @param operand - Raw operand.
 * @returns Normalised operand.
 */
function normalizeOperand(operand: string): string {
    return operand
        .trim()
        .replace(/^["'`]/, '')
        .replace(/["'`]$/, '')
        .trim();
}

/**
 * Classifies one delete operand.
 *
 * @param operand - Raw operand expression.
 * @param bindings - Identifier to right-hand sides.
 * @returns Rejection reason, or null when the operand is accounted for.
 */
export function classifyOperand(operand: string, bindings: Map<string, string[]>): string | null {
    if (operand.trim() === '') {
        return 'the delete names no operand, so the shell decides what it receives';
    }
    const normalized = normalizeOperand(operand);
    if (FORBIDDEN_OPERANDS.some((pattern) => pattern.test(normalized))) {
        return `'${normalized}' is a filesystem root, an ancestor directory, or a home/profile directory`;
    }
    // A source mentioned by the operand itself is the defect, not the start of a chain: `$HOME/out`
    // matches no forbidden shape and reaches no alias, so treating a direct mention as "already
    // accounted for" let the most common dangerous form through. The chain walk below returns an
    // empty list for a direct mention by design — it reports aliases, not the source itself.
    if (mentionsTaintSource(operand)) {
        return `'${normalized}' is built directly from a home/profile/root expression`;
    }
    const chain = taintChain(operand, bindings);
    if (chain.length > 0) {
        return `'${normalized}' derives from a home/profile/root expression through ${chain.join(' -> ')}`;
    }
    return null;
}

/**
 * Finds PowerShell bindings that shadow a read-only automatic variable.
 *
 * The write always throws. The defect is not the throw: it is that the surrounding script keeps
 * running with the name still holding its previous value, so every later read of that name
 * silently addresses a different object than the author intended.
 *
 * @param lines - File lines.
 * @returns One entry per offending binding, deduplicated by line and name.
 */
export function findAutomaticVariableShadows(lines: readonly string[]): AutomaticVariableShadow[] {
    const shadows: AutomaticVariableShadow[] = [];
    const seen = new Set<string>();
    const report = (name: string, line: number): void => {
        const folded = name.toLowerCase();
        if (!READONLY_AUTOMATIC_SET.has(folded)) return;
        const key = `${line}:${folded}`;
        if (seen.has(key)) return;
        seen.add(key);
        shadows.push({ name, line });
    };
    lines.forEach((line, index) => {
        if (isNonStatementLine(line.trim())) return;
        const lineNumber = index + 1;
        for (const match of line.matchAll(PS_ASSIGN_RE)) report(match[1], lineNumber);
        for (const match of line.matchAll(PS_FOREACH_RE)) report(match[1], lineNumber);
        for (const match of line.matchAll(PS_CAST_ASSIGN_RE)) report(match[1], lineNumber);
        for (const match of line.matchAll(PS_MULTI_ASSIGN_RE)) report(match[1], lineNumber);
    });
    return shadows;
}
