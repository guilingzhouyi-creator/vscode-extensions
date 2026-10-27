/**
 * Module: Core Experts - AST & Language Modernity Expert Catalog
 * File Path: src/core/experts/catalog/ast-experts.ts
 * Architecture Role: Stage 2 expert definitions covering single-file AST, control flow,
 *   cyclomatic complexity, stdlib, and multi-language modernizers.
 * Dependencies & Triggers: Consumed by expert-catalog.
 * Responsibilities:
 *   Declare normative profiles for AST and language experts (indexes 11..18).
 * Exit Semantics & Design Rationale: Immutable declarative definitions satisfying ELOC budget.
 */

import { AnalyzerBit } from '../../constants/analyzer-bitmask';
import {
    ANALYZER_COMPLEXITY,
    ANALYZER_SIMPLIFY,
    ANALYZER_PYTHON_MODERN,
    ANALYZER_TYPESCRIPT_MODERN,
    ANALYZER_RUST_MODERN,
    ANALYZER_GDSCRIPT_MODERN,
    ANALYZER_STDLIB,
    ANALYZER_GO_MODERN,
} from '../../scoring/dimensionLiterals';
import {
    CATEGORY_CONTROL_FLOW,
    CATEGORY_INTERFACE_SIGNATURE,
    CATEGORY_GENERAL_CODE,
} from '../../router/sliceTypes';
import type { MoEExpertProfile } from '../expert-types';

const ARCH_DEMO = 'demo' as const;
const ARCH_WEB = 'web' as const;
const ARCH_GAME = 'game' as const;
const ARCH_LIBRARY = 'library' as const;
const ARCH_STDLIB = 'stdlib' as const;
const ARCH_SYSTEMS = 'systems_runtime' as const;

const SIG_CONTROL_FLOW = 'CONTROL_FLOW' as const;
const SIG_GENERAL_CODE = 'GENERAL_CODE' as const;
const SIG_INTERFACE_SIGNATURE = 'INTERFACE_SIGNATURE' as const;

const LANG_TYPESCRIPT = 'typescript' as const;
const LANG_JAVASCRIPT = 'javascript' as const;
const LANG_PYTHON = 'python' as const;
const LANG_RUST = 'rust' as const;
const LANG_GDSCRIPT = 'gdscript' as const;
const LANG_GO = 'go' as const;

const TRACK_FAST = 'fast' as const;
const TRACK_DEEP = 'deep' as const;

const TIER_RESIDENT = 'resident' as const;
const TIER_OFFLOAD = 'offload' as const;

const FALLBACK_ESCALATE_DEEP = 'escalate-deep' as const;

const DOMAIN_AST = 'ast' as const;

const ALL_ARCHETYPES = Object.freeze([
    ARCH_DEMO,
    ARCH_WEB,
    ARCH_GAME,
    ARCH_LIBRARY,
    ARCH_STDLIB,
    ARCH_SYSTEMS,
]);

function calcBaseScore(weight: number, steadyCostUs: number): number {
    return Math.round((weight * 1000) / Math.max(1, steadyCostUs));
}

/**
 * Stage 2 AST & Multi-Language Modernity Experts (Bit 11..18).
 * Code simplification, complexity metrics, stdlib migrations, and language-specific modernizers.
 */
