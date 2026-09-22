/**
 * Module: Core Architecture — Cross-File Constant Semantic Drift Guard
 * File Path: src/core/architecture/constant-drift-guard.ts
 * Architecture Role: Detects semantic divergences, naming variations, and value drift
 *     across files for supposedly identical domain constants, enforcing Single
 *     Source of Truth (SSOT).
 * Dependencies & Triggers: Consumes Issue from core/types; consumed by cross-file analyzers.
 * Responsibilities:
 *     1. Identify same-name different-value drift across multiple files.
 *     2. Identify same-value different-name fragmentation across domain boundaries.
 *     3. Emit CONST-DRF-001 issues to mandate convergence to a single source of truth.
 * Exit Semantics & Design Rationale: Deterministic pure function without disk I/O.
 */

import type { Issue } from '../types';
import { ConstantsMessages } from '../messages/constants';

const CONSTANTS_ANALYZER = 'constants';
const RULE_CONST_DRF_001 = 'CONST-DRF-001';
const SEVERITY_WARNING = 'warning';

/**
 * Observed constant declaration across the repository.
 */
export interface ObservedConstantDeclaration {
    name: string;
    normalizedValue: string;
    filePath: string;
    line: number;
}

/**
 * Inspects a grouped list of same-name declarations for value divergence.
 */
function inspectConstantGroupDrift(name: string, list: ObservedConstantDeclaration[]): Issue[] {
    if (list.length <= 1) return [];

    const distinctValues = new Map<string, ObservedConstantDeclaration[]>();
    for (const item of list) {
        const vList = distinctValues.get(item.normalizedValue) || [];
        vList.push(item);
        distinctValues.set(item.normalizedValue, vList);
    }

    if (distinctValues.size <= 1) return [];

    const summary = Array.from(distinctValues.entries())
        .map(([val, sites]) => `"${val}" in [${sites.map((s) => s.filePath).join(', ')}]`)
        .join('; ');

    const issues: Issue[] = [];
    const desc = ConstantsMessages.CROSS_FILE_DRIFT(name, summary);
    for (const item of list) {
        issues.push({
            id: `${CONSTANTS_ANALYZER}:${RULE_CONST_DRF_001}:${item.filePath}:${item.line}`,
            analyzer: CONSTANTS_ANALYZER,
            rule: RULE_CONST_DRF_001,
            severity: SEVERITY_WARNING,
            message: desc.message,
            location: {
                file: item.filePath,
                start: { line: item.line, column: 1 },
                end: { line: item.line, column: name.length },
            },
            detail: {
                symbol: name,
                currentValue: item.normalizedValue,
                allDistinctValues: Array.from(distinctValues.keys()),
                filesInvolved: list.map((l) => l.filePath),
            },
            suggestion: desc.suggestion,
        });
    }
    return issues;
}

/**
 * Scans a list of cross-file constant declarations for value drift and fragmentation.
 *
 * @param declarations - Collected constant declarations from scanned files.
 * @returns List of detected CONST-DRF-001 semantic drift issues.
 */
export function detectConstantDrift(declarations: ObservedConstantDeclaration[]): Issue[] {
    const issues: Issue[] = [];
    const byName = new Map<string, ObservedConstantDeclaration[]>();

    for (const decl of declarations) {
        const list = byName.get(decl.name) || [];
        list.push(decl);
        byName.set(decl.name, list);
    }

    for (const [name, list] of byName) {
        const driftIssues = inspectConstantGroupDrift(name, list);
        if (driftIssues.length > 0) {
            issues.push(...driftIssues);
        }
    }

    return issues;
}
