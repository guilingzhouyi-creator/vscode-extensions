/**
 * Module: Core Experts - Core Hygiene, Security & Lexical Expert Catalog
 * File Path: src/core/experts/catalog/core-experts.ts
 * Architecture Role: Stage 0 and Stage 1 expert definitions covering physical hygiene,
 *   critical security, secrets, comments, docs, and naming conventions.
 * Dependencies & Triggers: Consumed by expert-catalog.
 * Responsibilities:
 *   Declare normative profiles for core baseline and security experts (indexes 0..10).
 * Exit Semantics & Design Rationale: Immutable declarative definitions satisfying ELOC budget.
 */

import { AnalyzerBit } from '../../constants/analyzer-bitmask';
import {
    ANALYZER_CONSTANTS,
    ANALYZER_LARGE_FILE,
    ANALYZER_SECRETS,
    ANALYZER_COMMENTS,
    ANALYZER_HYGIENE,
    ANALYZER_SECURITY,
    ANALYZER_DOCS,
    ANALYZER_NAMING,
    ANALYZER_SHELL_LINT,
    ANALYZER_PRODUCTION_HYGIENE,
    ANALYZER_SHELL_SAFETY,
} from '../../scoring/dimensionLiterals';
import {
    CATEGORY_LITERAL_ONLY,
    CATEGORY_CONTROL_FLOW,
    CATEGORY_INTERFACE_SIGNATURE,
    CATEGORY_IMPORT_EXPORT,
    CATEGORY_COMMENT_DOC_ONLY,
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
const SIG_INSTRUCTION_SURFACE = 'INSTRUCTION_SURFACE' as const;
const SIG_IO = 'IO' as const;
const SIG_CONFIG_SECURITY = 'CONFIG_SECURITY' as const;
const SIG_LITERAL = 'LITERAL' as const;
const SIG_COMMENT_DOC_ONLY = 'COMMENT_DOC_ONLY' as const;
const SIG_DOC_COMMENT = 'DOC_COMMENT' as const;
const SIG_INTERFACE_SIGNATURE = 'INTERFACE_SIGNATURE' as const;
const SIG_MANIFEST = 'MANIFEST' as const;

const LANG_SHELL = 'shell' as const;

const TRACK_FAST = 'fast' as const;
const TIER_RESIDENT = 'resident' as const;
const FALLBACK_ESCALATE_DEEP = 'escalate-deep' as const;
const FALLBACK_BLOCK = 'block' as const;

const DOMAIN_HYGIENE = 'hygiene' as const;
const DOMAIN_SYSTEM = 'system' as const;
const DOMAIN_SECURITY = 'security' as const;
const DOMAIN_LEXICAL = 'lexical' as const;

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
 * Stage 0 & Stage 1 Core Experts (Bit 0..10).
 * Baseline physical hygiene, shell governance, secrets, and fundamental lexical analyzers.
 */
export const CORE_EXPERTS: readonly MoEExpertProfile[] = Object.freeze([
    // [0] Hygiene (Bit 1 << 0)
    {
        id: ANALYZER_HYGIENE,
        bit: AnalyzerBit.HYGIENE,
        index: 0,
        domain: DOMAIN_HYGIENE,
        affinities: {
            signals: [SIG_NON_SOURCE, SIG_GENERAL_CODE],
            categories: [
                CATEGORY_GENERAL_CODE,
                CATEGORY_LITERAL_ONLY,
                CATEGORY_CONTROL_FLOW,
                CATEGORY_INTERFACE_SIGNATURE,
                CATEGORY_IMPORT_EXPORT,
                CATEGORY_COMMENT_DOC_ONLY,
            ],
            archetypes: ALL_ARCHETYPES,
            sliceTriggers: ['hasSignatureMutation'],
        },
        serving: {
            track: TRACK_FAST,
            isShared: true,
            memoryTier: TIER_RESIDENT,
            steadyCostUs: 30,
            weight: 2.0,
            baseScore: calcBaseScore(2.0, 30),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'standardization',
            isSpecialized: false,
            isSecurityFamily: false,
            description:
                'Physical file cleanliness, empty files/dirs, BOM, EOF newlines, and naming conventions',
        },
    },

    // [1] Shell Lint (Bit 1 << 1)
    {
        id: ANALYZER_SHELL_LINT,
        bit: AnalyzerBit.SHELL_LINT,
        index: 1,
        domain: DOMAIN_SYSTEM,
        affinities: {
            signals: [SIG_GENERAL_CODE, SIG_INSTRUCTION_SURFACE],
            categories: [CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_SYSTEMS, ARCH_STDLIB, ARCH_LIBRARY, ARCH_WEB, ARCH_GAME],
            languages: [LANG_SHELL],
            sliceTriggers: [],
        },
        serving: {
            track: TRACK_FAST,
            isShared: false,
            memoryTier: TIER_RESIDENT,
            steadyCostUs: 50,
            weight: 1.5,
            baseScore: calcBaseScore(1.5, 50),
            fallback: FALLBACK_BLOCK,
        },
        governance: {
            dimension: 'standardization',
            isSpecialized: false,
            isSecurityFamily: false,
            description:
                'Shell script and PowerShell governance, error trapping, and cross-platform safety',
        },
    },

    // [2] Shell Safety (Bit 1 << 2)
    {
        id: ANALYZER_SHELL_SAFETY,
        bit: AnalyzerBit.SHELL_SAFETY,
        index: 2,
        domain: DOMAIN_SECURITY,
        affinities: {
            signals: [SIG_GENERAL_CODE],
            categories: [CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_SYSTEMS, ARCH_STDLIB, ARCH_LIBRARY, ARCH_WEB, ARCH_GAME],
            sliceTriggers: [],
        },
        serving: {
            track: TRACK_FAST,
            isShared: false,
            memoryTier: TIER_RESIDENT,
            steadyCostUs: 60,
            weight: 2.0,
            baseScore: calcBaseScore(2.0, 60),
            fallback: FALLBACK_BLOCK,
        },
        governance: {
            dimension: 'codeSecurity',
            isSpecialized: false,
            isSecurityFamily: true,
            description:
                'Destructive delete operand provenance and read-only automatic variable shadowing',
        },
    },

    // [3] Large File (Bit 1 << 3)
    {
        id: ANALYZER_LARGE_FILE,
        bit: AnalyzerBit.LARGE_FILE,
        index: 3,
        domain: DOMAIN_HYGIENE,
        affinities: {
            signals: [SIG_NON_SOURCE, SIG_GENERAL_CODE],
            categories: [CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_LIBRARY, ARCH_STDLIB, ARCH_WEB, ARCH_GAME, ARCH_SYSTEMS],
            sliceTriggers: [],
        },
        serving: {
            track: TRACK_FAST,
            isShared: false,
            memoryTier: TIER_RESIDENT,
            steadyCostUs: 30,
            weight: 1.0,
            baseScore: calcBaseScore(1.0, 30),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'maintainability',
            isSpecialized: false,
            isSecurityFamily: false,
            description: 'Source code and test volume boundaries (LOC and ELOC ceilings)',
        },
    },

    // [4] Secrets (Bit 1 << 4)
    {
        id: ANALYZER_SECRETS,
        bit: AnalyzerBit.SECRETS,
        index: 4,
        domain: DOMAIN_SECURITY,
        affinities: {
            signals: [SIG_LITERAL, SIG_GENERAL_CODE, SIG_NON_SOURCE],
            categories: [CATEGORY_LITERAL_ONLY, CATEGORY_GENERAL_CODE],
            archetypes: ALL_ARCHETYPES,
            sliceTriggers: ['hasLiteralMutation'],
        },
        serving: {
            track: TRACK_FAST,
            isShared: false,
            memoryTier: TIER_RESIDENT,
            steadyCostUs: 40,
            weight: 4.5,
            baseScore: calcBaseScore(4.5, 40),
            fallback: FALLBACK_BLOCK,
        },
        governance: {
            dimension: 'codeSecurity',
            isSpecialized: false,
            isSecurityFamily: true,
            description: 'High-entropy credentials, private keys, tokens, and hardcoded secrets',
        },
    },

    // [5] Security (Bit 1 << 5)
    {
        id: ANALYZER_SECURITY,
        bit: AnalyzerBit.SECURITY,
        index: 5,
        domain: DOMAIN_SECURITY,
        affinities: {
            signals: [SIG_IO, SIG_GENERAL_CODE, SIG_CONFIG_SECURITY],
            categories: [CATEGORY_GENERAL_CODE, CATEGORY_INTERFACE_SIGNATURE],
            archetypes: [ARCH_WEB, ARCH_SYSTEMS, ARCH_STDLIB, ARCH_LIBRARY, ARCH_GAME],
            sliceTriggers: ['hasIoMutation'],
        },
        serving: {
            track: TRACK_FAST,
            isShared: false,
            memoryTier: TIER_RESIDENT,
            steadyCostUs: 95,
            weight: 4.5,
            baseScore: calcBaseScore(4.5, 95),
            fallback: FALLBACK_BLOCK,
        },
        governance: {
            dimension: 'codeSecurity',
            isSpecialized: false,
            isSecurityFamily: true,
            description:
                'Injection vulnerabilities, taint sinks, prototype pollution, and unsafe deserialization',
        },
    },

    // [6] Comments (Bit 1 << 6)
    {
        id: ANALYZER_COMMENTS,
        bit: AnalyzerBit.COMMENTS,
        index: 6,
        domain: DOMAIN_LEXICAL,
        affinities: {
            signals: [SIG_COMMENT_DOC_ONLY, SIG_DOC_COMMENT, SIG_GENERAL_CODE],
            categories: [CATEGORY_COMMENT_DOC_ONLY, CATEGORY_GENERAL_CODE],
            archetypes: ALL_ARCHETYPES,
            sliceTriggers: ['isDocOnly'],
        },
        serving: {
            track: TRACK_FAST,
            isShared: false,
            memoryTier: TIER_RESIDENT,
            steadyCostUs: 40,
            weight: 1.0,
            baseScore: calcBaseScore(1.0, 40),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'commentQuality',
            isSpecialized: false,
            isSecurityFamily: false,
            description:
                'JSDoc completeness, comment density, dead code blocks, and ghost branches',
        },
    },

    // [7] Naming (Bit 1 << 7)
    {
        id: ANALYZER_NAMING,
        bit: AnalyzerBit.NAMING,
        index: 7,
        domain: DOMAIN_LEXICAL,
        affinities: {
            signals: [SIG_INTERFACE_SIGNATURE, SIG_GENERAL_CODE],
            categories: [CATEGORY_INTERFACE_SIGNATURE, CATEGORY_GENERAL_CODE],
            archetypes: ALL_ARCHETYPES,
            sliceTriggers: [],
        },
        serving: {
            track: TRACK_FAST,
            isShared: false,
            memoryTier: TIER_RESIDENT,
            steadyCostUs: 70,
            weight: 2.0,
            baseScore: calcBaseScore(2.0, 70),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'maintainability',
            isSpecialized: false,
            isSecurityFamily: false,
            description:
                'Identifier casing, boolean prefix contracts, Hungarian prefix avoidance, and lexical sanity',
        },
    },

    // [8] Constants (Bit 1 << 8)
    {
        id: ANALYZER_CONSTANTS,
        bit: AnalyzerBit.CONSTANTS,
        index: 8,
        domain: DOMAIN_LEXICAL,
        affinities: {
            signals: [SIG_LITERAL, SIG_GENERAL_CODE],
            categories: [CATEGORY_LITERAL_ONLY, CATEGORY_GENERAL_CODE],
            archetypes: ALL_ARCHETYPES,
            sliceTriggers: ['hasLiteralMutation'],
        },
        serving: {
            track: TRACK_FAST,
            isShared: true,
            memoryTier: TIER_RESIDENT,
            steadyCostUs: 45,
            weight: 1.0,
            baseScore: calcBaseScore(1.0, 45),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'duplication',
            isSpecialized: false,
            isSecurityFamily: false,
            description: 'Magic numbers and duplicate literal extraction',
        },
    },

    // [9] Docs (Bit 1 << 9)
    {
        id: ANALYZER_DOCS,
        bit: AnalyzerBit.DOCS,
        index: 9,
        domain: DOMAIN_LEXICAL,
        affinities: {
            signals: [SIG_COMMENT_DOC_ONLY, SIG_GENERAL_CODE],
            categories: [CATEGORY_COMMENT_DOC_ONLY, CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_LIBRARY, ARCH_STDLIB, ARCH_WEB, ARCH_GAME, ARCH_SYSTEMS],
            sliceTriggers: ['isDocOnly'],
        },
        serving: {
            track: TRACK_FAST,
            isShared: false,
            memoryTier: TIER_RESIDENT,
            steadyCostUs: 50,
            weight: 1.0,
            baseScore: calcBaseScore(1.0, 50),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'commentQuality',
            isSpecialized: false,
            isSecurityFamily: false,
            description:
                'Markdown link integrity, section completeness, relative dead links, and documentation hygiene',
        },
    },

    // [10] Production Hygiene (Bit 1 << 10)
    {
        id: ANALYZER_PRODUCTION_HYGIENE,
        bit: AnalyzerBit.PRODUCTION_HYGIENE,
        index: 10,
        domain: DOMAIN_HYGIENE,
        affinities: {
            signals: [SIG_GENERAL_CODE, SIG_MANIFEST, SIG_CONFIG_SECURITY],
            categories: [CATEGORY_GENERAL_CODE],
            archetypes: [ARCH_WEB, ARCH_SYSTEMS, ARCH_GAME, ARCH_LIBRARY],
            sliceTriggers: [],
        },
        serving: {
            track: TRACK_FAST,
            isShared: false,
            memoryTier: TIER_RESIDENT,
            steadyCostUs: 70,
            weight: 2.5,
            baseScore: calcBaseScore(2.5, 70),
            fallback: FALLBACK_ESCALATE_DEEP,
        },
        governance: {
            dimension: 'codeSecurity',
            isSpecialized: true,
            isSecurityFamily: false,
            description:
                'Production build hygiene, debug residue, source map, and secret leak guard',
        },
    },
]);
