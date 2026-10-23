/**
 * Module: Core Messages — Anti-Gaming Violation Diagnostics Catalog
 * File Path: src/core/messages/anti-gaming.ts
 * Architecture Role: Single source of truth for anti-gaming violation messages,
 *   remediation suggestions, and pattern-specific audit text.
 * Dependencies & Triggers: Zero external dependencies; consumed by antiGaming.
 * Responsibilities:
 *   1. Format anti-gaming messages for artificial function splitting, tautological tests,
 *      relocation padding, comment water-logging, naming entropy anomaly, tautological loops,
 *      and low-entropy token padding.
 *   2. Supply prescriptive suggestions for authentic, domain-focused refactorings.
 * Exit Semantics & Design Rationale: Pure formatters and static suggestions; side-effect free.
 */

/**
 * Standardized messages and actionable suggestions for anti-gaming violations.
 */
export const AntiGamingMessages = {
    // 1. Artificial Function Splitting
    ARTIFICIAL_SPLITTING_MESSAGE: (forwardingCount: number, effectiveDensity: number): string =>
        `Anti-gaming violation: detected artificial function splitting with ` +
        `${forwardingCount} trivial forwarding methods (density: ${effectiveDensity}).`,
    ARTIFICIAL_SPLITTING_SUGGESTION:
        'Avoid mechanically chopping cohesive logic into trivial forwarding wrappers; focus on domain cohesion.',

    // 2. Tautological Test Padding
    TAUTOLOGICAL_TEST_MESSAGE: (count: number): string =>
        `Anti-gaming violation: detected ${count} tautological non-verifying assertions ` +
        `inflating test coverage artificially.`,
    TAUTOLOGICAL_TEST_SUGGESTION:
        'Replace tautological assertions with real behavioral input/output assertions.',

    // 3. Artificial Relocation Padding
    RELOCATION_PADDING_MESSAGE: (relocatedCount: number): string =>
        `Anti-gaming violation: detected artificial relocation padding with ` +
        `${relocatedCount} constants moved across lines without functional or semantic changes.`,
    RELOCATION_PADDING_SUGGESTION:
        'Do not artificially move constants to inflate diff volume; pure relocations earn zero positive quality score.',

    // 4. Tautological Comment Padding
    TAUTOLOGICAL_COMMENT_MESSAGE: (effectiveCommentRatio: number): string =>
        `Detected tautological comment padding or water-logging (ECR: ${effectiveCommentRatio}).`,
    TAUTOLOGICAL_COMMENT_SUGGESTION:
        'Replace tautological line-by-line echoes with substantive design rationale and invariants.',

    // 5. Naming Entropy Anomaly
    NAMING_ENTROPY_MESSAGE: (entropy: number): string =>
        `Anti-gaming violation: detected low-entropy identifier sequence (entropy: ${entropy} bits/char).`,
    NAMING_ENTROPY_SUGGESTION:
        'Use meaningful semantic domain variable names instead of synthetic sequenced identifiers.',

    // 6. Tautological Traversal Padding
    TAUTOLOGICAL_TRAVERSAL_MESSAGE: (count: number): string =>
        `Anti-gaming violation: detected ${count} tautological empty traversal loops ` +
        `inflating iteration volume without state change.`,
    TAUTOLOGICAL_TRAVERSAL_SUGGESTION:
        'Remove vacuous empty traversal loops; loops must mutate domain state or execute purposeful side-effects.',

    // 7. Low Entropy Token Padding
    LOW_ENTROPY_TOKEN_MESSAGE: (totalLines: number, entropy: number): string =>
        `Anti-gaming violation: detected low-entropy token padding in large file ` +
        `(${totalLines} lines, H(T) = ${entropy} < 2.5 bits).`,
    LOW_ENTROPY_TOKEN_SUGGESTION:
        'Avoid inflating file volume with low-entropy repetitive tokens or repetitive dictionary definitions.',
} as const;
