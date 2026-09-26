/**
 * Module: Core Constants — Analyzer Names and Standardized Rule Codes
 * File Path: src/core/constants/rule-codes.ts
 * Architecture Role: Single source of truth for built-in analyzer IDs, raw rule identifiers,
 *     and unified machine-actionable diagnostic codes (AR-<DOMAIN>-<ID>).
 * Dependencies & Triggers: Zero runtime dependencies; imported by all analyzers, rules
 *     registry, diagnostic formatters, and agent consumers.
 * Responsibilities: Centralize canonical strings for built-in analyzer names, existing rule
 *     identifiers, and standardized agent-actionable error codes.
 * Exit Semantics & Design Rationale: Immutable constants preventing analyzer/rule ID drift
 *     and providing the foundational taxonomy for Agent automated patch dispatch.
 */

// ============================================================================
// Built-in Analyzer Identifiers
// ============================================================================

export const ANALYZER_CONSTANTS = 'constants';
export const ANALYZER_COMPLEXITY = 'complexity';
export const ANALYZER_LARGE_FILE = 'large-file';
export const ANALYZER_SIMPLIFY = 'simplify';
export const ANALYZER_COMMENTS = 'comments';
export const ANALYZER_DOCS = 'docs';
export const ANALYZER_STDLIB = 'stdlib';
export const ANALYZER_RULES = 'rules';
export const ANALYZER_DEPENDENCY_GRAPH = 'dependency-graph';
export const ANALYZER_GOVERNANCE = 'governance';
export const ANALYZER_HYGIENE = 'hygiene';
export const ANALYZER_PERFORMANCE = 'performance';
export const ANALYZER_SECRETS = 'secrets';

export const BUILTIN_ANALYZERS = [
    ANALYZER_CONSTANTS,
    ANALYZER_COMPLEXITY,
    ANALYZER_LARGE_FILE,
    ANALYZER_SIMPLIFY,
    ANALYZER_COMMENTS,
    ANALYZER_DOCS,
    ANALYZER_STDLIB,
    ANALYZER_RULES,
    ANALYZER_DEPENDENCY_GRAPH,
    ANALYZER_GOVERNANCE,
    ANALYZER_HYGIENE,
    ANALYZER_PERFORMANCE,
    ANALYZER_SECRETS,
] as const;

// ============================================================================
// Raw Rule Identifiers (Legacy / Engine Compatible)
// ============================================================================

// Constants domain
export const RULE_HARDCODED_STRING = 'hardcoded-string';
export const RULE_MAGIC_NUMBER = 'magic-number';
export const RULE_DUPLICATE_LITERAL = 'duplicate-literal';
export const RULE_NESTED_CONSTANT = 'nested-constant';
export const RULE_CONST_LIB_001 = 'CONST-LIB-001';

// Complexity domain
export const RULE_HIGH_COMPLEXITY = 'high-complexity';
export const RULE_DEEP_NESTING = 'deep-nesting';

// Large file domain
export const RULE_LARGE_FILE = 'large-file';

// Simplify domain
export const RULE_SIM_LONG_FUNCTION = 'SIM-LONG-001';
export const RULE_SIM_EMPTY_IMPLEMENTATION = 'SIM-EMPTY-001';

// Comments domain
export const RULE_CMT_HEADER_MISSING = 'CMT-HDR-001';

// TypeScript modern idioms
export const RULE_TSM_VAR = 'TSM-VAR-001';
export const RULE_TSM_CTOR = 'TSM-CTOR-001';

// Stdlib & robustness (matching RULE_REGISTRY canonical IDs)
export const RULE_STDLIB_PANIC = 'STDLIB-PANIC-001';
export const RULE_STDLIB_ALLOC = 'STDLIB-ALLOC-001';
export const RULE_STDLIB_UNSAFE = 'STDLIB-UNSAFE-001';
export const RULE_STDLIB_CONST = 'STDLIB-CONST-001';
export const RULE_STDLIB_RECURSION = 'STDLIB-RECURSION-001';
export const RULE_STDLIB_PORT = 'STDLIB-PORT-001';

// ============================================================================
// Standardized Agent-Actionable Diagnostic Codes (AR:DOMAIN:ID)
// ============================================================================

export const CODE_CONST_HARDCODED_STRING = 'AR:CONST:001';
export const CODE_CONST_MAGIC_NUMBER = 'AR:CONST:002';
export const CODE_CONST_DUPLICATE_LITERAL = 'AR:CONST:003';
export const CODE_CONST_NESTED_CONSTANT = 'AR:CONST:004';
export const CODE_CONST_LIB_TOPOLOGY = 'AR:CONST:005';

export const CODE_CPX_HIGH_COMPLEXITY = 'AR:CPX:001';
export const CODE_CPX_DEEP_NESTING = 'AR:CPX:002';

export const CODE_FILE_TOO_LARGE = 'AR:FILE:001';
export const CODE_SIM_LONG_FUNCTION = 'AR:SIM:001';
export const CODE_SIM_EMPTY_FUNCTION = 'AR:SIM:002';

export const CODE_CMT_MISSING_HEADER = 'AR:CMT:001';
export const CODE_CMT_CONCURRENCY_CONTRACT = 'AR:CMT:002';

export const CODE_TSM_AVOID_VAR = 'AR:TSM:001';
export const CODE_TSM_AVOID_WRAPPER_CTOR = 'AR:TSM:002';
export const CODE_TSM_PREFER_ESM_IMPORT = 'AR:TSM:003';
export const CODE_TSM_REST_PARAMS = 'AR:TSM:004';
export const CODE_TSM_OBJECT_SPREAD = 'AR:TSM:005';

export const CODE_STB_PANIC_ESCAPE = 'AR:STB:001';
export const CODE_STB_UNCHECKED_ERROR = 'AR:STB:002';
export const CODE_STB_DYNAMIC_ALLOC = 'AR:STB:003';
export const CODE_STB_MISSING_SAFETY = 'AR:STB:004';
export const CODE_STB_TIMING_ATTACK = 'AR:STB:005';
export const CODE_STB_UNBOUNDED_RECURSION = 'AR:STB:006';
export const CODE_STB_CONDITIONAL_COMPILATION = 'AR:STB:007';
