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
 *   3. Provide auditTopicAndSequenceContinuity() verification helper.
 * Exit Semantics & Design Rationale: Immutable, pure declarative metadata ensuring zero
 *   drift for rule topic taxonomy and preventing accidental numbering sequence gaps.
 */

import type { RuleDefinition } from './types';

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
export const HISTORICAL_SEQUENCE_ANOMALIES: Readonly<Record<string, SequenceAnomalyRecord>> = Object.freeze({
    'ARCH-DEC-002': {
        ruleId: 'ARCH-DEC-002',
        family: 'ARCH',
        topic: 'DEC',
        expectedStart: '001',
        actualStart: '002',
        rationale: 'Paired across domains with naming decoupling rule NAM-DEC-001 (AST parser decoupling vs symbol decoupling).',
    },
    'ARCH-DSP-002': {
        ruleId: 'ARCH-DSP-002',
        family: 'ARCH',
        topic: 'DSP',
        expectedStart: '001',
        actualStart: '002',
        rationale: 'Paired with 4-letter predecessor topic ARCH-DISP-001 (dispatcher pass-through vs dispatcher complexity).',
    },
    'GOV-RTC-002': {
        ruleId: 'GOV-RTC-002',
        family: 'GOV',
        topic: 'RTC',
        expectedStart: '001',
        actualStart: '002',
        rationale: 'Baseline path rename tracking diagnostic rule, paired with engine-level monotonic ratchet gate.',
    },
    'NAM-JRG-002': {
        ruleId: 'NAM-JRG-002',
        family: 'NAM',
        topic: 'JRG',
        expectedStart: '001',
        actualStart: '002',
        rationale: 'Historical jargon marker rule (variable jargon check consolidated into hygiene rule HYG-STB-002).',
    },
    'SIM-FLAT-002': {
        ruleId: 'SIM-FLAT-002',
        family: 'SIM',
        topic: 'FLAT',
        expectedStart: '001',
        actualStart: '002',
        rationale: 'Deep control-flow flattening threshold rule (AR:SIM:002), paired with early guard return rule SIM-GUARD-001 (AR:SIM:013).',
    },
});

/**
 * Canonical Topic Taxonomy covering all 32 rule families and their recognized topics.
 */
export const CANONICAL_TOPIC_CATALOG: Readonly<Record<string, readonly string[]>> = Object.freeze({
    ARCH: [
        'ABS', 'BLR', 'BND', 'CFG', 'DEC', 'DIR', 'DISP', 'DSP',
        'FAC', 'GLB', 'HDL', 'LAY', 'LEAK', 'MOD', 'MON', 'RES',
        'ROL', 'SKL', 'STK', 'TMP', 'UTL',
    ],
    ARC: ['LAY'],
    BIG: ['SIZE'],
    CMP: ['CAL', 'DEN', 'EXP', 'LIN'],
    CMT: ['BAN', 'CON', 'DOC', 'ENG', 'HDR', 'INT', 'LNG', 'MOJI', 'SEP', 'TRM', 'VMD', 'WID'],
    CONST: ['CLU', 'DRF', 'LAY', 'LIB', 'OWN', 'SCP'],
    CPX: ['AMP', 'BUD', 'HOP', 'JST', 'NEST', 'REC', 'RED', 'SPACE', 'STM', 'TIME'],
    DAT: ['DEF', 'LAY', 'NPL', 'QRY', 'RES', 'SER'],
    DEP: ['INV', 'LAZ', 'ORD', 'RES', 'WLD'],
    DOC: ['DUP', 'FEN', 'LNK', 'TRM'],
    ERR: ['PRP'],
    GATE: ['AST', 'BUDGET', 'ERR', 'FAC', 'HOOK', 'HYG', 'ISO', 'MSG', 'PAIR', 'PROC', 'ROUTE', 'SSOT', 'SYS'],
    GDM: [
        'BAR', 'BND', 'CONNECT', 'DEB', 'EXPORT', 'EXT', 'FSM', 'I18N',
        'ISO', 'LOC', 'NOD', 'ONREADY', 'POL', 'POOL', 'PRF', 'RES',
        'RPC', 'SIG', 'TOK', 'TOOL', 'UNI', 'VRT', 'WEAK', 'YIELD',
    ],
    GOM: ['CTX', 'ERR', 'STYLE'],
    GOV: [
        'AGN', 'ARC', 'BLS', 'DAT', 'DBG', 'EXC', 'FIL', 'GAM',
        'LOG', 'MNT', 'MSG', 'PRF', 'RTC', 'RUL', 'SAN', 'SLC',
        'STD', 'TRJ', 'TYP',
    ],
    HYG: ['BLT', 'CLN', 'DED', 'EMP', 'EXC', 'NAM', 'SGL', 'STB', 'WRAP'],
    NAM: ['ABR', 'COL', 'DEC', 'DIR', 'FIL', 'GLB', 'JRG', 'LEN', 'MBR', 'RES', 'SGL', 'TYP', 'VAG'],
    NUM: ['PREC'],
    PRF: ['ALG', 'IO', 'LEAK', 'MEM', 'POL'],
    PROD: ['HYG'],
    PS: ['ALIAS', 'CMDLET', 'DOC', 'ERROR', 'PARAM', 'SAFE', 'SEC', 'TRAP', 'VERB'],
    PYM: ['ABC', 'ASYNC', 'DATETIME', 'DEFAULT', 'FSTRING', 'GENERIC', 'IMPORT', 'OPEN', 'PATH', 'RAISE', 'SHADOW', 'SLOTS', 'UNION'],
    RSM: ['CLONE', 'EXTERN', 'FORMAT', 'MACRO', 'STR', 'TRY', 'UNWRAP'],
    SEC: ['EXP', 'LEAK', 'VUL'],
    SH: ['ARRAY', 'CMD', 'COND', 'DEPR', 'DOC', 'ECHO', 'EOL', 'ERR', 'EXIT', 'INIT', 'QUOTE', 'READ', 'SAFE', 'SEC', 'TRAP'],
    SIM: ['ARGS', 'BOOL', 'COMC', 'ELSE', 'EMPTY', 'FLAT', 'GUARD', 'IMM', 'LONG', 'PRNT', 'TRN'],
    STDLIB: ['ALLOC', 'CONST', 'PANIC', 'PORT', 'RECURSION', 'UNSAFE'],
    TSM: ['ANY', 'ARGS', 'CTOR', 'DISP', 'INCLUDES', 'REPLACE', 'REQUIRE', 'SPREAD', 'SUBSTR', 'TYPE', 'VAR'],
    TST: ['DBT', 'DEN', 'FLT', 'ILS', 'SKP', 'TAU', 'TOP'],
    UI: ['ENG'],
    VSC: ['I18N', 'MEM', 'PERF', 'UI'],
});

/**
 * Pre-indexed Set lookup for canonical topics per family to ensure O(1) membership checks.
 */
const CANONICAL_TOPIC_SETS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze(
    Object.fromEntries(
        Object.entries(CANONICAL_TOPIC_CATALOG).map(([family, topics]) => [family, new Set(topics)]),
    ),
);

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
function extractRuleKey(rule: RuleDefinition): { family: string; topic: string; num: number } | null {
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
export function auditTopicAndSequenceContinuity(rules: readonly RuleDefinition[]): SequenceAuditResult {
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
