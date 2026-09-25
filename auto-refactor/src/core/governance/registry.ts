/**
 * Module: Core Governance — Built-in Rule Registry
 * File Path: src/core/governance/registry.ts
 * Architecture Role: In-memory rule registry that aggregates the built-in governance rules
 *     and selects the active subset for a language before evaluation.
 * Dependencies & Triggers: Imports rule objects from ./rules/* and GovernanceRule from
 *     ./types; instantiated by GovernanceAnalyzer through getDefaultGovernanceRegistry(), or
 *     supplied directly as a constructor override.
 * Responsibilities: Publish BUILTIN_GOVERNANCE_RULES across the eight governance categories;
 *     register rules by rule id; look up a single rule or all rules; filter rules per
 *     language while honoring options.rules[id].enabled === false; lazily create a
 *     process-wide default registry singleton.
 * Exit Semantics & Design Rationale: Synchronous mutation that never throws; duplicate ids
 *     replace earlier entries (last write wins). The lazy singleton avoids rebuilding the
 *     built-in set for every file, while the injectable constructor keeps tests and custom
 *     rule sets isolated.
 */
import type { GovernanceRule } from './types';
import { RedundantBooleanRule, ModernConstructRule } from './rules/standardization';
import { FileNamingRule, ModuleHeaderRule } from './rules/fileStructure';
import { ExcessiveNestingRule, VacuousWrapperRule } from './rules/codeLogic';
import { TYPE_SYSTEM_GOVERNANCE_RULES } from './rules/typeSystem';
import {
    SwallowedExceptionRule,
    NakedUnwrapRule,
    SilentPseudoCatchRule,
} from './rules/exceptionSafety';
import { DiagnosticLeakRule } from './rules/debugLogging';
import {
    LoopInvariantRule,
    InLoopLinearSearchRule,
    InLoopArrayPreHashRule,
    TimerLiteralRule,
    SyncIoRule,
} from './rules/performance';
import {
    InheritanceDepthRule,
    DomainDecouplingRule,
    DataClumpsRule,
} from './rules/maintainability';
import { LexicalHygieneRule, DiagnosticMessageRule } from './rules/sanitization';
import {
    GiantExpressionRule,
    SingleLineMultiSemanticRule,
    CallbackDepthRule,
    CognitiveDensityRule,
} from './rules/compressionBounds';

/**
 * Ordered list of every built-in governance rule, grouped by the eight evaluation
 * categories used by the governance analyzer.
 *
 * The array order defines the deterministic evaluation order. Registry instances copy the
 * entries into their own map, so callers may filter or extend this list but should treat it
 * as read-only shared state.
 */
export const BUILTIN_GOVERNANCE_RULES: GovernanceRule[] = [
    // 1. Standardization
    RedundantBooleanRule,
    ModernConstructRule,
    DiagnosticMessageRule,
    // 2. File Structure
    FileNamingRule,
    ModuleHeaderRule,
    // 3. Code Logic
    ExcessiveNestingRule,
    VacuousWrapperRule,
    // 4. Type System
    ...TYPE_SYSTEM_GOVERNANCE_RULES,
    // 5. Exception Safety
    SwallowedExceptionRule,
    NakedUnwrapRule,
    SilentPseudoCatchRule,
    // 6. Debug & Logging
    DiagnosticLeakRule,
    // 7. Performance
    LoopInvariantRule,
    InLoopLinearSearchRule,
    InLoopArrayPreHashRule,
    TimerLiteralRule,
    SyncIoRule,
    // 8. Maintainability
    InheritanceDepthRule,
    DomainDecouplingRule,
    DataClumpsRule,
    LexicalHygieneRule,
    GiantExpressionRule,
    SingleLineMultiSemanticRule,
    CallbackDepthRule,
    CognitiveDensityRule,
];

/**
 * In-memory registry of governance rules keyed by `rule.id`.
 *
 * The optional constructor seed copies `BUILTIN_GOVERNANCE_RULES` into the instance map;
 * later registrations with the same id replace earlier entries (last write wins). Every
 * method is synchronous, never throws, and mutates only this instance, so separate
 * registries are isolated and safe to configure independently.
 *
 * @param loadBuiltins - When true (the default), seed the registry with every built-in rule.
 */
export class GovernanceRegistry {
    private rules: Map<string, GovernanceRule> = new Map();

    constructor(loadBuiltins = true) {
        if (loadBuiltins) {
            for (const rule of BUILTIN_GOVERNANCE_RULES) {
                this.register(rule);
            }
        }
    }

    register(rule: GovernanceRule): void {
        this.rules.set(rule.id, rule);
    }

    get(ruleId: string): GovernanceRule | undefined {
        return this.rules.get(ruleId);
    }

    getAll(): GovernanceRule[] {
        return Array.from(this.rules.values());
    }

    getRulesForLanguage(languageId: string, options?: Record<string, any>): GovernanceRule[] {
        const active: GovernanceRule[] = [];
        for (const rule of this.rules.values()) {
            // Check if disabled in options
            if (options && options.rules && options.rules[rule.id]?.enabled === false) {
                continue;
            }
            // Check language suitability
            if (rule.languages && !rule.languages.includes(languageId)) {
                continue;
            }
            active.push(rule);
        }
        return active;
    }

    /**
     * Build a fast combined text trigger check for the given rule set.
     * Returns null when no rules have text triggers (cannot short-circuit).
     *
     * The returned RegExp is a case-sensitive alternation of all triggers;
     * each trigger is escaped to prevent regex injection / ReDoS.
     */
    buildTextTrigger(rules: GovernanceRule[]): RegExp | null {
        const triggers: string[] = [];
        for (const rule of rules) {
            if (rule.textTrigger) {
                triggers.push(rule.textTrigger);
            }
        }
        if (triggers.length === 0) return null;
        // Build a case-sensitive alternation regex; we escape each trigger first.
        const escaped = triggers.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return new RegExp(escaped.join('|'));
    }

    /**
     * Group node-level rules by the NodeKind they target.
     * Rules with no specific target go under the '*' key.
     */
    groupNodeRulesByKind(rules: GovernanceRule[]): Map<string, GovernanceRule[]> {
        const groups = new Map<string, GovernanceRule[]>();
        for (const rule of rules) {
            if (typeof rule.checkNode !== 'function') continue;
            const kinds = rule.targetKinds || ['*'];
            for (const kind of kinds) {
                if (!groups.has(kind)) groups.set(kind, []);
                groups.get(kind)!.push(rule);
            }
        }
        return groups;
    }
}

let defaultRegistryInstance: GovernanceRegistry | null = null;

/**
 * Return the process-wide default registry, creating and seeding it from
 * `BUILTIN_GOVERNANCE_RULES` on first use.
 *
 * The cached singleton is reused by every caller in this module instance, so registrations
 * performed through it are visible process-wide. Node worker threads each load their own
 * module instance, so no cross-thread lock is required; repeated calls are idempotent.
 *
 * @returns The shared default `GovernanceRegistry`; never null and never throws.
 */
export function getDefaultGovernanceRegistry(): GovernanceRegistry {
    if (!defaultRegistryInstance) {
        defaultRegistryInstance = new GovernanceRegistry(true);
    }
    return defaultRegistryInstance;
}
