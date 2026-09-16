/**
 * Module: Core Messages - Governance Rule Catalog Re-Exports
 * File Path: src/core/messages/governance.ts
 * Architecture Role: Barrel-style facade that republishes the governance engine's built-in rule
 *   objects through the core messages surface; it adds no logic, state, or scanning behaviour.
 * Dependencies & Triggers: Re-exports 19 named rule bindings from nine ../governance/rules modules
 *   plus BUILTIN_GOVERNANCE_RULES from ../governance/registry. Evaluated when ./index.ts or
 *   src/api.ts loads the messages barrel, making the catalog available to API consumers and
 *   rule registries.
 * Responsibilities: Surface standardization, file-structure, code-logic, type-system,
 *   exception-safety, debug-logging, performance, maintainability, and sanitization rules, plus
 *   the aggregated BUILTIN_GOVERNANCE_RULES list, without duplicating their implementations.
 * Exit Semantics & Design Rationale: Export-only module with no execution path; a successful load
 *   only requires every source binding to resolve. Missing or renamed source modules fail fast at
 *   build/import time, which is preferred over silently dropping governance coverage. Keeping the
 *   catalog as re-exports prevents parallel rule definitions from drifting out of sync.
 */

export { RedundantBooleanRule, ModernConstructRule } from '../governance/rules/standardization';

export { FileNamingRule, ModuleHeaderRule } from '../governance/rules/fileStructure';

export { ExcessiveNestingRule, VacuousWrapperRule } from '../governance/rules/codeLogic';

export {
    ExplicitTypingRule,
    FunctionSignatureCompletenessRule,
    UnsafeAnyRule,
} from '../governance/rules/typeSystem';

export { SwallowedExceptionRule, NakedUnwrapRule } from '../governance/rules/exceptionSafety';

export { DiagnosticLeakRule } from '../governance/rules/debugLogging';

export {
    LoopInvariantRule,
    InLoopLinearSearchRule,
    TimerLiteralRule,
    SyncIoRule,
} from '../governance/rules/performance';

export { InheritanceDepthRule, DomainDecouplingRule } from '../governance/rules/maintainability';

export { LexicalHygieneRule } from '../governance/rules/sanitization';

export { BUILTIN_GOVERNANCE_RULES } from '../governance/registry';
