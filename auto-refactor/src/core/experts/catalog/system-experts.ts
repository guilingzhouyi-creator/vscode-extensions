/**
 * Module: Core Experts - Architecture, System & Concurrency Expert Catalog
 * File Path: src/core/experts/catalog/system-experts.ts
 * Architecture Role: Stage 3 expert definitions covering domain architecture, data flow,
 *   dependency topology, platform integration, governance, and concurrency safety.
 * Dependencies & Triggers: Consumed by expert-catalog.
 * Responsibilities:
 *   Declare normative profiles for architecture, topology, and concurrency
 *   experts (indexes 19..31).
 * Exit Semantics & Design Rationale: Immutable declarative definitions satisfying ELOC budget.
 */

import { AnalyzerBit } from '../../constants/analyzer-bitmask';
import {
    ANALYZER_GOVERNANCE,
    ANALYZER_DEPENDENCY_GRAPH,
    ANALYZER_ARCHITECTURE,
    ANALYZER_PERFORMANCE,
    ANALYZER_DATA_ARCHITECTURE,
    ANALYZER_TEST_MODERNITY,
    ANALYZER_DEPENDENCY_LAYOUT,
    ANALYZER_GDSCRIPT_GAME,
    ANALYZER_VSCODE_EXTENSION,
    ANALYZER_GATE_ARCHITECTURE,
    ANALYZER_FRONTEND,
    ANALYZER_CLIENT_EXPOSURE,
    ANALYZER_CONCURRENCY,
} from '../../scoring/dimensionLiterals';
import {
    CATEGORY_CONTROL_FLOW,
    CATEGORY_INTERFACE_SIGNATURE,
    CATEGORY_IMPORT_EXPORT,
    CATEGORY_GENERAL_CODE,
} from '../../router/sliceTypes';
import type { MoEExpertProfile } from '../expert-types';

const ARCH_DEMO = 'demo' as const;
const ARCH_WEB = 'web' as const;
const ARCH_GAME = 'game' as const;
const ARCH_LIBRARY = 'library' as const;
const ARCH_STDLIB = 'stdlib' as const;
const ARCH_SYSTEMS = 'systems_runtime' as const;

const SIG_GENERAL_CODE = 'GENERAL_CODE' as const;
const SIG_NON_SOURCE = 'NON_SOURCE' as const;
const SIG_CONTROL_FLOW = 'CONTROL_FLOW' as const;
const SIG_IO = 'IO' as const;
const SIG_ASYNC = 'ASYNC' as const;
const SIG_CONCURRENCY = 'CONCURRENCY' as const;
const SIG_IMPORT_EXPORT = 'IMPORT_EXPORT' as const;
const SIG_INTERFACE_SIGNATURE = 'INTERFACE_SIGNATURE' as const;
const SIG_MANIFEST = 'MANIFEST' as const;
const SIG_CONFIG_SECURITY = 'CONFIG_SECURITY' as const;

const TRACK_FAST = 'fast' as const;
const TRACK_DEEP = 'deep' as const;

const TIER_RESIDENT = 'resident' as const;
const TIER_OFFLOAD = 'offload' as const;

const FALLBACK_ESCALATE_DEEP = 'escalate-deep' as const;
const FALLBACK_BLOCK = 'block' as const;

const DOMAIN_AST = 'ast' as const;
const DOMAIN_TOPOLOGY = 'topology' as const;
const DOMAIN_SYSTEM = 'system' as const;
const DOMAIN_SECURITY = 'security' as const;
const DOMAIN_QUALITY = 'quality' as const;
const DOMAIN_CONCURRENCY = 'concurrency' as const;

const DIMENSION_ARCH = 'architectureConsistency' as const;
const DEFAULT_STEADY_WEIGHT = 3.0;

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
 * Stage 3 System, Topology, Architecture & Concurrency Experts (Bit 19..31).
 * Frontend/web frameworks, performance anti-patterns, cyclic dependencies,
 * game logic, and concurrency.
 */
