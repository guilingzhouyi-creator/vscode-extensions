/**
 * Module: Core Engine — Agent Intent Conflict Detector
 * File Path: src/core/trajectory/intentConflictDetector.ts
 * Architecture Role: Detects contradictory refactorings, reintroduced defects, and eroded
 *   guards between competing agent modifications.
 * Dependencies & Triggers: Consumes AgentIntentConflict, AgentPatchSlice, FileRevision from
 *   ./types.
 * Responsibilities: Track resolved defects across agent revisions, alert when another agent
 *   reintroduces previously eliminated defects, and detect eroded validation guards.
 * Exit Semantics & Design Rationale: Pure in-memory analysis producing structured conflict
 *   records; deterministic and resilient to partial or missing inputs.
 */

import type { AgentIntentConflict, AgentPatchSlice, FileRevision } from './types';

/** Common defensive guard signatures to track for guard erosion */
const GUARD_SIGNATURES = [
    /if\s*\(![a-zA-Z0-9_.]+\)\s*return/i,
    /if\s*\([a-zA-Z0-9_.]+\s*===\s*null\)\s*throw/i,
    /assert\([a-zA-Z0-9_.]+\)/i,
    /if\s*\(![a-zA-Z0-9_.]+\)\s*throw/i,
];

/**
 * Normalizes file path to POSIX style.
 */
function normalizePath(p: string): string {
    return p.replace(/\\/g, '/');
}

/**
 * Checks whether newContent stripped guards present in oldContent.
 */
function checkGuardErosion(oldContent: string, newContent: string): boolean {
    for (const pattern of GUARD_SIGNATURES) {
        if (pattern.test(oldContent) && !pattern.test(newContent)) {
            return true;
        }
    }
    return false;
}

/**
 * Detects intent conflicts and opposing modifications across agents.
 */
export class IntentConflictDetector {
    /**
     * Inspects historical revisions for reintroduced defects by subsequent agents.
     */
    public detectReintroducedDefects(
        filePath: string,
        revisions: FileRevision[],
    ): AgentIntentConflict[] {
        const conflicts: AgentIntentConflict[] = [];
        const normPath = normalizePath(filePath);
        const resolvedMap = new Map<string, { agentUid: string; revId: string }>();
        const revisionIssueSets: Array<Set<string>> = revisions.map(
            (rev) => new Set(rev.ruleHitIds || []),
        );

        for (let i = 1; i < revisions.length; i++) {
            const curr = revisions[i];
            const prevIssues = revisionIssueSets[i - 1];
            const currIssues = revisionIssueSets[i];

            // Check what prev resolved
            for (const pIssue of prevIssues) {
                if (!currIssues.has(pIssue)) {
                    resolvedMap.set(pIssue, { agentUid: curr.agentUid, revId: curr.revisionId });
                }
            }

            // Check what curr reintroduced from past resolved
            for (const cIssue of currIssues) {
                const resolution = resolvedMap.get(cIssue);
                if (resolution && resolution.agentUid !== curr.agentUid) {
                    conflicts.push({
                        conflictId: `reintro-${cIssue}-${curr.revisionId}`,
                        kind: 'reintroduced_defect',
                        agents: [resolution.agentUid, curr.agentUid],
                        filePath: normPath,
                        description:
                            `Agent '${curr.agentUid}' reintroduced defect '${cIssue}' ` +
                            `previously resolved by agent '${resolution.agentUid}'`,
                        details: {
                            rule: cIssue,
                            resolvedInRevision: resolution.revId,
                            reintroducedInRevision: curr.revisionId,
                        },
                    });
                }
            }
        }

        return conflicts;
    }

    /**
     * Inspects concurrent patches for eroded guards and opposing modifications.
     */
    public detectPatchConflicts(patches: AgentPatchSlice[]): AgentIntentConflict[] {
        const conflicts: AgentIntentConflict[] = [];
        const fileMap = new Map<string, AgentPatchSlice[]>();

        for (const p of patches) {
            const norm = normalizePath(p.filePath);
            const list = fileMap.get(norm) || [];
            list.push(p);
            fileMap.set(norm, list);
        }

        for (const [norm, group] of fileMap.entries()) {
            if (group.length < 2) continue;
            this.evaluateGroupPairConflicts(norm, group, conflicts);
        }

        return conflicts;
    }

    private evaluateGroupPairConflicts(
        norm: string,
        group: AgentPatchSlice[],
        conflicts: AgentIntentConflict[],
    ): void {
        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const patchA = group[i];
                const patchB = group[j];
                if (patchA.agentUid === patchB.agentUid) continue;
                this.evaluatePairConflicts(norm, patchA, patchB, conflicts);
            }
        }
    }

    /**
     * Evaluates conflicts between a pair of patches targeting the same file.
     */
    private evaluatePairConflicts(
        file: string,
        patchA: AgentPatchSlice,
        patchB: AgentPatchSlice,
        out: AgentIntentConflict[],
    ): void {
        if (!patchA.newContent || !patchB.newContent) return;
        const erosion = evaluateGuardErosionConflict(file, patchA, patchB);
        if (erosion) out.push(erosion);
        const churn = evaluateOpposingChurnConflict(file, patchA, patchB);
        if (churn) out.push(churn);
    }
}

function evaluateGuardErosionConflict(
    file: string,
    patchA: AgentPatchSlice,
    patchB: AgentPatchSlice,
): AgentIntentConflict | null {
    const patchAErodes = patchA.oldContent
        ? checkGuardErosion(patchA.oldContent, patchA.newContent!)
        : false;
    const patchBErodes = patchB.oldContent
        ? checkGuardErosion(patchB.oldContent, patchB.newContent!)
        : false;
    if (!patchAErodes && !patchBErodes) return null;
    const offendingAgent = patchAErodes ? patchA.agentUid : patchB.agentUid;
    const otherAgent = patchAErodes ? patchB.agentUid : patchA.agentUid;
    return {
        conflictId: `guard-erosion-${file}-${offendingAgent}`,
        kind: 'eroded_guard',
        agents: [otherAgent, offendingAgent],
        filePath: file,
        description:
            `Agent '${offendingAgent}' removed defensive validation guards in ` +
            `'${file}' concurrently touched by '${otherAgent}'`,
    };
}

function evaluateOpposingChurnConflict(
    file: string,
    patchA: AgentPatchSlice,
    patchB: AgentPatchSlice,
): AgentIntentConflict | null {
    const isOpposing =
        (patchA.addedLines > 20 && patchB.deletedLines > 20) ||
        (patchB.addedLines > 20 && patchA.deletedLines > 20);
    if (!isOpposing) return null;
    return {
        conflictId: `opposing-churn-${file}-${patchA.agentUid}-${patchB.agentUid}`,
        kind: 'opposing_refactor',
        agents: [patchA.agentUid, patchB.agentUid],
        filePath: file,
        description:
            `Opposing refactoring direction in '${file}' between agents ` +
            `'${patchA.agentUid}' and '${patchB.agentUid}'`,
    };
}

/** Default singleton instance of IntentConflictDetector */
export const defaultIntentConflictDetector = new IntentConflictDetector();
