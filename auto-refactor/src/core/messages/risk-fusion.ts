/**
 * Module: Core Messages — Cross-Plane Risk Fusion Rationale Catalog
 * File Path: src/core/messages/risk-fusion.ts
 * Architecture Role: Single source of truth for dual-plane risk fusion arbitration
 *   verdicts, corroboration rationales, and churn modulation explanations.
 * Dependencies & Triggers: Zero external dependencies; consumed by risk-fusion-engine.
 * Responsibilities:
 *   1. Format dual-plane confirmed risk resonance explanations.
 *   2. Format single-sided noise dampening and severity downgrade explanations.
 *   3. Format hidden runtime bottleneck escalation explanations.
 *   4. Format topological churn relaxation and amplification annotations.
 * Exit Semantics & Design Rationale: Pure formatter functions; side-effect free and total.
 */

/**
 * Standardized risk fusion arbitration rationale formatters.
 */
export const RiskFusionRationales = {
    /** Telemetry absent: fallback to static inference with neutral dynamic baseline. */
    TELEMETRY_UNAVAILABLE:
        'Dynamic telemetry unavailable; risk inferred from static structural ' +
        'analysis with neutral dynamic baseline.',

    /** Dual confirmation: static risk corroborated by dynamic execution evidence. */
    DUAL_CONFIRMED: (staticRisk: number, dynamicRisk: number): string =>
        `Dual-plane confirmed: High static structural risk (S=${staticRisk.toFixed(1)}) ` +
        `corroborated by runtime hotspot evidence (D=${dynamicRisk.toFixed(1)}). Risk amplified.`,

    /** Single-sided dampening: static complexity refuted by cold runtime invocation. */
    SINGLE_SIDED_DAMPENED: (staticRisk: number, dynamicRisk: number): string =>
        `Single-sided dampening: High static complexity (S=${staticRisk.toFixed(1)}) ` +
        `refuted by cold runtime invocation evidence (D=${dynamicRisk.toFixed(1)}). Severity downgraded.`,

    /** Hidden runtime bottleneck: low static penalty overridden by severe runtime contention. */
    HIDDEN_BOTTLENECK: (staticRisk: number, dynamicRisk: number): string =>
        `Hidden runtime bottleneck: Low static penalty (S=${staticRisk.toFixed(1)}) ` +
        `overridden by severe runtime latency/contention hotspot (D=${dynamicRisk.toFixed(1)}).`,

    /** Standard fusion with balanced static and dynamic indicators. */
    STANDARD_FUSION: 'Standard dual-plane fusion across static and dynamic indicators.',

    /** Churn relaxation annotation for stable low-frequency failure modules. */
    CHURN_RELAXATION: (multiplier: number): string =>
        ` Churn relaxation applied for stable code (${multiplier.toFixed(2)}x).`,

    /** Churn amplification annotation for active defect-prone hotspots. */
    CHURN_AMPLIFICATION: (multiplier: number): string =>
        ` Churn amplification applied for active hotspot (${multiplier.toFixed(2)}x).`,
} as const;
