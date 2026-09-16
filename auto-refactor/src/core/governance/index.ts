/**
 * Module: Core Governance — Public Barrel
 * File Path: src/core/governance/index.ts
 * Architecture Role: Public entry point and boundary adapter for the governance domain;
 *     re-exports contracts, profiles, registry, and all built-in rule families.
 * Dependencies & Triggers: Re-exports ./types, ./languageProfiles, ./registry and the
 *     ./rules/* modules; loaded when any consumer imports the governance public API, which
 *     src/api.ts re-exports for package consumers.
 * Responsibilities: Publish the GovernanceRule and GovernanceViolation contracts; expose
 *     the language profile resolver; expose BUILTIN_GOVERNANCE_RULES and GovernanceRegistry;
 *     publish the standardization, fileStructure, codeLogic, typeSystem, exceptionSafety,
 *     debugLogging, performance, and maintainability rule modules.
 * Exit Semantics & Design Rationale: A side-effect-free barrel with no runtime logic or I/O;
 *     the single import surface keeps export order stable and stops consumers from deep
 *     importing internal rule files, so rules can move without breaking callers.
 */
export * from './types';
export * from './languageProfiles';
export * from './registry';
export * from './rules/standardization';
export * from './rules/fileStructure';
export * from './rules/codeLogic';
export * from './rules/typeSystem';
export * from './rules/exceptionSafety';
export * from './rules/debugLogging';
export * from './rules/performance';
export * from './rules/maintainability';
export * from './rules/compressionBounds';
