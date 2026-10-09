/**
 * Module: Core Rules — Canonical Topic Catalog & Sequence Continuity Registry
 * File Path: src/core/rules/topic-catalog.ts
 * Architecture Role: Single source of truth for canonical topic taxonomies,
 *   standard three-letter topic definitions, and historical sequence continuity locks.
 * Dependencies & Triggers: Consumed by core rule registries, validation harnesses,
 *   and documentation generators.
 * Responsibilities:
 *   1. Declare CANONICAL_TOPIC_CATALOG mapping rule families to recognized domain topics;
 *   2. Lock HISTORICAL_SEQUENCE_ANOMALIES documenting the 5 historical starting-002 pairs;
 *   3. Declare CANONICAL_3LETTER_GLOSSARY mapping non-standard topics to 3-letter codes;
 *   4. Provide normalizeTopicCode and toCanonicalRuleId normalization helpers;
 *   5. Provide auditTopicAndSequenceContinuity verification helper;
 *   6. Provide isStandard333RuleId topology validator and
 *      auditNonStandardTopicCoverage glossary check.
 * Exit Semantics & Design Rationale: Immutable, pure declarative metadata ensuring zero
 *   drift for rule topic taxonomy and preventing accidental numbering sequence gaps.
 */

import type { RuleDefinition, TopicGlossary } from './types';

/**
 * Metadata descriptor for a canonical rule topic.
 */
export interface TopicDescriptor {
    /** Topic code (e.g. 'LAY', 'CYC', 'MEM', 'TOK'). */
    topic: string;
    /** Owning rule family (e.g. 'ARCH', 'PRF', 'SEC'). */
    family: string;
    /** English description of the architectural or linguistic domain. */
    description: string;
    /** Standard recommended length in letters (typically 3). */
    standardLength: number;
}

/**
 * Historical sequence exception record with technical rationale.
 */
export interface SequenceAnomalyRecord {
    /** Full rule ID (e.g. 'NAM-JRG-002'). */
    ruleId: string;
    /** Rule family. */
    family: string;
    /** Topic code. */
    topic: string;
    /** Expected starting number if standard. */
    expectedStart: string;
    /** Actual starting number. */
    actualStart: string;
    /** Technical rationale explaining why 001 was consolidated or paired elsewhere. */
    rationale: string;
}

/**
 * Authoritative locked registry of the 5 historical rules starting at 002.
 * All other canonical topics across all 32 families strictly start at 001.
 */
export const HISTORICAL_SEQUENCE_ANOMALIES: Readonly<Record<string, SequenceAnomalyRecord>> =
    Object.freeze({
        'ARCH-DEC-002': {
            ruleId: 'ARCH-DEC-002',
            family: 'ARCH',
            topic: 'DEC',
            expectedStart: '001',
            actualStart: '002',
            rationale:
                'Paired across domains with naming decoupling rule NAM-DEC-001 (AST parser decoupling vs symbol decoupling).',
        },
        'ARCH-DSP-002': {
            ruleId: 'ARCH-DSP-002',
            family: 'ARCH',
            topic: 'DSP',
            expectedStart: '001',
            actualStart: '002',
            rationale:
                'Paired with 4-letter predecessor topic ARCH-DISP-001 (dispatcher pass-through vs dispatcher complexity).',
        },
        'GOV-RTC-002': {
            ruleId: 'GOV-RTC-002',
            family: 'GOV',
            topic: 'RTC',
            expectedStart: '001',
            actualStart: '002',
            rationale:
                'Baseline path rename tracking diagnostic rule, paired with engine-level monotonic ratchet gate.',
        },
        'NAM-JRG-002': {
            ruleId: 'NAM-JRG-002',
            family: 'NAM',
            topic: 'JRG',
            expectedStart: '001',
            actualStart: '002',
            rationale:
                'Historical jargon marker rule (variable jargon check consolidated into hygiene rule HYG-STB-002).',
        },
        'SIM-FLAT-002': {
            ruleId: 'SIM-FLAT-002',
            family: 'SIM',
            topic: 'FLAT',
            expectedStart: '001',
            actualStart: '002',
            rationale:
                'Deep control-flow flattening threshold rule (AR:SIM:002), paired with early guard return rule SIM-GUARD-001 (AR:SIM:013).',
        },
    });

