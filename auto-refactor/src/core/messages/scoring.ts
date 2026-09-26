/**
 * Module: Core Engine — Centralized Multi-Dimensional Quality Scoring Rationale Messages
 * File Path: src/core/messages/scoring.ts
 * Architecture Role: Dependency-free leaf message catalog; single source of the English deduction
 *   rationales for the 10 quality dimensions consumed by the quality scorer
 * Dependencies & Triggers: Imports nothing, is re-exported by src/core/messages/index.ts, and is
 *   read by src/core/scoring/qualityScorer.ts whenever a scan records a scoring deduction
 * Responsibilities: Map architecture, semantic-purity, security, performance, standardization,
 *   modernity, maintainability, comment-quality, duplication and technical-debt violations to
 *   formatter functions that interpolate counts, nesting depth and analyzer text into a rationale
 * Exit Semantics & Design Rationale: Pure `as const` object of synchronous formatters, total and
 *   side-effect free for valid typed inputs, so identical findings always produce identical
 *   report text and wording changes stay localized to one auditable file
 */

/**
 * Quality-scoring rationale formatter catalog.
 *
 * Maps analyzer finding kinds to pure formatter functions that produce the English rationale
 * text attached to one scoring deduction. Each formatter accepts either analyzer-provided
 * message text or a numeric metric and interpolates it into a fixed sentence; no validation,
 * truncation, or escaping is performed, so callers must supply display-ready values.
 * Formatters are synchronous and side-effect-free, and valid calls cannot throw.
 */
