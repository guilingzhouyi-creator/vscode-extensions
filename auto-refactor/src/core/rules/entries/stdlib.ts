/**
 * Module: Core Engine — Rule Registry (standard library & systems runtime entries)
 * File Path: src/core/rules/entries/stdlib.ts
 * Architecture Role: Declarative rule metadata for standard library and systems runtime safety,
 *   unsafe contracts, constant-time cryptography, no_std heap escapes, and platform compilation.
 * Dependencies & Triggers: core rule types plus defineRule(); consumed by ./registry.ts
 * Responsibilities: Declare RuleDefinition entries for STDLIB-PANIC-001, STDLIB-ALLOC-001,
 *   STDLIB-UNSAFE-001, STDLIB-CONST-001, STDLIB-RECURSION-001, and STDLIB-PORT-001.
 * Exit Semantics & Design Rationale: Pure data, no behaviour. Provides unified identity
 *   and documentation anchors for standard library and runtime verification rules.
 */

import type { RuleDefinition } from '../types';
import {
    ALL_LANGUAGES,
    defineRule,
    SEVERITY_WARNING,
    SEVERITY_ERROR,
    RULE_FAMILY_STDLIB,
} from '../types';

const ANALYZER_STDLIB = 'stdlib';
const DOCS_ANCHOR_BASE = 'docs/04-analyzers-and-rules/01-builtin-rules.md#';

const RULE_ID_STDLIB_PANIC_001 = 'STDLIB-PANIC-001';
const RULE_ID_STDLIB_ALLOC_001 = 'STDLIB-ALLOC-001';
const RULE_ID_STDLIB_UNSAFE_001 = 'STDLIB-UNSAFE-001';
const RULE_ID_STDLIB_CONST_001 = 'STDLIB-CONST-001';
const RULE_ID_STDLIB_RECURSION_001 = 'STDLIB-RECURSION-001';
const RULE_ID_STDLIB_PORT_001 = 'STDLIB-PORT-001';

function createStdlibRule(
    id: string,
    summary: string,
    remediation: string,
    severity = SEVERITY_WARNING,
): RuleDefinition {
    return defineRule({
        id,
        family: RULE_FAMILY_STDLIB,
        analyzer: ANALYZER_STDLIB,
        canonical: true,
        languages: ALL_LANGUAGES,
        defaultSeverity: severity,
        summary,
        remediation,
        docsAnchor: `${DOCS_ANCHOR_BASE}${id.toLowerCase()}`,
    });
}

/**
 * Standard library and systems runtime verification rules table.
 */
export const STDLIB_RULES: readonly RuleDefinition[] = [
    createStdlibRule(
        RULE_ID_STDLIB_PANIC_001,
        'Public APIs in standard library and runtime must not escape naked panic, unwrap, or abort; return Result/Option or bounded error.',
        'Use Result<T, E> or explicit error code on public APIs; unwrap via pattern matching or ? operator internally.',
        SEVERITY_WARNING,
    ),
    createStdlibRule(
        RULE_ID_STDLIB_ALLOC_001,
        'Prohibit implicit heap escape and dynamic reallocation in bare-metal and no_std runtime environments.',
        'Use fixed-capacity stack buffers, borrowed slices, or pre-allocated pools in no_std/core scopes instead of Box::new or malloc.',
        SEVERITY_ERROR,
    ),
    createStdlibRule(
        RULE_ID_STDLIB_UNSAFE_001,
        'Low-level unsafe blocks in Rust/C++ require mandatory // SAFETY: contract proof comments.',
        'Document caller preconditions and memory safety invariants in a // SAFETY: comment preceding every unsafe block or function.',
        SEVERITY_ERROR,
    ),
    createStdlibRule(
        RULE_ID_STDLIB_CONST_001,
        'Cryptographic and hash comparisons must prevent timing leakages via constant-time execution.',
        'Use constant-time equality comparisons (e.g. constant_time_eq) without early return on byte mismatches.',
        SEVERITY_WARNING,
    ),
    createStdlibRule(
        RULE_ID_STDLIB_RECURSION_001,
        'Unbounded deep recursion in core algorithms must include explicit stack depth guards.',
        'Introduce explicit depth limit guards or refactor recursive logic to iterative loops with explicit stack.',
        SEVERITY_WARNING,
    ),
    createStdlibRule(
        RULE_ID_STDLIB_PORT_001,
        'Conditional platform compilation #[cfg(...)] requires fallback blocks for unsupported targets.',
        'Add compile_error! or generic software fallback for unsupported target architectures/operating systems.',
        SEVERITY_WARNING,
    ),
];
