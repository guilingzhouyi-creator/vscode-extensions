/**
 * Module: Core Engine — Constant Relocation & Mutation Detector
 * File Path: src/core/diff/constant-relocation-detector.ts
 * Architecture Role: Distinguishes physical code movement from genuine semantic mutations
 *     for constants, enabling Anti-Gaming debouncing and stable entity tracking across diffs.
 * Dependencies & Triggers: Consumes ConstantEntity & ConstantSemanticFingerprint from
 *     core/intelligence/constant-identity.ts; re-exports extractConstantEntities from
 *     constant-entity-extractor.ts; consumed by patchQuality.ts, diffScore.ts,
 *     and diffClassifier.ts.
 * Responsibilities:
 *     1. Perform bidirectional matching between Before and After constant entities.
 *     2. Classify transitions into relocated, renamed, mutated, inserted, deleted, or unchanged.
 *     3. Build line-migration maps to eliminate false issue diffs.
 * Exit Semantics & Design Rationale: Deterministic and pure function without disk I/O.
 */

import type { ConstantEntity } from '../intelligence/constant-identity';
import { areSemanticallyEqual } from '../intelligence/constant-identity';
import { extractConstantEntities } from './constant-entity-extractor';

export { extractConstantEntities };

const CLASSIFICATION_RELOCATED = 'relocated';
const CLASSIFICATION_RENAMED = 'renamed';
const CLASSIFICATION_MUTATED = 'mutated';
const CLASSIFICATION_INSERTED = 'inserted';
const CLASSIFICATION_DELETED = 'deleted';
const CLASSIFICATION_UNCHANGED = 'unchanged';

const MATCH_KIND_IDENTICAL = 'identical';
const MATCH_KIND_RENAMED = 'renamed';
const MATCH_KIND_MUTATED = 'mutated';

type MatchKind =
    typeof MATCH_KIND_IDENTICAL | typeof MATCH_KIND_RENAMED | typeof MATCH_KIND_MUTATED;

/**
 * Classification category of a constant transition across a diff.
 */
export type RelocationClassification =
    | typeof CLASSIFICATION_RELOCATED
    | typeof CLASSIFICATION_RENAMED
    | typeof CLASSIFICATION_MUTATED
    | typeof CLASSIFICATION_INSERTED
    | typeof CLASSIFICATION_DELETED
    | typeof CLASSIFICATION_UNCHANGED;

/**
 * Detailed transition record for an individual constant entity.
 */
export interface ConstantTransition {
    classification: RelocationClassification;
    before?: ConstantEntity;
    after?: ConstantEntity;
    isPureRelocation: boolean;
    rationale: string;
}

/**
 * Metrics breakdown of constant transition categories.
 */
export interface TransitionMetrics {
    relocatedCount: number;
    renamedCount: number;
    mutatedCount: number;
    insertedCount: number;
    deletedCount: number;
    unchangedCount: number;
}

/**
 * Aggregated analysis result of all constant transitions in a diff.
 */
export interface RelocationAnalysisResult extends TransitionMetrics {
    transitions: ConstantTransition[];
    hasPureRelocationsOnly: boolean;
    lineMigrationMap: Map<number, number>;
}

function matchesKind(kind: MatchKind, b: ConstantEntity, a: ConstantEntity): boolean {
    if (kind === MATCH_KIND_IDENTICAL) {
        return (
            b.identity.name === a.identity.name &&
            areSemanticallyEqual(b.fingerprint, a.fingerprint)
        );
    }
    if (kind === MATCH_KIND_RENAMED) {
        return (
            b.identity.enclosingScope === a.identity.enclosingScope &&
            areSemanticallyEqual(b.fingerprint, a.fingerprint)
        );
    }
    return (
        b.identity.name === a.identity.name &&
        b.identity.enclosingScope === a.identity.enclosingScope
    );
}

function findFirstMatch(
    kind: MatchKind,
    before: ConstantEntity,
    after: ConstantEntity[],
    matchedAfter: Set<number>,
): number {
    for (let a = 0; a < after.length; a++) {
        if (!matchedAfter.has(a) && matchesKind(kind, before, after[a])) {
            return a;
        }
    }
    return -1;
}

function recordLineMigration(b: ConstantEntity, a: ConstantEntity, map: Map<number, number>): void {
    if (b.identity.line !== null && a.identity.line !== null) {
        map.set(b.identity.line, a.identity.line);
    }
}

function createTransition(
    classification: RelocationClassification,
    before: ConstantEntity | undefined,
    after: ConstantEntity | undefined,
    rationale: string,
    isPureRelocation = false,
): ConstantTransition {
    return { classification, before, after, isPureRelocation, rationale };
}