export const ScoringRationales = {
    // 1. Architecture Consistency
    /**
     * Format the rationale for a credential exposed by a public DTO or contract.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the architecture-consistency dimension.
     */
    DTO_CREDENTIAL_LEAK: (msg: string) =>
        `Architectural data security leak (public contract exposes confidential credentials): ${msg}`,
    /**
     * Format the rationale for a layer-boundary or dependency-inversion violation.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the architecture-consistency dimension.
     */
    LAYER_CONSTRAINT_VIOLATION: (msg: string) =>
        `Architectural layering constraint violation: ${msg}`,
    /**
     * Format the rationale for a newly introduced module dependency cycle.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the architecture-consistency dimension.
     */
    CIRCULAR_DEPENDENCY: (msg: string) => `Circular module dependency introduced: ${msg}`,
    /**
     * Format the rationale for a general architecture-design rule violation.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the architecture-consistency dimension.
     */
    ARCHITECTURE_DESIGN_VIOLATION: (msg: string) => `Architectural design violation: ${msg}`,
    /**
     * Format the rationale for a module with too many top-level exported symbols.
     *
     * @param count - Number of top-level exports reported by the analyzer.
     * @returns Deduction rationale naming the observed export count.
     */
    EXCESSIVE_EXPORTED_SYMBOLS: (count: number) =>
        `Module defines ${count} top-level exported symbols, exceeding single-responsibility cohesion boundaries`,

    // 2. Semantic Purity
    /**
     * Format the rationale for a type-safety escape, such as an unsafe cast.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the semantic-purity dimension.
     */
    TYPE_SAFETY_ESCAPE: (msg: string) => `Type system safety escape: ${msg}`,
    /**
     * Format the rationale for an unreachable branch or dead-code finding.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the semantic-purity dimension.
     */
    UNREACHABLE_DEAD_CODE: (msg: string) => `Unreachable branch or dead code: ${msg}`,
    /**
     * Format the rationale for an unused local binding or import.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the semantic-purity dimension.
     */
    UNUSED_BINDING_OR_IMPORT: (msg: string) => `Unused binding or import: ${msg}`,

    // 3. Code Security
    /**
     * Format the rationale for arbitrary code execution through eval or Function.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the code-security dimension.
     */
    CRITICAL_CODE_EXECUTION: (msg: string) =>
        `Critical arbitrary code execution vulnerability (eval/Function): ${msg}`,
    /**
     * Format the rationale for shell command injection through string concatenation.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the code-security dimension.
     */
    CRITICAL_COMMAND_INJECTION: (msg: string) =>
        `Critical command injection vulnerability (shell string concatenation): ${msg}`,
    /**
     * Format the rationale for prototype pollution through `__proto__` mutation.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the code-security dimension.
     */
    PROTOTYPE_POLLUTION_RISK: (msg: string) =>
        `Prototype pollution vulnerability (__proto__ mutation): ${msg}`,
    /**
     * Format the rationale for weak randomness used in a security context.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the code-security dimension.
     */
    INSECURE_RANDOMNESS_RISK: (msg: string) =>
        `Weak pseudo-random number generator (Math.random in security context): ${msg}`,
    /**
     * Format the rationale for deprecated collision-prone hash algorithms.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the code-security dimension.
     */
    BROKEN_HASH_ALGORITHM: (msg: string) =>
        `Deprecated collision-vulnerable hash algorithm (MD5/SHA1): ${msg}`,
    /**
     * Format the rationale for a file path operation that may allow traversal.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the code-security dimension.
     */
    PATH_TRAVERSAL_RISK: (msg: string) =>
        `Potential path traversal vulnerability (unverified file path operation): ${msg}`,
    /**
     * Format the rationale for credentials written to diagnostic log output.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the code-security dimension.
     */
    SENSITIVE_DATA_LOGGED: (msg: string) =>
        `Plaintext sensitive credentials detected in diagnostic log output: ${msg}`,
    /**
     * Format the rationale for a security flaw without a more specific classification.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the code-security dimension.
     */
    GENERIC_SECURITY_RISK: (msg: string) => `Security vulnerability flaw: ${msg}`,
    /**
     * Format the rationale for a hardcoded secret or authentication credential.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the code-security dimension.
     */
    HARDCODED_CREDENTIAL: (msg: string) =>
        `Hardcoded secret or authentication credential in source code: ${msg}`,
    /**
     * Format the rationale for an injection risk or unsanitized dangerous operation.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the code-security dimension.
     */
    POTENTIAL_INJECTION_RISK: (msg: string) =>
        `Potential injection risk or unsanitized dangerous operation: ${msg}`,

    // 4. Performance Efficiency
    /**
     * Format the rationale for a transient heap allocation inside a hot loop.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the performance-efficiency dimension.
     */
    TRANSIENT_LOOP_ALLOCATION: (msg: string) => `Transient heap allocation in hot loop: ${msg}`,
    /**
     * Format the rationale for a potential memory leak or unbounded buffer.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the performance-efficiency dimension.
     */
    MEMORY_LEAK_RISK: (msg: string) => `Potential memory leak or unbounded buffering: ${msg}`,
    /**
     * Format the rationale for an inefficient algorithmic path.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the performance-efficiency dimension.
     */
    INEFFICIENT_ALGORITHM_PATH: (msg: string) =>
        `Performance penalty or inefficient algorithmic path: ${msg}`,

    // 5. Standardization
    /**
     * Format the rationale for a naming convention that deviates from project style.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the standardization dimension.
     */
    NAMING_CONVENTION_VIOLATION: (msg: string) =>
        `Naming convention deviates from engineering style standards: ${msg}`,
    /**
     * Format the rationale for a file that exceeds the repository line-count limit.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the standardization dimension.
     */
    LINE_COUNT_OVERFLOW: (msg: string) =>
        `Single file line count exceeds repository limits: ${msg}`,

    // 6. Modernity
    /**
     * Format the rationale for a deprecated or obsolete language feature or API.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the modernity dimension.
     */
    DEPRECATED_LANGUAGE_FEATURE: (msg: string) =>
        `Usage of deprecated or obsolete language feature/API: ${msg}`,

    // 7. Maintainability
    /**
     * Format the rationale for a function whose cyclomatic complexity is too high.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the maintainability dimension.
     */
    CYCLOMATIC_COMPLEXITY_HIGH: (msg: string) => `Excessive function cyclomatic complexity: ${msg}`,
    /**
     * Format the rationale for deeply nested control-flow blocks.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the maintainability dimension.
     */
    NESTED_BLOCK_OVERFLOW: (msg: string) => `Deeply nested control flow blocks: ${msg}`,
    /**
     * Format the rationale for a measured nesting depth that exceeds the configured limit.
     *
     * @param depth - Maximum nesting depth reported by the analyzer.
     * @returns Deduction rationale naming the observed depth and extraction guidance.
     */
    MAX_NESTING_DEPTH_OVERFLOW: (depth: number) =>
        `Maximum nesting depth is ${depth}; consider extracting helper functions`,
    /**
     * Format the rationale for unbounded deep control-flow nesting exceeding contextual budget.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the maintainability dimension.
     */
    UNBOUNDED_NESTING: (msg: string) =>
        `Unbounded deep control-flow nesting exceeding contextual budget: ${msg}`,
    /**
     * Format the rationale for deep control-flow escape over long cognitive distance.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the maintainability dimension.
     */
    DEEP_CONTROL_ESCAPE: (msg: string) =>
        `Deep control-flow escape over long cognitive distance: ${msg}`,
    /**
     * Format the rationale for mechanical decomposition and trivial forwarding wrappers.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the maintainability dimension.
     */
    MECHANICAL_SPLITTING: (msg: string) =>
        `Mechanical function splitting and trivial forwarding wrappers: ${msg}`,
    /**
     * Format the rationale for state machine structural dispatch discipline violations.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the maintainability dimension.
     */
    STATE_MACHINE_DISCIPLINE: (msg: string) =>
        `State machine structural dispatch discipline violation: ${msg}`,

    // 8. Comment Quality
    /**
     * Format the rationale for banned transient task jargon in a comment.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the comment-quality dimension.
     */
    BANNED_JARGON_IN_COMMENT: (msg: string) =>
        `Comment contains banned transient task jargon or ephemeral ticket markers: ${msg}`,
    /**
     * Format the rationale for a public API that lacks documentation commentary.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the comment-quality dimension.
     */
    MISSING_PUBLIC_API_DOC: (msg: string) =>
        `Public exported API lacks required documentation commentary: ${msg}`,
    /**
     * Format the rationale for substandard or tautological comment quality.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the comment-quality dimension.
     */
    SUBSTANDARD_COMMENT_QUALITY: (msg: string) =>
        `Substandard comment quality or tautological repetition: ${msg}`,

    // 9. Duplication
    /**
     * Format the rationale for a duplicated literal value definition.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the duplication dimension.
     */
    DUPLICATE_LITERAL: (msg: string) => `Duplicate literal value definition: ${msg}`,
    /**
     * Format the rationale for a hardcoded magic number.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the duplication dimension.
     */
    MAGIC_NUMBER: (msg: string) => `Hardcoded magic number literal: ${msg}`,
    /**
     * Format the rationale for a hardcoded string literal.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the duplication dimension.
     */
    HARDCODED_STRING: (msg: string) => `Hardcoded string literal: ${msg}`,

    // 10. Technical Debt Risk
    /**
     * Format the rationale for an error-severity technical debt defect.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the technical-debt-risk dimension.
     */
    ERROR_TECH_DEBT: (msg: string) => `Severe technical debt defect (error severity): ${msg}`,
    /**
     * Format the rationale for a warning-severity technical debt risk.
     *
     * @param msg - Analyzer finding text embedded after the rationale prefix.
     * @returns Deduction rationale for the technical-debt-risk dimension.
     */
    WARNING_TECH_DEBT: (msg: string) => `Potential technical debt risk (warning severity): ${msg}`,

    // 11. Modern Review Capabilities
    UNBOUNDED_DATA_QUERY: (msg: string) => `Unbounded data query on online request path: ${msg}`,
    N_PLUS_ONE_QUERY: (msg: string) => `Iterative N+1 query pattern detected in loop: ${msg}`,
    REDUNDANT_SERIALIZATION: (msg: string) => `Redundant data serialization cycle: ${msg}`,
    TEST_INTEGRITY_ILLUSION: (msg: string) =>
        `Test integrity illusion or obsolete contract: ${msg}`,
    ORPHANED_SKIPPED_TEST: (msg: string) => `Orphaned skipped test in core business domain: ${msg}`,
    TAUTOLOGICAL_ASSERTION: (msg: string) => `Tautological or non-verifying test assertion: ${msg}`,
    LOW_TEST_DENSITY: (msg: string) =>
        `Low effective modern test density or contract coverage: ${msg}`,
    IN_FUNCTION_IMPORT: (msg: string) => `Unaudited ad-hoc in-function import: ${msg}`,
    UNMANAGED_RESOURCE: (msg: string) => `Unmanaged hardcoded external resource or URL: ${msg}`,
    HEADLESS_BOUNDARY_VIOLATION: (msg: string) =>
        `UI framework leak in headless business domain: ${msg}`,
    CROSS_DOMAIN_BYPASS: (msg: string) => `Cross-domain private implementation bypass: ${msg}`,
    MUTABLE_GLOBAL_COUPLING: (msg: string) =>
        `Implicit shared mutable global state coupling: ${msg}`,
    CROSS_FUNCTION_COMPLEXITY: (msg: string) =>
        `Unbounded cross-function polynomial time complexity: ${msg}`,
    UNBOUNDED_RECURSION: (msg: string) =>
        `Potential unbounded recursion without base-case guard: ${msg}`,
    NESTED_CONSTANT: (msg: string) =>
        `Nested constant anti-pattern or redundant constant aliasing: ${msg}`,

    // 12. Standard Library & Systems Runtime Verification
    STDLIB_PANIC_ESCAPE: (msg: string) =>
        `Public standard library interface escapes with unhandled panic/unwrap: ${msg}`,
    STDLIB_IMPLICIT_ALLOC: (msg: string) =>
        `Implicit dynamic heap allocation in no_std bare-metal runtime environment: ${msg}`,
    STDLIB_UNPROVEN_UNSAFE: (msg: string) =>
        `Low-level unsafe block lacks mandatory // SAFETY: proof contract: ${msg}`,
    STDLIB_TIMING_LEAK: (msg: string) =>
        `Cryptographic comparison exhibits non-constant-time timing side-channel leak: ${msg}`,
    STDLIB_UNBOUNDED_RECURSION: (msg: string) =>
        `Core algorithm contains unbounded deep recursion without stack guard: ${msg}`,
    STDLIB_PORTABILITY_FALLBACK: (msg: string) =>
        `Platform-specific conditional compilation lacks compile_error fallback: ${msg}`,
    STDLIB_GENERIC_MISMATCH: (msg: string) =>
        `Standard library and system runtime specification check failed: ${msg}`,
} as const;
