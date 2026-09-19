/**
 * Module: Core Rules — Evolution & Generalization Barrel
 * File Path: src/core/rules/evolution/index.ts
 * Architecture Role: Central export surface for the rule evolution and candidate generalization
 *   subsystem.
 * Dependencies & Triggers: Re-exports types, normalizers, rules, and generalization pipeline.
 * Responsibilities: Expose clean public APIs for candidate tracking and rule promotion.
 * Exit Semantics & Design Rationale: Barrel module without side effects.
 */

export * from './types';
export * from './patternNormalizer';
export * from './wrapperRule';
export * from './silentExceptionRule';
export * from './dispatchComplexityRule';
export * from './generalizationPipeline';
