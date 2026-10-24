/**
 * Module: Core Messages — Dual-Track Test Topology Findings Catalog
 * File Path: src/core/messages/dual-track-test.ts
 * Architecture Role: Single source of truth for dual-track test topology findings,
 *   prescriptive action identifiers, and remediation rationales.
 * Dependencies & Triggers: Zero external dependencies; consumed by dual-track-test-evaluator.
 * Responsibilities:
 *   1. Define standardized message formatters for prohibited cross-language embedded tests.
 *   2. Define messages for tail isolation violations and conditional compilation bleed.
 *   3. Define messages for missing machine-readable agent intent specifications.
 * Exit Semantics & Design Rationale: Pure formatters and static rationale strings.
 */

/**
 * Standardized messages, actions, and rationales for dual-track test topology evaluation.
 */
export const DualTrackTestMessages = {
    // 1. Prohibited embedded test zone in forbidden language
    PROHIBITED_EMBEDDED_ZONE_MESSAGE: (ext: string): string =>
        `Embedded test code domain prohibited in ${ext} production source file. ` +
        `Enforce explicit test file topology (e.g. create dedicated *.test.ts).`,
    PROHIBITED_EMBEDDED_ZONE_RATIONALE: (filePath: string): string =>
        `Extract embedded test assertions from '${filePath}' into an explicit ` +
        `standalone test suite to maintain clean architectural boundaries.`,

    // 2. Embedded test not tail-isolated
    INTERLEAVED_TEST_ZONE_MESSAGE:
        'Embedded test zone is interleaved before production code. ' +
        'Move embedded test zone to the end of the file.',
    INTERLEAVED_TEST_ZONE_RATIONALE:
        'Relocate test block to file tail to maintain modern zone ' + 'partitioning discipline.',

    // 3. Rust embedded tests missing #[cfg(test)]
    RUST_MISSING_CFG_TEST_MESSAGE:
        'Rust embedded test module missing #[cfg(test)] conditional compilation ' +
        'attribute; risks production binary code bleed.',
    RUST_MISSING_CFG_TEST_RATIONALE:
        'Add #[cfg(test)] attribute to isolate test suite from release builds.',

    // 4. Missing structured agent intent
    MISSING_INTENT_MESSAGE:
        'Embedded unit tests lack structured doc comments (Case/Assertion), ' +
        'inhibiting autonomous agent regression verification.',
    MISSING_INTENT_RATIONALE:
        "Add doc comments with 'Case:' and 'Assertion:' for machine-readability.",
} as const;