function applyMatchTransition(
    kind: MatchKind,
    b: ConstantEntity,
    a: ConstantEntity,
    map: Map<number, number>,
    out: ConstantTransition[],
): void {
    if (kind === MATCH_KIND_IDENTICAL) {
        const isShift =
            b.identity.line !== a.identity.line || b.identity.codeDomain !== a.identity.codeDomain;
        if (isShift) {
            recordLineMigration(b, a, map);
            out.push(
                createTransition(
                    CLASSIFICATION_RELOCATED,
                    b,
                    a,
                    `Constant '${b.identity.name}' relocated.`,
                    true,
                ),
            );
        } else {
            out.push(
                createTransition(
                    CLASSIFICATION_UNCHANGED,
                    b,
                    a,
                    `Constant '${b.identity.name}' unchanged.`,
                ),
            );
        }
        return;
    }
    if (kind === MATCH_KIND_RENAMED) {
        recordLineMigration(b, a, map);
        out.push(
            createTransition(
                CLASSIFICATION_RENAMED,
                b,
                a,
                `Constant renamed from '${b.identity.name}' to '${a.identity.name}'.`,
            ),
        );
        return;
    }
    out.push(
        createTransition(CLASSIFICATION_MUTATED, b, a, `Constant '${b.identity.name}' mutated.`),
    );
}

function runMatchKind(
    kind: MatchKind,
    before: ConstantEntity[],
    after: ConstantEntity[],
    mb: Set<number>,
    ma: Set<number>,
    map: Map<number, number>,
    out: ConstantTransition[],
): void {
    for (let b = 0; b < before.length; b++) {
        if (mb.has(b)) continue;
        const be = before[b];
        const a = findFirstMatch(kind, be, after, ma);
        if (a >= 0) {
            mb.add(b);
            ma.add(a);
            applyMatchTransition(kind, be, after[a], map, out);
        }
    }
}

function collectUnmatchedTransitions(
    beforeEntities: ConstantEntity[],
    afterEntities: ConstantEntity[],
    matchedBefore: Set<number>,
    matchedAfter: Set<number>,
    transitions: ConstantTransition[],
): void {
    for (let b = 0; b < beforeEntities.length; b++) {
        if (!matchedBefore.has(b)) {
            transitions.push(
                createTransition(
                    CLASSIFICATION_DELETED,
                    beforeEntities[b],
                    undefined,
                    `Constant '${beforeEntities[b].identity.name}' deleted.`,
                ),
            );
        }
    }
    for (let a = 0; a < afterEntities.length; a++) {
        if (!matchedAfter.has(a)) {
            transitions.push(
                createTransition(
                    CLASSIFICATION_INSERTED,
                    undefined,
                    afterEntities[a],
                    `New constant '${afterEntities[a].identity.name}' introduced.`,
                ),
            );
        }
    }
}

function aggregateTransitionCounts(transitions: ConstantTransition[]): TransitionMetrics {
    const counts: TransitionMetrics = {
        relocatedCount: 0,
        renamedCount: 0,
        mutatedCount: 0,
        insertedCount: 0,
        deletedCount: 0,
        unchangedCount: 0,
    };
    for (let i = 0; i < transitions.length; i++) {
        const k = `${transitions[i].classification}Count` as keyof TransitionMetrics;
        if (k in counts) counts[k]++;
    }
    return counts;
}

/**
 * Analyzes transitions between Before and After constant entity sets.
 *
 * @param beforeEntities - Constants extracted from before state.
 * @param afterEntities - Constants extracted from after state.
 * @returns Analysis result including transitions and line migration map.
 */
export function analyzeConstantTransitions(
    beforeEntities: ConstantEntity[],
    afterEntities: ConstantEntity[],
): RelocationAnalysisResult {
    const transitions: ConstantTransition[] = [];
    const lineMigrationMap = new Map<number, number>();
    const matchedAfter = new Set<number>();
    const matchedBefore = new Set<number>();

    const kinds: MatchKind[] = [MATCH_KIND_IDENTICAL, MATCH_KIND_RENAMED, MATCH_KIND_MUTATED];
    for (let k = 0; k < kinds.length; k++) {
        runMatchKind(
            kinds[k],
            beforeEntities,
            afterEntities,
            matchedBefore,
            matchedAfter,
            lineMigrationMap,
            transitions,
        );
    }

    collectUnmatchedTransitions(
        beforeEntities,
        afterEntities,
        matchedBefore,
        matchedAfter,
        transitions,
    );

    const counts = aggregateTransitionCounts(transitions);
    const hasPureRelocationsOnly =
        counts.relocatedCount > 0 &&
        counts.renamedCount === 0 &&
        counts.mutatedCount === 0 &&
        counts.insertedCount === 0 &&
        counts.deletedCount === 0;

    return {
        transitions,
        ...counts,
        hasPureRelocationsOnly,
        lineMigrationMap,
    };
}
