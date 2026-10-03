/**
 * Module: Core Engine - Architecture Facade & Trampoline Evaluator
 * File Path: src/core/architecture/facade-governance-evaluator.ts
 * Architecture Role: Evaluates single-file AST and source lines to detect vacuous
 *   forwarding trampolines (ARCH-ABS-001) and hollow facade layers (ARCH-FAC-001).
 * Dependencies & Triggers: Consumes Issue from core/types and ArchitectureMessages
 *   from core/messages; called by architecture analyzer during scans and evaluations.
 * Responsibilities: Enforce minimum ELOC budgets for facades; intercept empty pass-through
 *   trampolines; exempt legitimate type barrels and test fixtures.
 * Exit Semantics & Design Rationale: Pure, non-throwing evaluation returning structured findings.
 */

import * as path from 'path';
import type { Issue } from '../types';
import { SEVERITY_ERROR, SEVERITY_WARNING } from '../types';
import { ArchitectureMessages } from '../messages/architecture';

/** Default minimum effective lines of code for a substantive facade module. */
export const DEFAULT_MIN_FACADE_ELOC = 15;

/** Configuration options for facade and trampoline governance audits. */
export interface FacadeAuditOptions {
    minFacadeEloc?: number;
    flagVacuousTrampolines?: boolean;
    flagHollowFacades?: boolean;
}

/** Audit result breakdown for facade and trampoline inspection. */
export interface FacadeAuditResult {
    issues: Issue[];
    trampolineCount: number;
    hollowFacadeCount: number;
}

const TRAMPOLINE_REEXPORT_RE =
    /^(?:export\s+\*\s+from|export\s*\{[^}]*\}\s*from|module\.exports\s*=)\s*['"](\.\/[^'"]+)['"]/;

const LOCAL_DECL_RE =
    /(?:^|\s)(?:function|class|interface|type|const|let|var|enum|def|struct|fn)\s+[a-zA-Z0-9_$]+/;

const SUBSTANTIVE_PAYLOAD_RE =
    /(?:Object\.freeze|deepFreeze|assert\(|assert\.|throw\s+new\s+|typeof\s+|instanceof\s+|normalizeLocale|getRuleText)/;

const FACADE_PATH_HINT_RE = /(?:facade|gateway|adapter|aggregator)/i;

/**
 * Strips block and line comments from raw source code.
 */
function stripComments(content: string): string {
    return content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '').trim();
}

/**
 * Checks whether a file path qualifies for architectural exemption.
 */
function isExemptPath(filePath: string): boolean {
    const norm = filePath.split(path.sep).join('/');
    return (
        norm.includes('/tests/') ||
        norm.includes('/test/') ||
        norm.includes('/fixtures/') ||
        norm.endsWith('.test.ts') ||
        norm.endsWith('.spec.ts') ||
        norm.endsWith('.d.ts')
    );
}

/**
 * Checks if non-comment code lines represent a vacuous trampoline module.
 */
function checkVacuousTrampoline(
    filePath: string,
    codeLines: string[],
): { isTrampoline: boolean; targetPath: string } {
    if (codeLines.length > 3 || codeLines.length === 0) {
        return { isTrampoline: false, targetPath: '' };
    }

    let targetPath = '';
    for (let i = 0; i < codeLines.length; i++) {
        const line = codeLines[i];
        if (
            LOCAL_DECL_RE.test(line) &&
            !line.startsWith('export {') &&
            !line.startsWith('export *')
        ) {
            return { isTrampoline: false, targetPath: '' };
        }
        const m = line.match(TRAMPOLINE_REEXPORT_RE);
        if (m) {
            targetPath = m[1];
        }
    }

    if (targetPath.length > 0 && (targetPath.includes('/index') || targetPath.startsWith('./'))) {
        return { isTrampoline: true, targetPath };
    }

    return { isTrampoline: false, targetPath: '' };
}

/**
 * Evaluates whether a module functioning as a facade lacks substantive payload.
 */
function checkHollowFacade(
    filePath: string,
    content: string,
    codeLines: string[],
    minEloc: number,
): boolean {
    const baseName = path.basename(filePath);
    const isFacadeRole = FACADE_PATH_HINT_RE.test(baseName) || content.includes('Facade');
    if (!isFacadeRole) return false;

    if (codeLines.length >= minEloc) return false;

    // Check if substantive payload keywords or contracts exist
    if (SUBSTANTIVE_PAYLOAD_RE.test(content)) return false;

    return true;
}

/**
 * Audits a source file for vacuous trampolines and hollow facade violations.
 *
 * @param filePath - Path to the file being audited.
 * @param content - Source content of the file.
 * @param options - Optional audit tuning parameters.
 * @returns Structured audit findings including issues and counts.
 */
export function auditFacadeGovernance(
    filePath: string,
    content: string,
    options?: FacadeAuditOptions,
): FacadeAuditResult {
    const issues: Issue[] = [];
    let trampolineCount = 0;
    let hollowFacadeCount = 0;

    if (isExemptPath(filePath)) {
        return { issues, trampolineCount, hollowFacadeCount };
    }

    const minEloc = options?.minFacadeEloc ?? DEFAULT_MIN_FACADE_ELOC;
    const checkTrampoline = options?.flagVacuousTrampolines !== false;
    const checkFacade = options?.flagHollowFacades !== false;

    const stripped = stripComments(content);
    const codeLines = stripped
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

    const normPath = filePath.replace(/\\/g, '/');

    if (checkTrampoline) {
        const { isTrampoline, targetPath } = checkVacuousTrampoline(filePath, codeLines);
        if (isTrampoline) {
            trampolineCount++;
            const desc = ArchitectureMessages.VACUOUS_TRAMPOLINE_MODULE(filePath, targetPath);
            issues.push({
                id: `architecture:ARCH-ABS-001:${normPath}:1`,
                analyzer: 'architecture',
                rule: 'ARCH-ABS-001',
                severity: SEVERITY_ERROR,
                location: {
                    file: normPath,
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: 1 },
                },
                message: desc.message,
                suggestion: desc.suggestion,
                detail: { rationale: desc.rationale, targetPath },
            });
        }
    }

    if (checkFacade) {
        const isHollow = checkHollowFacade(filePath, content, codeLines, minEloc);
        if (isHollow) {
            hollowFacadeCount++;
            const desc = ArchitectureMessages.HOLLOW_FACADE_PAYLOAD(
                filePath,
                codeLines.length,
                minEloc,
            );
            issues.push({
                id: `architecture:ARCH-FAC-001:${normPath}:1`,
                analyzer: 'architecture',
                rule: 'ARCH-FAC-001',
                severity: SEVERITY_WARNING,
                location: {
                    file: normPath,
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: 1 },
                },
                message: desc.message,
                suggestion: desc.suggestion,
                detail: {
                    rationale: desc.rationale,
                    eloc: codeLines.length,
                    minEloc,
                },
            });
        }
    }

    return { issues, trampolineCount, hollowFacadeCount };
}