export const AST_EXPERTS: readonly MoEExpertProfile[] = Object.freeze([
    // [11] Simplify (Bit 1 << 11)
    {
        id: ANALYZER_SIMPLIFY,
        bit: AnalyzerBit.SIMPLIFY,
        index: 11,
        domain: DOMAIN_AST,
        affinities: {
            signals: [SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
            categories: [CATEGORY_CONTROL_FLOW, CATEGORY_GENERAL_CODE],
            archetypes: ALL_ARCHETYPES,
            sliceTriggers: ['hasControlFlowMutation'],
        },
        serving: {
            track: TRACK_FAST,
            isShared: false,
            memoryTier: TIER_RESIDENT,
            steadyCostUs: 60,
            weight: 2.0,
            baseScore: calcBaseScore(2.0, 60),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'maintainability',
            isSpecialized: false,
            isSecurityFamily: false,
            description:
                'Ternary nesting, redundant boolean logic, dead stores, and AST simplification',
        },
    },

    // [12] Complexity (Bit 1 << 12)
    {
        id: ANALYZER_COMPLEXITY,
        bit: AnalyzerBit.COMPLEXITY,
        index: 12,
        domain: DOMAIN_AST,
        affinities: {
            signals: [SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
            categories: [CATEGORY_CONTROL_FLOW, CATEGORY_GENERAL_CODE],
            archetypes: ALL_ARCHETYPES,
            sliceTriggers: ['hasControlFlowMutation', 'hasAsyncMutation'],
        },
        serving: {
            track: TRACK_FAST,
            isShared: false,
            memoryTier: TIER_RESIDENT,
            steadyCostUs: 90,
            weight: 3.0,
            baseScore: calcBaseScore(3.0, 90),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'maintainability',
            isSpecialized: false,
            isSecurityFamily: false,
            description:
                'Cyclomatic complexity, nesting depth, cognitive noise, and parameter count budgets',
        },
    },

    // [13] Stdlib (Bit 1 << 13)
    {
        id: ANALYZER_STDLIB,
        bit: AnalyzerBit.STDLIB,
        index: 13,
        domain: DOMAIN_AST,
        affinities: {
            signals: [SIG_GENERAL_CODE],
            categories: [CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_STDLIB, ARCH_SYSTEMS, ARCH_LIBRARY, ARCH_WEB],
            sliceTriggers: [],
        },
        serving: {
            track: TRACK_FAST,
            isShared: false,
            memoryTier: TIER_RESIDENT,
            steadyCostUs: 50,
            weight: 2.0,
            baseScore: calcBaseScore(2.0, 50),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'maintainability',
            isSpecialized: false,
            isSecurityFamily: false,
            description: 'Standard library idiomatic usage and reinvented wheel detection',
        },
    },

    // [14] TypeScript Modern (Bit 1 << 14)
    {
        id: ANALYZER_TYPESCRIPT_MODERN,
        bit: AnalyzerBit.TYPESCRIPT_MODERN,
        index: 14,
        domain: DOMAIN_AST,
        affinities: {
            signals: [SIG_INTERFACE_SIGNATURE, SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
            categories: [
                CATEGORY_INTERFACE_SIGNATURE,
                CATEGORY_CONTROL_FLOW,
                CATEGORY_GENERAL_CODE,
            ],
            archetypes: [ARCH_WEB, ARCH_LIBRARY, ARCH_STDLIB, ARCH_SYSTEMS],
            languages: [LANG_TYPESCRIPT, LANG_JAVASCRIPT],
            sliceTriggers: ['hasTypeMutation'],
        },
        serving: {
            track: TRACK_DEEP,
            isShared: false,
            memoryTier: TIER_OFFLOAD,
            steadyCostUs: 140,
            weight: 2.0,
            baseScore: calcBaseScore(2.0, 140),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'modernity',
            isSpecialized: false,
            isSecurityFamily: false,
            description:
                'Modern TypeScript idioms, explicit types, strict null checks, and enum migration',
        },
    },

    // [15] Python Modern (Bit 1 << 15)
    {
        id: ANALYZER_PYTHON_MODERN,
        bit: AnalyzerBit.PYTHON_MODERN,
        index: 15,
        domain: DOMAIN_AST,
        affinities: {
            signals: [SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
            categories: [CATEGORY_CONTROL_FLOW, CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_LIBRARY, ARCH_STDLIB, ARCH_WEB, ARCH_SYSTEMS],
            languages: [LANG_PYTHON],
            sliceTriggers: [],
        },
        serving: {
            track: TRACK_DEEP,
            isShared: false,
            memoryTier: TIER_OFFLOAD,
            steadyCostUs: 130,
            weight: 2.0,
            baseScore: calcBaseScore(2.0, 130),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'modernity',
            isSpecialized: false,
            isSecurityFamily: false,
            description:
                'Python 3.10+ modern idioms, type annotations, context managers, and path manipulation',
        },
    },

    // [16] Rust Modern (Bit 1 << 16)
    {
        id: ANALYZER_RUST_MODERN,
        bit: AnalyzerBit.RUST_MODERN,
        index: 16,
        domain: DOMAIN_AST,
        affinities: {
            signals: [SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
            categories: [CATEGORY_CONTROL_FLOW, CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_GAME, ARCH_LIBRARY, ARCH_STDLIB, ARCH_SYSTEMS],
            languages: [LANG_RUST],
            sliceTriggers: [],
        },
        serving: {
            track: TRACK_DEEP,
            isShared: false,
            memoryTier: TIER_OFFLOAD,
            steadyCostUs: 150,
            weight: 2.5,
            baseScore: calcBaseScore(2.5, 150),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'modernity',
            isSpecialized: false,
            isSecurityFamily: false,
            description:
                'Rust 2021/2024 idioms, zero-cost abstractions, error handling, and ownership patterns',
        },
    },

    // [17] GDScript Modern (Bit 1 << 17)
    {
        id: ANALYZER_GDSCRIPT_MODERN,
        bit: AnalyzerBit.GDSCRIPT_MODERN,
        index: 17,
        domain: DOMAIN_AST,
        affinities: {
            signals: [SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
            categories: [CATEGORY_CONTROL_FLOW, CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_GAME],
            languages: [LANG_GDSCRIPT],
            sliceTriggers: [],
        },
        serving: {
            track: TRACK_DEEP,
            isShared: false,
            memoryTier: TIER_OFFLOAD,
            steadyCostUs: 120,
            weight: 2.0,
            baseScore: calcBaseScore(2.0, 120),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'modernity',
            isSpecialized: false,
            isSecurityFamily: false,
            description:
                'Godot 4 typed GDScript, annotation conventions, signal safety, and scene references',
        },
    },

    // [18] Go Modern (Bit 1 << 18)
    {
        id: ANALYZER_GO_MODERN,
        bit: AnalyzerBit.GO_MODERN,
        index: 18,
        domain: DOMAIN_AST,
        affinities: {
            signals: [SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
            categories: [CATEGORY_CONTROL_FLOW, CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_SYSTEMS, ARCH_WEB, ARCH_LIBRARY, ARCH_STDLIB],
            languages: [LANG_GO],
            sliceTriggers: [],
        },
        serving: {
            track: TRACK_DEEP,
            isShared: false,
            memoryTier: TIER_OFFLOAD,
            steadyCostUs: 130,
            weight: 2.0,
            baseScore: calcBaseScore(2.0, 130),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'modernity',
            isSpecialized: false,
            isSecurityFamily: false,
            description:
                'Modern Go 1.20+ idioms, generics usage, context propagation, and error wrapping',
        },
    },
]);
