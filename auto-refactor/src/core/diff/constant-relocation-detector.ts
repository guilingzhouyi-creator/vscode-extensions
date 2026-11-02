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
import { compareSemanticEquality } from '../intelligence/constant-identity';
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

function matchesKind(
    kind: MatchKind,
    beforeEntity: ConstantEntity,
    afterEntity: ConstantEntity,
): boolean {
    if (kind === MATCH_KIND_IDENTICAL) {
        return (
            beforeEntity.identity.name === afterEntity.identity.name &&
            compareSemanticEquality(beforeEntity.fingerprint, afterEntity.fingerprint)
        );
    }
    if (kind === MATCH_KIND_RENAMED) {
        return (
            beforeEntity.identity.enclosingScope === afterEntity.identity.enclosingScope &&
            compareSemanticEquality(beforeEntity.fingerprint, afterEntity.fingerprint)
        );
    }
    return (
        beforeEntity.identity.name === afterEntity.identity.name &&
        beforeEntity.identity.enclosingScope === afterEntity.identity.enclosingScope
    );
}

function findFirstMatch(
    kind: MatchKind,
    before: ConstantEntity,
    after: ConstantEntity[],
    matchedAfter: Set<number>,
): number {
    for (let afterIndex = 0; afterIndex < after.length; afterIndex++) {
        if (!matchedAfter.has(afterIndex) && matchesKind(kind, before, after[afterIndex])) {
            return afterIndex;
        }
    }
    return -1;
}

function recordLineMigration(
    beforeEntity: ConstantEntity,
    afterEntity: ConstantEntity,
    map: Map<number, number>,
): void {
    if (beforeEntity.identity.line !== null && afterEntity.identity.line !== null) {
        map.set(beforeEntity.identity.line, afterEntity.identity.line);
    }
}

interface TransitionOptions {
    classification: RelocationClassification;
    before?: ConstantEntity;
    after?: ConstantEntity;
    rationale: string;
    isPureRelocation?: boolean;
}

interface MatchContext {
    before: ConstantEntity[];
    after: ConstantEntity[];
    matchedBefore: Set<number>;
    matchedAfter: Set<number>;
    lineMigrationMap: Map<number, number>;
    transitions: ConstantTransition[];
}

function createTransition(options: TransitionOptions): ConstantTransition {
    return {
        classification: options.classification,
        before: options.before,
        after: options.after,
        isPureRelocation: options.isPureRelocation ?? false,
        rationale: options.rationale,
    };
}

function applyMatchTransition(
    kind: MatchKind,
    beforeEntity: ConstantEntity,
    afterEntity: ConstantEntity,
    ctx: MatchContext,
): void {
    if (kind === MATCH_KIND_IDENTICAL) {
        const isShift =
            beforeEntity.identity.line !== afterEntity.identity.line ||
            beforeEntity.identity.codeDomain !== afterEntity.identity.codeDomain;
        if (isShift) {
            recordLineMigration(beforeEntity, afterEntity, ctx.lineMigrationMap);
            ctx.transitions.push(
                createTransition({
                    classification: CLASSIFICATION_RELOCATED,
                    before: beforeEntity,
                    after: afterEntity,
                    rationale: `Constant '${beforeEntity.identity.name}' relocated.`,
                    isPureRelocation: true,
                }),
            );
        } else {
            ctx.transitions.push(
                createTransition({
                    classification: CLASSIFICATION_UNCHANGED,
                    before: beforeEntity,
                    after: afterEntity,
                    rationale: `Constant '${beforeEntity.identity.name}' unchanged.`,
                }),
            );
        }
        return;
    }
    if (kind === MATCH_KIND_RENAMED) {
        recordLineMigration(beforeEntity, afterEntity, ctx.lineMigrationMap);
        ctx.transitions.push(
            createTransition({
                classification: CLASSIFICATION_RENAMED,
                before: beforeEntity,
                after: afterEntity,
                rationale: `Constant renamed from '${beforeEntity.identity.name}' to '${afterEntity.identity.name}'.`,
            }),
        );
        return;
    }
    ctx.transitions.push(
        createTransition({
            classification: CLASSIFICATION_MUTATED,
            before: beforeEntity,
            after: afterEntity,
            rationale: `Constant '${beforeEntity.identity.name}' mutated.`,
        }),
    );
}

function runMatchKind(kind: MatchKind, ctx: MatchContext): void {
    for (let beforeIdx = 0; beforeIdx < ctx.before.length; beforeIdx++) {
        if (ctx.matchedBefore.has(beforeIdx)) continue;
        const beforeEntity = ctx.before[beforeIdx];
        const afterIdx = findFirstMatch(kind, beforeEntity, ctx.after, ctx.matchedAfter);
        if (afterIdx >= 0) {
            ctx.matchedBefore.add(beforeIdx);
            ctx.matchedAfter.add(afterIdx);
            applyMatchTransition(kind, beforeEntity, ctx.after[afterIdx], ctx);
        }
    }
}

function collectUnmatchedTransitions(ctx: MatchContext): void {
    for (let beforeIdx = 0; beforeIdx < ctx.before.length; beforeIdx++) {
        if (!ctx.matchedBefore.has(beforeIdx)) {
            ctx.transitions.push(
                createTransition({
                    classification: CLASSIFICATION_DELETED,
                    before: ctx.before[beforeIdx],
                    rationale: `Constant '${ctx.before[beforeIdx].identity.name}' deleted.`,
                }),
            );
        }
    }
    for (let afterIdx = 0; afterIdx < ctx.after.length; afterIdx++) {
        if (!ctx.matchedAfter.has(afterIdx)) {
            ctx.transitions.push(
                createTransition({
                    classification: CLASSIFICATION_INSERTED,
                    after: ctx.after[afterIdx],
                    rationale: `New constant '${ctx.after[afterIdx].identity.name}' introduced.`,
                }),
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
    const ctx: MatchContext = {
        before: beforeEntities,
        after: afterEntities,
        matchedBefore: new Set<number>(),
        matchedAfter: new Set<number>(),
        lineMigrationMap: new Map<number, number>(),
        transitions: [],
    };

    const kinds: MatchKind[] = [MATCH_KIND_IDENTICAL, MATCH_KIND_RENAMED, MATCH_KIND_MUTATED];
    for (let k = 0; k < kinds.length; k++) {
        runMatchKind(kinds[k], ctx);
    }

    collectUnmatchedTransitions(ctx);

    const counts = aggregateTransitionCounts(ctx.transitions);
    const hasPureRelocationsOnly =
        counts.relocatedCount > 0 &&
        counts.renamedCount === 0 &&
        counts.mutatedCount === 0 &&
        counts.insertedCount === 0 &&
        counts.deletedCount === 0;

    return {
        transitions: ctx.transitions,
        ...counts,
        hasPureRelocationsOnly,
        lineMigrationMap: ctx.lineMigrationMap,
    };
}
