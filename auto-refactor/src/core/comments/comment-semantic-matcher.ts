/**
 * Module: Core Engine - Comment-to-Code Semantic Duty Matcher
 * File Path: src/core/comments/comment-semantic-matcher.ts
 * Architecture Role: Verifies semantic alignment between documented duties and real execution;
 *   detects "comment lies" where comments contradict implementation side effects.
 * Dependencies & Triggers: Consumes comment-types; consumed by comments analyzer and scheduler.
 * Responsibilities: Parse documentation claims (e.g. pure utility, read-only, thread-safe);
 *   cross-check against code patterns (e.g. mutations, I/O, writes); emit mismatch findings.
 * Exit Semantics & Design Rationale: Never throws; fast regex-based AST surrogate matching.
 */

/** Finding record describing a divergence between comment claims and implementation */
export interface SemanticDutyMismatch {
    line: number;
    symbol: string;
    claimedContract: string;
    violationEvidence: string;
    message: string;
    suggestion: string;
}

/** Keywords asserting pure function and read-only behavior */
const PURE_DUTY_RE =
    /\b(?:pure\s+(?:function|utility|method)|(?:contract:\s*|is\s+)read-?only|read-?only\s+(?:contract|method|function)|side-?effect\s*free|zero\s+side\s*effects)\b|纯函数|无副作用/i;

/** Keywords asserting concurrency and thread safety */
const CONCURRENCY_DUTY_RE =
    /\b(thread-?safe|reentrant|atomic|mutex|lock)\b|并发安全|线程安全|原子/i;

/** Syntax patterns indicating state-mutating side effects */
const MUTATION_PATTERNS = [
    {
        pattern: /(?:this|self)\.\w+\s*=[^=]/,
        evidence: 'Object state mutation via this/self property assignment',
    },
    { pattern: /(?:global|window|process)\.\w+\s*=[^=]/, evidence: 'Global environment mutation' },
    {
        pattern: /\.(?:splice|push|pop|shift|unshift|delete)\b/,
        evidence: 'In-place collection mutation',
    },
    {
        pattern: /\bfs\.(?:writeFileSync|appendFileSync|rmSync)\b/,
        evidence: 'Synchronous disk I/O side effect',
    },
];

/**
 * Cross-checks documented function claims against actual implementation statements.
 *
 * @param symbol - Target function identifier
 * @param docText - Attached documentation comment text
 * @param functionBodyCode - Implementation source code body
 * @param startLine - Physical line number where declaration begins
 * @returns Array of detected semantic contract mismatches
 */
export function matchCommentCodeDuty(
    symbol: string,
    docText: string,
    functionBodyCode: string,
    startLine = 1,
): SemanticDutyMismatch[] {
    const mismatches: SemanticDutyMismatch[] = [];

    // 1. Claims pure/read-only contract, but mutates state or writes I/O
    if (PURE_DUTY_RE.test(docText)) {
        for (const { pattern, evidence } of MUTATION_PATTERNS) {
            if (pattern.test(functionBodyCode)) {
                mismatches.push({
                    line: startLine,
                    symbol,
                    claimedContract: 'pure_function',
                    violationEvidence: evidence,
                    message: `Function [${symbol}] documentation claims pure/read-only contract, but implementation contains side effects (${evidence}).`,
                    suggestion:
                        'Update documentation to reflect actual mutations or refactor implementation to avoid side effects.',
                });
                break;
            }
        }
    }

    // 2. Claims concurrency safety, but modifies unsynchronized shared variables
    if (CONCURRENCY_DUTY_RE.test(docText)) {
        if (/(?:let|var)\s+\w+\s*=|global\.\w+\s*=/i.test(functionBodyCode)) {
            mismatches.push({
                line: startLine,
                symbol,
                claimedContract: 'thread_safe',
                violationEvidence: 'Mutable non-atomic shared state assignment',
                message: `Function [${symbol}] documentation claims concurrency safety, but modifies unsynchronized shared variables.`,
                suggestion:
                    'Ensure locks or atomics protect mutable state or clarify concurrency limitations.',
            });
        }
    }

    return mismatches;
}
