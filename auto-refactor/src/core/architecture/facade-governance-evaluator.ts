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
import { tokenizeCode } from '../intelligence/token-entropy';
import { calculateWeightedTokenPayload } from '../intelligence/payload-density';

/** Default minimum effective lines of code for a substantive facade module. */
export const DEFAULT_MIN_FACADE_ELOC = 15;

const EXEMPT_PATH_SUBSTRINGS = ['/tests/', '/test/', '/fixtures/'] as const;
const EXEMPT_PATH_SUFFIXES = ['.test.ts', '.spec.ts', '.d.ts'] as const;
const MAX_TRAMPOLINE_LINES = 3;
const INDEX_SUBSTRING = '/index';
const LOCAL_PREFIX = './';
const FACADE_KEYWORD = 'Facade';
const MIN_TOKEN_STREAM_LENGTH = 30;

/** Rule id: wiring payload above the absolute plumbing-ratio budget. */
const RULE_PLUMBING_RATIO = 'VOL-POR-001';
/** Rule id: wiring payload dominant enough that the module carries almost no logic at all. */
const RULE_PLUMBING_DOMINANT = 'ARCH-PLM-001';

/** Plumbing ratio above which wiring outweighs logic payload. */
const MAX_PLUMBING_RATIO = 0.6;
/**
 * Payload ratio below which a module is treated as having no logic payload at all.
 *
 * POR is `1 - TSPR`, so the two thresholds are two points on one axis: the ratio budget is the
 * gate's line, and this stricter cut marks the modules where the wiring does not merely exceed the
 * budget but leaves essentially nothing behind. Splitting them keeps a single file from being
 * reported twice for the same measurement while still naming the two severities of the same defect.
 */
const MIN_DOMINANT_PAYLOAD_RATIO = 0.35;

/** Configuration options for facade and trampoline governance audits. */
export interface FacadeAuditOptions {
    minFacadeEloc?: number;
    flagVacuousTrampolines?: boolean;
    flagHollowFacades?: boolean;
    flagPlumbingOverhead?: boolean;
}

/** Audit result breakdown for facade and trampoline inspection. */
export interface FacadeAuditResult {
    issues: Issue[];
    trampolineCount: number;
    hollowFacadeCount: number;
    plumbingCount?: number;
    /** Modules whose wiring payload exceeded the plumbing-ratio budget. */
    plumbingOverBudgetCount?: number;
}

/** Plumbing measurement for one module: both budget verdicts plus the ratios they came from. */
interface PlumbingAssessment {
    /** Wiring payload above the ratio budget (VOL-POR-001). */
    readonly overBudget: boolean;
    /** Wiring payload so dominant that almost no logic remains (ARCH-PLM-001). */
    readonly dominant: boolean;
    readonly por: number;
    readonly tspr: number;
}

const TRAMPOLINE_REEXPORT_RE =
    /^(?:export\s+\*\s+from|export\s*\{[^}]*\}\s*from|module\.exports\s*=)\s*['"](\.\/[^'"]+)['"]/;

const LOCAL_DECL_RE =
    /(?:^|\s)(?:function|class|interface|type|const|let|var|enum|def|struct|fn)\s+[a-zA-Z0-9_$]+/;