/**
 * Canonical Topic Taxonomy covering all 32 rule families and their recognized topics.
 */
export const CANONICAL_TOPIC_CATALOG: Readonly<Record<string, readonly string[]>> = Object.freeze({
    ARCH: [
        'ABS',
        'BLR',
        'BND',
        'CFG',
        'DEC',
        'DIR',
        'DISP',
        'DSP',
        'FAC',
        'GLB',
        'HDL',
        'LAY',
        'LEAK',
        'MOD',
        'MON',
        'RES',
        'ROL',
        'SKL',
        'STK',
        'TMP',
        'UTL',
    ],
    BIG: ['SIZE'],
    CMP: ['CAL', 'DEN', 'EXP', 'LIN'],
    CMT: ['BAN', 'CON', 'DOC', 'ENG', 'HDR', 'INT', 'LNG', 'MOJI', 'SEP', 'TRM', 'VMD', 'WID'],
    CONST: ['CLU', 'DRF', 'LAY', 'LIB', 'OWN', 'SCP'],
    CPX: ['AMP', 'BUD', 'HOP', 'JST', 'NEST', 'REC', 'RED', 'SPACE', 'STM', 'TIME'],
    DAT: ['DEF', 'LAY', 'NPL', 'QRY', 'RES', 'SER'],
    DEP: ['INV', 'LAZ', 'ORD', 'RES', 'WLD'],
    DOC: ['DUP', 'FEN', 'LNK', 'TRM'],
    ERR: ['PRP'],
    GATE: [
        'AST',
        'BUDGET',
        'ERR',
        'FAC',
        'HOOK',
        'HYG',
        'ISO',
        'MSG',
        'PAIR',
        'PROC',
        'ROUTE',
        'SSOT',
        'SYS',
    ],
    GDM: [
        'BAR',
        'BND',
        'CONNECT',
        'DEB',
        'EXPORT',
        'EXT',
        'FSM',
        'I18N',
        'ISO',
        'LOC',
        'NOD',
        'ONREADY',
        'POL',
        'POOL',
        'PRF',
        'RES',
        'RPC',
        'SIG',
        'TOK',
        'TOOL',
        'UNI',
        'VRT',
        'WEAK',
        'YIELD',
    ],
    GOM: ['CTX', 'ERR', 'STYLE'],
    GOV: [
        'AGN',
        'ARC',
        'BLS',
        'DAT',
        'DBG',
        'EXC',
        'FIL',
        'GAM',
        'LOG',
        'MNT',
        'MSG',
        'PRF',
        'RTC',
        'RUL',
        'SAN',
        'SLC',
        'STD',
        'TRJ',
        'TYP',
    ],
    HYG: ['BLT', 'CLN', 'DED', 'EMP', 'EXC', 'NAM', 'SGL', 'STB', 'WRAP'],
    NAM: [
        'ABR',
        'COL',
        'DEC',
        'DIR',
        'FIL',
        'GLB',
        'JRG',
        'LEN',
        'MBR',
        'RES',
        'SGL',
        'TYP',
        'VAG',
    ],
    NUM: ['PREC'],
    PRF: ['ALG', 'IO', 'LEAK', 'MEM', 'POL'],
    PROD: ['HYG'],
    PS: ['ALIAS', 'CMDLET', 'DOC', 'ERROR', 'PARAM', 'SAFE', 'SEC', 'TRAP', 'VERB'],
    PYM: [
        'ABC',
        'ASYNC',
        'DATETIME',
        'DEFAULT',
        'FSTRING',
        'GENERIC',
        'IMPORT',
        'OPEN',
        'PATH',
        'RAISE',
        'SHADOW',
        'SLOTS',
        'UNION',
    ],
    RSM: [
        'CAST',
        'CLONE',
        'ELSE',
        'EXTERN',
        'FIND',
        'FORMAT',
        'LOCK',
        'MACRO',
        'STR',
        'TRY',
        'UNWRAP',
    ],
    SEC: ['EXP', 'LEAK', 'VUL'],
    SH: [
        'ARRAY',
        'CMD',
        'COND',
        'DEPR',
        'DOC',
        'ECHO',
        'EOL',
        'ERR',
        'EXIT',
        'INIT',
        'QUOTE',
        'READ',
        'SAFE',
        'SEC',
        'TRAP',
    ],
    SIM: ['ARGS', 'BOOL', 'COMC', 'ELSE', 'EMPTY', 'FLAT', 'GUARD', 'IMM', 'LONG', 'PRNT', 'TRN'],
    STDLIB: ['ALLOC', 'CONST', 'PANIC', 'PORT', 'RECURSION', 'UNSAFE'],
    TSM: [
        'ANY',
        'ARGS',
        'CTOR',
        'DISP',
        'INCLUDES',
        'REPLACE',
        'REQUIRE',
        'SPREAD',
        'SUBSTR',
        'TYPE',
        'VAR',
    ],
    TST: ['DBT', 'DEN', 'FLT', 'ILS', 'SKP', 'TAU', 'TOP'],
    UI: ['ENG'],
    VSC: ['I18N', 'MEM', 'PERF', 'UI'],
});

