/**
 * Module: Core Engine — Generalized Pattern Matching Kernel
 * File Path: src/core/patterns/types.ts
 * Architecture Role: Strongly typed schemas and contracts for generalized semantic patterns.
 * Dependencies & Triggers: Consumed by pattern-matcher, analyzers, and preset loaders.
 * Responsibilities:
 *   1. Declare configuration models for universal static analysis archetypes.
 *   2. Define violation descriptors for lifecycle, performance, isolation, and literals.
 * Exit Semantics & Design Rationale: Pure types and interfaces with zero runtime overhead;
 *   framework-neutral and language-agnostic.
 */

/** Configuration contract for resource lifecycle and leak detection. */
export interface ResourceLifecyclePattern {
    /** Descriptive pattern name. */
    readonly name: string;
    /** Regular expressions matching resource acquisition or listener registration. */
    readonly acquisitionPatterns: readonly RegExp[];
    /** Regular expressions matching safe container registration (e.g. subscriptions.push). */
    readonly containerPatterns: readonly RegExp[];
    /** Optional regular expressions matching explicit disposal or unsubscription. */
    readonly releasePatterns?: readonly RegExp[];
    /** Maximum subsequent lines to search for container registration (default: 6). */
    readonly trackingWindowLines?: number;
}

/** Diagnostic descriptor for a resource lifecycle violation. */
export interface ResourceLifecycleViolation {
    /** 1-indexed line number where violation originated. */
    readonly line: number;
    /** Raw source text containing the violation. */
    readonly rawText: string;
    /** Optional captured variable name tracking the unmanaged resource. */
    readonly resourceIdentifier?: string;
    /** Categorical violation reason. */
    readonly reason: 'unregistered' | 'untracked';
}

/** Configuration contract for synchronous blocking call detection. */
export interface BlockingCallPattern {
    /** Descriptive pattern name. */
    readonly name: string;
    /** Regular expressions matching blocking APIs (e.g. sync I/O). */
    readonly blockingCalls: readonly RegExp[];
    /** Target execution context markers (e.g. main-thread, ui-event-loop). */
    readonly targetContexts?: readonly string[];
    /** Remediation suggestion. */
    readonly suggestion?: string;
}

/** Diagnostic descriptor for a thread-blocking call violation. */
export interface BlockingCallViolation {
    /** 1-indexed line number of the blocking invocation. */
    readonly line: number;
    /** Raw source line text. */
    readonly rawText: string;
    /** Matched call name or expression. */
    readonly callName: string;
}

/** Configuration contract for transient heap allocation in high-frequency hot paths. */
export interface HotPathPattern {
    /** Descriptive pattern name. */
    readonly name: string;
    /** Scopes or function headers defining high-frequency execution paths. */
    readonly hotPathScopes: readonly RegExp[];
    /** Regular expressions matching heap allocations or cloning. */
    readonly allocationPatterns: readonly RegExp[];
    /** Whitelisted patterns exempt from allocation checks (e.g. object pool recycling). */
    readonly poolExemptions?: readonly RegExp[];
}

/** Diagnostic descriptor for a hot-path allocation violation. */
export interface HotPathViolation {
    /** 1-indexed line number of the allocation. */
    readonly line: number;
    /** Raw source line text. */
    readonly rawText: string;
    /** Active hot-path scope identifier. */
    readonly scopeName: string;
    /** Matched allocation snippet. */
    readonly allocationType: string;
}

/** Configuration contract for architecture layer boundary isolation. */
export interface BoundaryIsolationPattern {
    /** Descriptive pattern name. */
    readonly name: string;
    /** File path segments or class indicator headers matching the protected layer. */
    readonly sourceLayerIndicators: readonly (RegExp | string)[];
    /** Prohibited import paths or external dependencies. */
    readonly forbiddenTargets: readonly (RegExp | string)[];
    /** Rational explanation of the boundary violation. */
    readonly reason: string;
}

/** Diagnostic descriptor for an architectural boundary isolation violation. */
export interface BoundaryIsolationViolation {
    /** 1-indexed line number where forbidden dependency is introduced. */
    readonly line: number;
    /** Raw source line text. */
    readonly rawText: string;
    /** Target forbidden module or dependency identifier. */
    readonly targetIdentifier: string;
}

/** Configuration contract for un-localized presentation string literals. */
export interface PresentationLiteralPattern {
    /** Descriptive pattern name. */
    readonly name: string;
    /** User-facing presentation sink functions (e.g. showMessage, alert, toast). */
    readonly presentationSinks: readonly RegExp[];
    /** Localization wrapping markers (e.g. l10n.t, t, localize, tr). */
    readonly i18nWrappers: readonly RegExp[];
}

/** Diagnostic descriptor for an un-localized presentation literal violation. */
export interface PresentationLiteralViolation {
    /** 1-indexed line number of the un-localized text. */
    readonly line: number;
    /** Extracted string literal text. */
    readonly literalText: string;
    /** Surrounding sink expression. */
    readonly sinkExpression: string;
}