const SUBSTANTIVE_PAYLOAD_RE =
    /(?:Object\.freeze|deepFreeze|readonly\s+|Readonly<|assert\(|assert\.|throw\s+new\s+|typeof\s+|instanceof\s+|\.validate\(|\.parse\(|\.safeParse\(|sanitize|normalize)/i;

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
        EXEMPT_PATH_SUBSTRINGS.some((sub) => norm.includes(sub)) ||
        EXEMPT_PATH_SUFFIXES.some((suffix) => norm.endsWith(suffix))
    );
}

/**
 * Checks if non-comment code lines represent a vacuous trampoline module.
 */
function checkVacuousTrampoline(
    filePath: string,
    codeLines: string[],
): { isTrampoline: boolean; targetPath: string } {
    if (codeLines.length > MAX_TRAMPOLINE_LINES || codeLines.length === 0) {
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

    if (
        targetPath.length > 0 &&
        (targetPath.includes(INDEX_SUBSTRING) || targetPath.startsWith(LOCAL_PREFIX))
    ) {
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
    const isFacadeRole = FACADE_PATH_HINT_RE.test(baseName) || content.includes(FACADE_KEYWORD);
    if (!isFacadeRole) return false;

    if (codeLines.length >= minEloc) return false;

    // Check if substantive payload keywords or contracts exist
    return !SUBSTANTIVE_PAYLOAD_RE.test(content);
}

/**
 * Evaluates whether a module is dominated by wiring and plumbing overhead.
 *
 * Two verdicts come out of one measurement because POR and TSPR are the same axis read from
 * opposite ends: `overBudget` is the gate's absolute budget (VOL-POR-001), and `dominant` is the
 * stricter cut where the wiring has crowded the payload out almost entirely (ARCH-PLM-001). They
 * are reported under separate ids so a consumer can tell a budget breach from a hollow module,
 * while a single measurement still decides both.
 *
 * @param filePath - Path of the module under audit.
 * @param content - Source content of the module.
 * @param codeLines - Non-comment, non-blank lines of the module.
 * @param minEloc - Minimum effective lines before the ratio is meaningful.
 * @returns Both budget verdicts plus the measured ratios.
 */
function checkPlumbingOverhead(
    filePath: string,
    content: string,
    codeLines: string[],
    minEloc: number,
): PlumbingAssessment {
    const clean: PlumbingAssessment = { overBudget: false, dominant: false, por: 0, tspr: 1.0 };
    if (codeLines.length < minEloc) return clean;
    if (isWiringExemptModule(filePath)) return clean;
    if (SUBSTANTIVE_PAYLOAD_RE.test(content)) return clean;

    const tokenStream = tokenizeCode(content);
    if (tokenStream.tokens.length < MIN_TOKEN_STREAM_LENGTH) return clean;

    const { tspr, por } = calculateWeightedTokenPayload(tokenStream.tokens);
    return {
        overBudget: por > MAX_PLUMBING_RATIO,
        dominant: por > MAX_PLUMBING_RATIO && tspr < MIN_DOMINANT_PAYLOAD_RATIO,
        por,
        tspr,
    };
}

/**
 * Report whether a module's ratio is dictated by its role rather than by its author.
 *
 * Barrel indexes, declaration files, constant tables, token catalogs, and name registries are
 * wiring by construction: their whole job is to name things other modules define. Charging them a
 * wiring budget would only teach the reader to ignore the rule.
 *
 * @param filePath - Path of the module under audit.
 * @returns True when the module is exempt from the wiring budget.
 */
function isWiringExemptModule(filePath: string): boolean {
    const baseName = path.basename(filePath);
    return (
        baseName.startsWith('index.') ||
        baseName.includes('constants') ||
        baseName.includes('token') ||
        baseName.includes('catalog') ||
        filePath.endsWith('.d.ts')
    );
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
    let plumbingCount = 0;
    let plumbingOverBudgetCount = 0;

    if (isExemptPath(filePath)) {
        return {
            issues,
            trampolineCount,
            hollowFacadeCount,
            plumbingCount,
            plumbingOverBudgetCount,
        };
    }

    const minEloc = options?.minFacadeEloc ?? DEFAULT_MIN_FACADE_ELOC;
    const checkTrampoline = options?.flagVacuousTrampolines !== false;
    const checkFacade = options?.flagHollowFacades !== false;
    const checkPlumbing = options?.flagPlumbingOverhead !== false;

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

    if (checkPlumbing) {
        const assessment = checkPlumbingOverhead(filePath, content, codeLines, minEloc);
        if (assessment.overBudget) {
            plumbingOverBudgetCount++;
            const desc = ArchitectureMessages.PLUMBING_RATIO_BUDGET(
                filePath,
                assessment.por,
                MAX_PLUMBING_RATIO,
            );
            issues.push({
                id: `architecture:VOL-POR-001:${normPath}:1`,
                analyzer: 'architecture',
                rule: RULE_PLUMBING_RATIO,
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
                    por: assessment.por,
                    tspr: assessment.tspr,
                    threshold: MAX_PLUMBING_RATIO,
                    eloc: codeLines.length,
                },
            });
        }
        if (assessment.dominant) {
            plumbingCount++;
            const desc = ArchitectureMessages.PLUMBING_OVERHEAD_RATIO(
                filePath,
                assessment.por,
                assessment.tspr,
                MAX_PLUMBING_RATIO,
            );
            issues.push({
                id: `architecture:ARCH-PLM-001:${normPath}:1`,
                analyzer: 'architecture',
                rule: RULE_PLUMBING_DOMINANT,
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
                    por: assessment.por,
                    tspr: assessment.tspr,
                    threshold: MAX_PLUMBING_RATIO,
                    eloc: codeLines.length,
                },
            });
        }
    }

    return { issues, trampolineCount, hollowFacadeCount, plumbingCount, plumbingOverBudgetCount };
}