/**
 * Pre-indexed Set lookup for canonical topics per family to ensure O(1) membership checks.
 */
const CANONICAL_TOPIC_SETS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze(
    Object.fromEntries(
        Object.entries(CANONICAL_TOPIC_CATALOG).map(([family, topics]) => [
            family,
            new Set(topics),
        ]),
    ),
);

/**
 * Authoritative glossary mapping non-standard topic codes (4+ letters or historical abbreviations)
 * across all 30 rule families and legacy rules to canonical 3-letter codes.
 */
export const CANONICAL_3LETTER_GLOSSARY: TopicGlossary = Object.freeze({
    ALIAS: 'ALS',
    ALLOC: 'ALC',
    ARGS: 'ARG',
    ARRAY: 'ARR',
    ASSERT: 'AST',
    ASYNC: 'ASY',
    BIND: 'BND',
    BOOL: 'BOL',
    BUDGET: 'BDG',
    CALL: 'CLL',
    CAST: 'CST',
    CLON: 'CLN',
    CLONE: 'CLN',
    CMDLET: 'CMD',
    COMC: 'CMC',
    COND: 'CND',
    CONNECT: 'CNT',
    CONST: 'CST',
    CTOR: 'CTR',
    CYCLE: 'CYC',
    DATETIME: 'DTT',
    DEAD: 'DED',
    DEFAULT: 'DFT',
    DEPR: 'DPR',
    DISP: 'DSP',
    ECHO: 'ECH',
    ELSE: 'ELS',
    EMPTY: 'EMP',
    ERROR: 'ERR',
    EXIT: 'EXT',
    EXPORT: 'EXP',
    EXTERN: 'EXT',
    FIND: 'FND',
    FLAT: 'FLT',
    FLOAT: 'FLT',
    FORMAT: 'FMT',
    FSTRING: 'FST',
    GENERIC: 'GNR',
    GUARD: 'GRD',
    HOOK: 'HOK',
    I18N: 'ITN',
    IMPORT: 'IMP',
    INCLUDES: 'INC',
    INIT: 'INT',
    IO: 'IOP',
    LEAK: 'LEK',
    LIFECYCLE: 'LFC',
    LOCK: 'LCK',
    LONG: 'LNG',
    LOOP: 'LOP',
    MACRO: 'MCR',
    MATCH: 'MTC',
    MOJI: 'MOJ',
    MUTATE: 'MUT',
    NEST: 'NST',
    ONREADY: 'RDY',
    OPEN: 'OPN',
    PAIR: 'PAR',
    PANIC: 'PNC',
    PARAM: 'PRM',
    PARSE: 'PRS',
    PATH: 'PTH',
    PERF: 'PRF',
    POOL: 'POL',
    PORT: 'PRT',
    PREC: 'PRC',
    PRNT: 'PNT',
    PROC: 'PCS',
    PROP: 'PRP',
    QUOTE: 'QTE',
    RAISE: 'RSE',
    READ: 'RED',
    RECURSION: 'REC',
    REPLACE: 'RPL',
    REQUIRE: 'REQ',
    RESOURCE: 'RSC',
    ROUTE: 'RTE',
    RULE: 'RUL',
    SAFE: 'SFE',
    SECRET: 'TOK',
    SHADOW: 'SHD',
    SIZE: 'SZE',
    SLOT: 'SLT',
    SLOTS: 'SLT',
    SPACE: 'SPC',
    SPREAD: 'SPD',
    SSOT: 'SST',
    STRUCT: 'STR',
    STYLE: 'STY',
    SUBSTR: 'SUB',
    SUPER: 'SPR',
    SYNC: 'SNC',
    TASK: 'TSK',
    TIME: 'TME',
    TOOL: 'TOL',
    TRAN: 'TRN',
    TRAP: 'TRP',
    TYPE: 'TYP',
    UI: 'GUI',
    UNION: 'UNN',
    UNSAFE: 'UNS',
    UNWRAP: 'UNW',
    VERB: 'VRB',
    VOID: 'VOD',
    WEAK: 'WEK',
    WRAP: 'WRP',
    YIELD: 'YLD',
});

