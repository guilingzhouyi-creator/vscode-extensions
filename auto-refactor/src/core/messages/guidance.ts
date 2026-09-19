/**
 * Module: Core Messages - Agent Engineering Guidance & Guardrail Prompts
 * File Path: src/core/messages/guidance.ts
 * Architecture Role: Static prompt-template catalog read by the agent constraint generator; it
 *   shapes standard English instructions for automated AI agents and code generators but performs
 *   no constraint evaluation itself.
 * Dependencies & Triggers: No imports; loaded through ./index.ts or the messages barrel. The
 *   agentConstraintGenerator in src/core/guidance reads its templates when the API's
 *   queryAgentConstraints or dual-track fast path builds per-file local guardrails.
 * Responsibilities: Provide four layer hard constraints, three recommendations, four prompt
 *   section titles, and four pure render helpers that interpolate file, scope, rule, line, and
 *   message values into deterministic English guidance strings.
 * Exit Semantics & Design Rationale: Constant catalog plus pure functions; under declared types
 *   rendering cannot throw or mutate shared state, so prompt generation degrades to plain text
 *   rather than aborting a scan. Centralizing wording prevents each generator from inventing
 *   divergent policy text and keeps the guardrail contract auditable in one leaf module.
 */

/**
 * Agent guardrail prompt and render-helper catalog.
 *
 * Exposes four layer hard constraints, three engineering recommendations, fixed prompt
 * section titles, and helpers that render local guardrail headings, scope labels, and
 * violation or pitfall lines. String entries are immutable policy text; helpers interpolate
 * caller-provided file paths, scopes, rules, line numbers, and messages verbatim and omit
 * an undefined optional layer label. All rendering is synchronous, deterministic, and
 * side-effect-free, with no I/O, caching, or thrown errors.
 */
export const GuidanceMessages = {
    // Layer Constraints
    /** Hard constraint: domain code must not import infrastructure, DB, or UI modules. */
    DOMAIN_LAYER_HARD:
        '[Architecture Boundary] Currently operating within the Domain layer. Importing Infrastructure, DB drivers, or UI frontend modules is strictly prohibited.',
    /** Hard constraint: business logic stays pure or explicitly state-machine driven. */
    DOMAIN_PURITY_HARD:
        '[Business Purity] Business logic must remain pure or follow explicit state machines. Direct system I/O, network requests, or non-deterministic calls are prohibited.',
    /** Hard constraint: infrastructure owns external integration and I/O adaptation. */
    INFRA_RESPONSIBILITY_HARD:
        '[Infrastructure Role] Responsible solely for external system integration and I/O adaptation. Writing core business formulas or random calculation models here is prohibited.',
    /** Hard constraint: interface code stays presentational and routes through use cases. */
    INTERFACE_BOUNDARY_HARD:
        '[Interface Boundary] Responsible only for presentation and user interaction. Directly bypassing use cases to invoke infrastructure or calculating business rules here is prohibited.',

    // Recommendations
    /** Recommendation: use modern, strongly typed language constructs. */
    RECOMMEND_MODERN_TYPES:
        'Adhere to modern semantics and strong typing. Unsafe any escapes and obsolete deprecated language features are prohibited.',
    /** Recommendation: avoid transient heap allocations inside tight loops. */
    RECOMMEND_ZERO_LOOP_ALLOC:
        'Prohibit transient heap allocations inside tight loops (avoid repeated new instantiations or deep copies); reuse or pre-allocate collections.',
    /** Recommendation: document public symbols with intent-revealing comments. */
    RECOMMEND_DOC_INTENT:
        'All public symbols must provide concise, intent-revealing documentation comments free from transient ticket jargon.',

    // Prompt Rendering Section Titles
    /**
     * Render the H3 heading that introduces per-file local guardrails.
     *
     * @param filePath - File path interpolated into the heading exactly as supplied.
     * @returns Markdown H3 heading naming the guardrail scope.
     */
    TITLE_LOCAL_GUARDRAILS: (filePath: string) =>
        `### 🛡️ [Agent Local Engineering Guardrails: ${filePath}]`,
    /**
     * Render the blockquote that identifies the target scope and optional architecture layer.
     *
     * @param scope - Human-readable scope label inserted into the blockquote.
     * @param layer - Optional architecture layer; when omitted, the layer segment is skipped.
     * @returns Markdown blockquote line for the prompt header.
     */
    TARGET_SCOPE_LABEL: (scope: string, layer?: string) =>
        `> **Target Scope**: ${scope}${layer ? ` | **Architectural Layer**: \`${layer}\`` : ''}`,
    /** Fixed H4 heading for the hard architectural and engineering contract section. */
    SECTION_HARD_CONSTRAINTS: '#### 1. Hard Architectural & Engineering Contracts',
    /** Fixed H4 heading for the historical regression and pitfall section. */
    SECTION_HISTORICAL_PITFALLS: '#### 2. Historical Regressions & Pitfalls to Avoid',
    /** Fixed H4 heading for active review violations found in the target scope. */
    SECTION_FREQUENT_VIOLATIONS: '#### 3. Known Active Review Violations in this Scope',
    /** Fixed H4 heading for recommended implementation patterns. */
    SECTION_RECOMMENDED_PATTERNS: '#### 4. Recommended Implementation Patterns',

    /**
     * Render one active review violation as a single prompt bullet line.
     *
     * @param rule - Rule code or identifier shown in square brackets.
     * @param line - Source line number or symbolic location shown after "line".
     * @param message - Analyzer-provided violation text inserted after the colon.
     * @returns Markdown line pairing the rule location with its message.
     */
    FORMAT_VIOLATION: (rule: string, line: number | string, message: string) =>
        `Rule [${rule}] (line ${line}): ${message}`,
    /**
     * Render one domain violation with rule and severity tier.
     *
     * @param rule - Rule identifier shown in square brackets.
     * @param severity - Severity tier shown in parentheses.
     * @param message - Analyzer-provided violation text inserted after the colon.
     * @returns Markdown line pairing the rule, severity, and message.
     */
    FORMAT_VIOLATION_WITH_SEVERITY: (rule: string, severity: string, message: string) =>
        `Rule [${rule}] (severity: ${severity}): ${message}`,
    /**
     * Render one historical regression line for the pitfalls prompt section.
     *
     * @param kind - Regression category or kind label shown in parentheses.
     * @param message - Historical pitfall description inserted after the colon.
     * @returns Markdown line pairing the regression kind with its description.
     */
    FORMAT_PITFALL: (kind: string, message: string) =>
        `Historical regression (${kind}): ${message}`,
} as const;
