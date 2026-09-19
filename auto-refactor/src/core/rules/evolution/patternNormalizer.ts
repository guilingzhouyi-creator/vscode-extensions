/**
 * Module: Core Rules — Evolution Pattern Normalizer
 * File Path: src/core/rules/evolution/patternNormalizer.ts
 * Architecture Role: Normalizes syntactical differences across programming languages into
 *   canonical structural AST patterns, enabling language-agnostic rule evaluation.
 * Dependencies & Triggers: Consumes types from ./types; called by evolution rules and candidate
 *   verification harnesses.
 * Responsibilities: Normalize function signatures, inspect transparent argument forwarding,
 *   detect pseudo-catch statements, and compute branching dispatch dispersion.
 * Exit Semantics & Design Rationale: Pure, stateless functions with linear complexity.
 */

/** Regular expression detecting explicit documented rationale in catch blocks. */
const DOCUMENTED_RATIONALE_RE =
    /\b(?:best-?effort|ignore[sd]?|intentional(?:ly)?|deliberate(?:ly)?|expected|by-?design)\b/i;

/** Regular expression identifying pseudo-catch or dummy no-op statements. */
const PSEUDO_CATCH_RE =
    /^(?:void\s*\(?0\)?|pass|\.\.\.|const\s+_\w*\s*=\s*\w+|let\s+_\w*\s*=\s*\w+|_\w*\s*=\s*\w+|null|undefined)\s*;?$/;

/**
 * Normalizes a function parameter list by stripping types and default values.
 *
 * @param paramStr - Raw parameter substring between parentheses.
 * @returns Clean list of parameter names without language-specific syntax.
 */
export function normalizeParameterNames(paramStr: string): string[] {
    const trimmed = paramStr.trim();
    if (!trimmed) {
        return [];
    }

    const rawTokens = trimmed.split(',');
    const results: string[] = [];

    for (const rawToken of rawTokens) {
        let token = rawToken.trim();
        if (!token || token === 'self' || token === '&self' || token === '&mut self') {
            continue;
        }
        // Strip default values (e.g. `foo = 10`)
        if (token.includes('=')) {
            token = token.split('=')[0].trim();
        }
        // Strip type annotations (e.g. `foo: string`, `mut foo: usize`)
        if (token.includes(':')) {
            token = token.split(':')[0].trim();
        }
        if (token.startsWith('mut ')) {
            token = token.slice(4).trim();
        }
        // Strip modifiers like readonly or public
        token = token.replace(/^(?:public|private|protected|readonly)\s+/, '');
        if (token) {
            results.push(token);
        }
    }

    return results;
}

/**
 * Checks if forwarded call arguments strictly match parameter names 1:1.
 *
 * @param params - Formal parameter names of the outer wrapper.
 * @param callArgsStr - Raw arguments passed to the inner callee.
 * @returns True if arguments strictly equal parameters without modification.
 */
export function isTransparentForwarding(params: string[], callArgsStr: string): boolean {
    const trimmed = callArgsStr.trim();
    const callArgs = trimmed ? trimmed.split(',').map((s) => s.trim()) : [];

    if (params.length !== callArgs.length) {
        return false;
    }

    for (let i = 0; i < params.length; i++) {
        const param = params[i];
        const arg = callArgs[i];
        if (arg !== param) {
            return false;
        }
    }

    return true;
}

/**
 * Checks whether a text snippet contains a documented rationale marker.
 *
 * @param text - Comment or explanation text.
 * @returns True if documented rationale is present.
 */
export function hasDocumentedRationale(text: string): boolean {
    return DOCUMENTED_RATIONALE_RE.test(text);
}

/**
 * Checks if a single statement inside a catch/except block is a pseudo-catch statement.
 *
 * @param statement - Statement text stripped of comments and whitespace.
 * @returns True if the statement represents dummy no-op handling.
 */
export function isPseudoCatchStatement(statement: string): boolean {
    const clean = statement.trim().replace(/;$/, '').trim();
    if (!clean) {
        return true;
    }
    return PSEUDO_CATCH_RE.test(clean);
}

/**
 * Inspects a body of code lines to count branching clauses in switch or if-else ladders.
 *
 * @param lines - Array of code lines in the function body.
 * @returns Count of distinct branch clauses and maximum statements in any branch.
 */
export function countBranchClauses(lines: readonly string[]): {
    branchCount: number;
    hasSwitch: boolean;
} {
    let branchCount = 0;
    let hasSwitch = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('switch ') || trimmed.startsWith('switch(')) {
            hasSwitch = true;
        }
        if (trimmed.startsWith('case ') || trimmed.startsWith('match ')) {
            branchCount++;
        } else if (
            trimmed.startsWith('else if ') ||
            trimmed.startsWith('elif ') ||
            trimmed.startsWith('else if(')
        ) {
            branchCount++;
        }
    }

    return { branchCount, hasSwitch };
}