/**
 * Normalize an arbitrary topic code to its canonical 3-letter standard.
 *
 * @param topic - Input topic string (case-insensitive).
 * @returns Standard 3-letter uppercase code if mapped or already 3 letters,
 *   otherwise original uppercase.
 */
export function normalizeTopicCode(topic: string): string {
    if (!topic) {
        return topic;
    }
    const upper = topic.toUpperCase();
    const mapped = CANONICAL_3LETTER_GLOSSARY[upper];
    if (mapped) {
        return mapped;
    }
    if (upper.length === 3) {
        return upper;
    }
    return upper;
}

/**
 * Convert a rule ID into its canonical 3-letter topic form.
 *
 * @param ruleId - Tri-part rule ID string (e.g. "ARCH-DISP-001").
 * @returns Normalized canonical rule ID (e.g. "ARCH-DSP-001"), or original
 *   string if not matching tri-part shape.
 */
export function toCanonicalRuleId(ruleId: string): string {
    if (typeof ruleId !== 'string') {
        return ruleId;
    }
    const parts = ruleId.split('-');
    if (parts.length !== 3) {
        return ruleId;
    }
    const [family, topic, seq] = parts;
    if (!family || !topic || !seq) {
        return ruleId;
    }
    if (!/^[A-Za-z][A-Za-z0-9]{1,5}$/.test(family) || !/^\d+$/.test(seq)) {
        return ruleId;
    }
    const canonicalTopic = normalizeTopicCode(topic);
    return `${family.toUpperCase()}-${canonicalTopic}-${seq}`;
}

/**
 * Result of topic and sequence continuity audit.
 */
export interface SequenceAuditResult {
    /** True if all rules conform to catalog and sequence invariants. */
    valid: boolean;
    /** Any uncatalogued topic codes found. */
    unregisteredTopics: string[];
    /** Any unexpected sequence gaps (outside historical anomalies). */
    unexpectedGaps: string[];
}

/**
 * Extract family, topic, and number from a canonical rule definition.
 */
function extractRuleKey(
    rule: RuleDefinition,
): { family: string; topic: string; num: number } | null {
    if (!rule.canonical) return null;
    const parts = rule.id.split('-');
    if (parts.length < 3) return null;
    return {
        family: parts[0],
        topic: parts.slice(1, -1).join('-'),
        num: parseInt(parts[parts.length - 1], 10),
    };
}

/**
 * Collect and group numeric sequences by family:topic while validating topic catalog registration.
 */
function collectTopicNumbers(
    rules: readonly RuleDefinition[],
    unregisteredSet: Set<string>,
): Map<string, number[]> {
    const topicNumberMap = new Map<string, number[]>();
    for (const rule of rules) {
        const info = extractRuleKey(rule);
        if (!info) continue;

        const { family, topic, num } = info;
        const recognizedSet = CANONICAL_TOPIC_SETS[family];
        if (!recognizedSet || !recognizedSet.has(topic)) {
            unregisteredSet.add(`${family}-${topic}`);
        }

        const groupKey = `${family}:${topic}`;
        const existing = topicNumberMap.get(groupKey);
        if (existing) {
            existing.push(num);
        } else {
            topicNumberMap.set(groupKey, [num]);
        }
    }
    return topicNumberMap;
}

/**
 * Check a single topic sequence for starting value correctness and internal continuity.
 */
