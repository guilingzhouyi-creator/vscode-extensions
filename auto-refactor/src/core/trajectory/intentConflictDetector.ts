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

        for (let i = 1; i < revisions.length; i++) {
            const prev = revisions[i - 1];
            const curr = revisions[i];
            const prevIssues = new Set(prev.ruleHitIds || []);
            const currIssues = new Set(curr.ruleHitIds || []);

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
            for (let i = 0; i < group.length; i++) {
                for (let j = i + 1; j < group.length; j++) {
                    const p1 = group[i];
                    const p2 = group[j];
                    if (p1.agentUid === p2.agentUid) continue;

                    this.evaluatePairConflicts(norm, p1, p2, conflicts);
                }
            }
        }

        return conflicts;
    }

    /**
     * Evaluates conflicts between a pair of patches targeting the same file.
     */
    private evaluatePairConflicts(
        file: string,
        p1: AgentPatchSlice,
        p2: AgentPatchSlice,
        out: AgentIntentConflict[],
    ): void {
        if (p1.newContent && p2.newContent) {
            const p1Erodes = p1.oldContent && checkGuardErosion(p1.oldContent, p1.newContent);
            const p2Erodes = p2.oldContent && checkGuardErosion(p2.oldContent, p2.newContent);

            if (p1Erodes || p2Erodes) {
                const offendingAgent = p1Erodes ? p1.agentUid : p2.agentUid;
                const otherAgent = p1Erodes ? p2.agentUid : p1.agentUid;
                out.push({
                    conflictId: `guard-erosion-${file}-${offendingAgent}`,
                    kind: 'eroded_guard',
                    agents: [otherAgent, offendingAgent],
                    filePath: file,
                    description:
                        `Agent '${offendingAgent}' removed defensive validation guards in ` +
                        `'${file}' concurrently touched by '${otherAgent}'`,
                });
            }

            // Detect opposing line churn (one agent mostly adds, the other mostly deletes)
            const isOpposing =
                (p1.addedLines > 20 && p2.deletedLines > 20) ||
                (p2.addedLines > 20 && p1.deletedLines > 20);
            if (isOpposing) {
                out.push({
                    conflictId: `opposing-churn-${file}-${p1.agentUid}-${p2.agentUid}`,
                    kind: 'opposing_refactor',
                    agents: [p1.agentUid, p2.agentUid],
                    filePath: file,
                    description:
                        `Opposing refactoring direction in '${file}' between agents ` +
                        `'${p1.agentUid}' and '${p2.agentUid}'`,
                });
            }
        }
    }
}

/** Default singleton instance of IntentConflictDetector */
export const defaultIntentConflictDetector = new IntentConflictDetector();
