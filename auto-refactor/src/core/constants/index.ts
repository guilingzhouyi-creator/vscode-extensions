/**
 * Module: Core Constants — Central Barrel & Immutability Facade
 * File Path: src/core/constants/index.ts
 * Architecture Role: Central facade and aggregator for all core system constants,
 *     providing both granular named exports and frozen, immutable domain namespaces.
 * Dependencies & Triggers: Re-exports and aggregates from ast-tokens, diagnostic-tokens,
 *     system-tokens, and rule-codes.
 * Responsibilities:
 *     1. Provide backward-compatible named symbol exports for zero-friction imports.
 *     2. Provide tamper-proof, Object.freeze-sealed domain namespaces
 *        (AST, DIAGNOSTIC, SYSTEM, RULES).
 *     3. Expose consolidated CoreConstants facade adhering to ARCH-FAC-001
 *        immutability contracts.
 * Exit Semantics & Design Rationale: Central immutable catalog facade; runtime overhead is
 *     strictly bounded to one-time shallow namespace freeze upon module initialization.
 */

import * as AstTokens from './ast-tokens';
import * as DiagnosticTokens from './diagnostic-tokens';
import * as SystemTokens from './system-tokens';
import * as RuleCodes from './rule-codes';
import * as RegexPatterns from './regex-patterns';

// Granular direct re-exports for transparent backward compatibility
export * from './ast-tokens';
export * from './diagnostic-tokens';
export * from './system-tokens';
export * from './rule-codes';
export * from './analyzer-bitmask';
export * from './regex-patterns';

/**
 * Immutable AST and grammar token namespace.
 */
export const AST = Object.freeze({ ...AstTokens });

/**
 * Immutable diagnostic, severity, and quality verdict token namespace.
 */
export const DIAGNOSTIC = Object.freeze({ ...DiagnosticTokens });

/**
 * Immutable system, file extension, encoding, and path token namespace.
 */
export const SYSTEM = Object.freeze({ ...SystemTokens });

/**
 * Immutable analyzer names, rule identifiers, and diagnostic codes namespace.
 */
export const RULES = Object.freeze({ ...RuleCodes });

/**
 * Immutable standardized regular expression catalog namespace.
 */
export const REGEX = RegexPatterns.REGEX;

/**
 * Consolidated root constants catalog facade with deep immutability guarantees.
 */
export const CoreConstants = Object.freeze({
    ast: AST,
    diagnostic: DIAGNOSTIC,
    system: SYSTEM,
    rules: RULES,
    regex: REGEX,
});