function checkTopicSequence(groupKey: string, nums: readonly number[]): string[] {
    const gaps: string[] = [];
    const sorted = [...nums].sort((a, b) => a - b);
    const [family, topic] = groupKey.split(':');
    const minNum = sorted[0];

    if (minNum !== 1) {
        const ruleId = `${family}-${topic}-${String(minNum).padStart(3, '0')}`;
        if (!HISTORICAL_SEQUENCE_ANOMALIES[ruleId]) {
            gaps.push(`${groupKey} starts at ${minNum} instead of 001 without registered anomaly`);
        }
    }

    for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i + 1] !== sorted[i] + 1) {
            gaps.push(
                `${groupKey} has gap between ${String(sorted[i]).padStart(3, '0')} and ${String(sorted[i + 1]).padStart(3, '0')}`,
            );
        }
    }
    return gaps;
}

/**
 * Audit rule definitions against canonical topic catalog and sequence continuity invariants.
 *
 * @param rules - List of rule definitions to audit.
 * @returns Verification result with detailed gap diagnostics.
 */
export function auditTopicAndSequenceContinuity(
    rules: readonly RuleDefinition[],
): SequenceAuditResult {
    const unregisteredSet = new Set<string>();
    const topicNumberMap = collectTopicNumbers(rules, unregisteredSet);
    const unexpectedGaps: string[] = [];

    for (const [groupKey, nums] of topicNumberMap.entries()) {
        const groupGaps = checkTopicSequence(groupKey, nums);
        for (const gap of groupGaps) {
            unexpectedGaps.push(gap);
        }
    }

    const unregisteredTopics = Array.from(unregisteredSet).sort();
    return {
        valid: unregisteredTopics.length === 0 && unexpectedGaps.length === 0,
        unregisteredTopics,
        unexpectedGaps,
    };
}

/**
 * Validator harness alias for auditTopicAndSequenceContinuity.
 */
export const validateTopicAndSequenceContinuity = auditTopicAndSequenceContinuity;

/**
 * Regular expression matching standard 3-3-3 rule IDs
 * (3-letter family, 3-letter topic, 3-digit sequence).
 */
export const STANDARD_333_RULE_ID_PATTERN = /^[A-Z]{3}-[A-Z]{3}-\d{3}$/;

/**
 * Determine whether a given rule identifier conforms to the strict 3-3-3 topological convention
 * (3-letter uppercase family, 3-letter uppercase topic, 3-digit zero-padded sequence).
 *
 * @param ruleId - Candidate rule identifier string.
 * @returns True if ruleId matches FAMILY-TOPIC-NNN where all three segments have length 3.
 */
export function isStandard333RuleId(ruleId: string): boolean {
    if (typeof ruleId !== 'string') {
        return false;
    }
    return STANDARD_333_RULE_ID_PATTERN.test(ruleId);
}

/**
 * Result of auditing canonical rules for non-standard topic code glossary coverage.
 */
export interface NonStandardTopicAuditResult {
    /** Unique list of non-3-letter topic codes observed in canonical rules. */
    nonStandardTopics: string[];
    /** Any observed non-3-letter topic codes lacking a mapping in CANONICAL_3LETTER_GLOSSARY. */
    missingGlossaryEntries: string[];
}

/**
 * Audit canonical rule definitions to verify that all non-3-letter topic codes have authoritative
 * entries registered in CANONICAL_3LETTER_GLOSSARY.
 *
 * @param rules - List of rule definitions to audit.
 * @returns Non-standard topic list and any missing glossary entries.
 */
export function auditNonStandardTopicCoverage(
    rules: readonly RuleDefinition[],
): NonStandardTopicAuditResult {
    const nonStandardSet = new Set<string>();
    const missingSet = new Set<string>();

    for (const rule of rules) {
        const info = extractRuleKey(rule);
        if (!info) {
            continue;
        }

        const { topic } = info;
        if (topic.length === 3) {
            continue;
        }

        nonStandardSet.add(topic);
        const mapped = CANONICAL_3LETTER_GLOSSARY[topic.toUpperCase()];
        if (!mapped) {
            missingSet.add(topic);
        }
    }

    return {
        nonStandardTopics: Array.from(nonStandardSet).sort(),
        missingGlossaryEntries: Array.from(missingSet).sort(),
    };
}

/**
 * Validator harness alias for auditNonStandardTopicCoverage.
 */
export const validateNonStandardTopicCoverage = auditNonStandardTopicCoverage;