export const SYSTEM_EXPERTS: readonly MoEExpertProfile[] = Object.freeze([
    // [19] Frontend (Bit 1 << 19)
    {
        id: ANALYZER_FRONTEND,
        bit: AnalyzerBit.FRONTEND,
        index: 19,
        domain: DOMAIN_AST,
        affinities: {
            signals: [SIG_GENERAL_CODE, SIG_NON_SOURCE],
            categories: [CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_WEB],
            sliceTriggers: [],
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
            dimension: DIMENSION_ARCH,
            isSpecialized: true,
            isSecurityFamily: false,
            description: 'Frontend UI/UX, A11y semantics, DOM depth, and component hygiene',
        },
    },

    // [20] Performance (Bit 1 << 20)
    {
        id: ANALYZER_PERFORMANCE,
        bit: AnalyzerBit.PERFORMANCE,
        index: 20,
        domain: DOMAIN_AST,
        affinities: {
            signals: [SIG_CONTROL_FLOW, SIG_IO, SIG_GENERAL_CODE],
            categories: [CATEGORY_CONTROL_FLOW, CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_GAME, ARCH_SYSTEMS, ARCH_WEB, ARCH_STDLIB, ARCH_LIBRARY],
            sliceTriggers: ['hasControlFlowMutation', 'hasIoMutation', 'hasAsyncMutation'],
        },
        serving: {
            track: TRACK_FAST,
            isShared: false,
            memoryTier: TIER_RESIDENT,
            steadyCostUs: 70,
            weight: DEFAULT_STEADY_WEIGHT,
            baseScore: calcBaseScore(DEFAULT_STEADY_WEIGHT, 70),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'performanceEfficiency',
            isSpecialized: false,
            isSecurityFamily: false,
            description:
                'Regex compilation in loops, synchronous I/O in async contexts, and expensive allocations',
        },
    },

    // [21] Architecture (Bit 1 << 21)
    {
        id: ANALYZER_ARCHITECTURE,
        bit: AnalyzerBit.ARCHITECTURE,
        index: 21,
        domain: DOMAIN_TOPOLOGY,
        affinities: {
            signals: [SIG_INTERFACE_SIGNATURE, SIG_IMPORT_EXPORT, SIG_GENERAL_CODE],
            categories: [
                CATEGORY_INTERFACE_SIGNATURE,
                CATEGORY_IMPORT_EXPORT,
                CATEGORY_GENERAL_CODE,
            ],
            archetypes: [ARCH_LIBRARY, ARCH_STDLIB, ARCH_WEB, ARCH_SYSTEMS, ARCH_GAME],
            sliceTriggers: ['hasSignatureMutation'],
        },
        serving: {
            track: TRACK_DEEP,
            isShared: false,
            memoryTier: TIER_OFFLOAD,
            steadyCostUs: 180,
            weight: DEFAULT_STEADY_WEIGHT,
            baseScore: calcBaseScore(DEFAULT_STEADY_WEIGHT, 180),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: DIMENSION_ARCH,
            isSpecialized: false,
            isSecurityFamily: false,
            description:
                'Clean architecture layer boundaries, facade discipline, circular dependencies, and inversion of control',
        },
    },

    // [22] Data Architecture (Bit 1 << 22)
    {
        id: ANALYZER_DATA_ARCHITECTURE,
        bit: AnalyzerBit.DATA_ARCHITECTURE,
        index: 22,
        domain: DOMAIN_TOPOLOGY,
        affinities: {
            signals: [SIG_INTERFACE_SIGNATURE, SIG_GENERAL_CODE],
            categories: [CATEGORY_INTERFACE_SIGNATURE, CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_LIBRARY, ARCH_STDLIB, ARCH_SYSTEMS, ARCH_WEB],
            sliceTriggers: ['hasSignatureMutation', 'hasTypeMutation'],
        },
        serving: {
            track: TRACK_DEEP,
            isShared: false,
            memoryTier: TIER_OFFLOAD,
            steadyCostUs: 160,
            weight: DEFAULT_STEADY_WEIGHT,
            baseScore: calcBaseScore(DEFAULT_STEADY_WEIGHT, 160),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: DIMENSION_ARCH,
            isSpecialized: true,
            isSecurityFamily: false,
            description:
                'Data flow integrity, schema evolution, serialization contracts, and state mutability boundaries',
        },
    },

    // [23] Dependency Layout (Bit 1 << 23)
    {
        id: ANALYZER_DEPENDENCY_LAYOUT,
        bit: AnalyzerBit.DEPENDENCY_LAYOUT,
        index: 23,
        domain: DOMAIN_TOPOLOGY,
        affinities: {
            signals: [SIG_IMPORT_EXPORT, SIG_GENERAL_CODE],
            categories: [CATEGORY_IMPORT_EXPORT, CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_LIBRARY, ARCH_STDLIB, ARCH_WEB, ARCH_SYSTEMS],
            sliceTriggers: [],
        },
        serving: {
            track: TRACK_DEEP,
            isShared: false,
            memoryTier: TIER_OFFLOAD,
            steadyCostUs: 180,
            weight: DEFAULT_STEADY_WEIGHT,
            baseScore: calcBaseScore(DEFAULT_STEADY_WEIGHT, 180),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: DIMENSION_ARCH,
            isSpecialized: true,
            isSecurityFamily: false,
            description:
                'Module coupling, fan-in/fan-out ratios, barrel export hygiene, and dependency direction',
        },
    },

    // [24] Dependency Graph (Bit 1 << 24)
    {
        id: ANALYZER_DEPENDENCY_GRAPH,
        bit: AnalyzerBit.DEPENDENCY_GRAPH,
        index: 24,
        domain: DOMAIN_TOPOLOGY,
        affinities: {
            signals: [SIG_IMPORT_EXPORT, SIG_GENERAL_CODE],
            categories: [CATEGORY_IMPORT_EXPORT, CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_LIBRARY, ARCH_STDLIB, ARCH_WEB, ARCH_SYSTEMS],
            sliceTriggers: [],
        },
        serving: {
            track: TRACK_DEEP,
            isShared: false,
            memoryTier: TIER_OFFLOAD,
            steadyCostUs: 200,
            weight: 3.5,
            baseScore: calcBaseScore(3.5, 200),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: DIMENSION_ARCH,
            isSpecialized: true,
            isSecurityFamily: false,
            description:
                'Global import graph cycles, topological depth, and package boundary violations',
        },
    },

    // [25] Gate Architecture (Bit 1 << 25)
    {
        id: ANALYZER_GATE_ARCHITECTURE,
        bit: AnalyzerBit.GATE_ARCHITECTURE,
        index: 25,
        domain: DOMAIN_SYSTEM,
        affinities: {
            signals: [SIG_IMPORT_EXPORT, SIG_GENERAL_CODE],
            categories: [CATEGORY_IMPORT_EXPORT, CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_SYSTEMS, ARCH_STDLIB, ARCH_LIBRARY, ARCH_WEB],
            sliceTriggers: [],
        },
        serving: {
            track: TRACK_DEEP,
            isShared: false,
            memoryTier: TIER_OFFLOAD,
            steadyCostUs: 110,
            weight: 2.5,
            baseScore: calcBaseScore(2.5, 110),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: DIMENSION_ARCH,
            isSpecialized: true,
            isSecurityFamily: false,
            description: 'Gate architecture boundaries, subprocess isolation, and CI/local parity',
        },
    },

    // [26] GDScript Game (Bit 1 << 26)
    {
        id: ANALYZER_GDSCRIPT_GAME,
        bit: AnalyzerBit.GDSCRIPT_GAME,
        index: 26,
        domain: DOMAIN_AST,
        affinities: {
            signals: [SIG_GENERAL_CODE],
            categories: [CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_GAME],
            sliceTriggers: [],
        },
        serving: {
            track: TRACK_DEEP,
            isShared: false,
            memoryTier: TIER_OFFLOAD,
            steadyCostUs: 130,
            weight: DEFAULT_STEADY_WEIGHT,
            baseScore: calcBaseScore(DEFAULT_STEADY_WEIGHT, 130),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: DIMENSION_ARCH,
            isSpecialized: true,
            isSecurityFamily: false,
            description:
                'Godot game loop allocation hygiene, object pool lifecycle, and physics step safety',
        },
    },

    // [27] VSCode Extension (Bit 1 << 27)
    {
        id: ANALYZER_VSCODE_EXTENSION,
        bit: AnalyzerBit.VSCODE_EXTENSION,
        index: 27,
        domain: DOMAIN_SYSTEM,
        affinities: {
            signals: [SIG_GENERAL_CODE, SIG_MANIFEST],
            categories: [CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_WEB, ARCH_LIBRARY],
            sliceTriggers: [],
        },
        serving: {
            track: TRACK_DEEP,
            isShared: false,
            memoryTier: TIER_OFFLOAD,
            steadyCostUs: 150,
            weight: DEFAULT_STEADY_WEIGHT,
            baseScore: calcBaseScore(DEFAULT_STEADY_WEIGHT, 150),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: DIMENSION_ARCH,
            isSpecialized: true,
            isSecurityFamily: false,
            description:
                'VS Code extension API conventions, disposable lifecycle, and activation event discipline',
        },
    },

    // [28] Client Exposure (Bit 1 << 28)
    {
        id: ANALYZER_CLIENT_EXPOSURE,
        bit: AnalyzerBit.CLIENT_EXPOSURE,
        index: 28,
        domain: DOMAIN_SECURITY,
        affinities: {
            signals: [SIG_CONFIG_SECURITY, SIG_GENERAL_CODE, SIG_IO],
            categories: [CATEGORY_GENERAL_CODE, CATEGORY_INTERFACE_SIGNATURE],
            archetypes: [ARCH_WEB],
            sliceTriggers: ['hasIoMutation'],
        },
        serving: {
            track: TRACK_DEEP,
            isShared: false,
            memoryTier: TIER_OFFLOAD,
            steadyCostUs: 90,
            weight: 3.5,
            baseScore: calcBaseScore(3.5, 90),
            fallback: FALLBACK_BLOCK,
        },
        governance: {
            dimension: 'codeSecurity',
            isSpecialized: true,
            isSecurityFamily: true,
            description:
                'Client exposure risk, internal API leaks, CSS auth bypass, and route exposure',
        },
    },

    // [29] Test Modernity (Bit 1 << 29)
    {
        id: ANALYZER_TEST_MODERNITY,
        bit: AnalyzerBit.TEST_MODERNITY,
        index: 29,
        domain: DOMAIN_QUALITY,
        affinities: {
            signals: [SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
            categories: [CATEGORY_CONTROL_FLOW, CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_LIBRARY, ARCH_STDLIB, ARCH_WEB, ARCH_GAME, ARCH_SYSTEMS],
            sliceTriggers: [],
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
            isSpecialized: true,
            isSecurityFamily: false,
            description:
                'Test assertion modernity, mock isolation, deterministic clocks, and test suite hygiene',
        },
    },

    // [30] Governance (Bit 1 << 30)
    {
        id: ANALYZER_GOVERNANCE,
        bit: AnalyzerBit.GOVERNANCE,
        index: 30,
        domain: DOMAIN_SYSTEM,
        affinities: {
            signals: [SIG_IMPORT_EXPORT, SIG_GENERAL_CODE, SIG_NON_SOURCE],
            categories: [
                CATEGORY_IMPORT_EXPORT,
                CATEGORY_GENERAL_CODE,
                CATEGORY_INTERFACE_SIGNATURE,
            ],
            archetypes: ALL_ARCHETYPES,
            sliceTriggers: [
                'hasSignatureMutation',
                'hasControlFlowMutation',
                'hasIoMutation',
                'hasAsyncMutation',
            ],
        },
        serving: {
            track: TRACK_FAST,
            isShared: false,
            memoryTier: TIER_RESIDENT,
            steadyCostUs: 85,
            weight: 2.0,
            baseScore: calcBaseScore(2.0, 85),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'standardization',
            isSpecialized: false,
            isSecurityFamily: false,
            description:
                'Commit message format, license headers, PR templates, and workspace governance compliance',
        },
    },

    // [31] Concurrency (Bit 1 << 31)
    {
        id: ANALYZER_CONCURRENCY,
        bit: AnalyzerBit.CONCURRENCY,
        index: 31,
        domain: DOMAIN_CONCURRENCY,
        affinities: {
            signals: [SIG_ASYNC, SIG_CONCURRENCY, SIG_CONTROL_FLOW, SIG_GENERAL_CODE],
            categories: [CATEGORY_CONTROL_FLOW, CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_SYSTEMS, ARCH_GAME, ARCH_WEB, ARCH_LIBRARY, ARCH_STDLIB],
            sliceTriggers: ['hasAsyncMutation'],
        },
        serving: {
            track: TRACK_DEEP,
            isShared: false,
            memoryTier: TIER_OFFLOAD,
            steadyCostUs: 140,
            weight: 3.2,
            baseScore: calcBaseScore(3.2, 140),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'performanceEfficiency',
            isSpecialized: true,
            isSecurityFamily: false,
            description: 'Concurrency safety, lock bounds, async leak, and crash-recovery audit',
        },
    },
]);
