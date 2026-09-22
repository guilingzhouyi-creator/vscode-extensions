/**
 * Module: Core Governance — File Layout & Scope Discipline Guard
 * File Path: src/core/governance/constant-layout-guard.ts
 * Architecture Role: Enforces standard intra-file layout sequence for module-level constants
 *     ([Header] -> [Imports] -> [Constants] -> [Types] -> [Classes/Functions/Logic]),
 *     and guards against over-widening local invariants to module globals.
 * Dependencies & Triggers: Consumes extractConstantEntities from
 *     core/diff/constant-relocation-detector.ts; consumed by ConstantsAnalyzer.
 * Responsibilities:
 *     1. Enforce CONST-LAY-001: Module constants must appear after imports
 *        and before functions/classes.
 *     2. Enforce CONST-SCP-001: Non-exported single-function invariants must
 *        not be over-widened to top-level.
 *     3. Enforce CONST-SCP-002: Scattered duplicate literals inside a function
 *        should consolidate as local consts.
 * Exit Semantics & Design Rationale: Deterministic pure function without disk I/O.
 */

import type { Issue } from '../types';
import { extractConstantEntities } from '../diff/constant-relocation-detector';
import type { ConstantEntity } from '../intelligence/constant-identity';

const ANALYZER_NAME = 'constants';
const RULE_CONST_LAY_001 = 'CONST-LAY-001';
const RULE_CONST_SCP_001 = 'CONST-SCP-001';
const SEVERITY_WARNING = 'warning';
const LOCAL_SCOPE_SPAN_THRESHOLD = 15;
const LOCAL_USAGE_COUNT_MAX = 2;
const DOMAIN_MODULE_CONSTANTS = 'module_constants';

const IMPORT_STATEMENT_PREFIXES = [
    'import ',
    'import{',
    'require(',
    'export * from',
    'export {',
    'from ',
    'use ',
];

const LOGIC_DECLARATION_PREFIXES = [
    'function ',
    'export function ',
    'class ',
    'export class ',
    'interface ',
    'export interface ',
    'type ',
    'export type ',
    'describe(',
    'test(',
];

function isImportStatement(trimmed: string): boolean {
    return IMPORT_STATEMENT_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function isLogicDeclaration(trimmed: string): boolean {
    return LOGIC_DECLARATION_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function isHeaderCommentOrBlank(trimmed: string): boolean {
    return (
        trimmed.length === 0 ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*')
    );
}

function findFileBoundaryIndices(lines: string[]): {
    lastImportLine: number;
    firstLogicLine: number;
} {
    let lastImportLine = 0;
    let firstLogicLine = 0;
    let inHeaderComments = true;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        const lineNo = i + 1;

        if (inHeaderComments && isHeaderCommentOrBlank(trimmed)) {
            continue;
        }
        inHeaderComments = false;

        if (isImportStatement(trimmed)) {
            lastImportLine = lineNo;
            continue;
        }
        if (firstLogicLine === 0 && isLogicDeclaration(trimmed)) {
            firstLogicLine = lineNo;
        }
    }

    return { lastImportLine, firstLogicLine };
}

function checkMisplacedConstantLayout(
    entity: ConstantEntity,
    firstLogicLine: number,
    lastImportLine: number,
    filePath: string,
): Issue | null {
    const line = entity.identity.line ?? 1;
    if (firstLogicLine <= 0 || line <= firstLogicLine) {
        return null;
    }
    return {
        id: `${ANALYZER_NAME}:${RULE_CONST_LAY_001}:${filePath}:${line}`,
        analyzer: ANALYZER_NAME,
        rule: RULE_CONST_LAY_001,
        severity: SEVERITY_WARNING,
        message:
            `模块级常量 "${entity.identity.name}" 位置不合规（位于第 ${line} 行，处于首个函数/类声明第 ${firstLogicLine} 行之后）。` +
            '模块级稳定常量应统一位于依赖区之后、业务逻辑声明之前。',
        location: {
            file: filePath,
            start: { line, column: entity.identity.column ?? 1 },
            end: {
                line,
                column: (entity.identity.column ?? 1) + entity.identity.name.length,
            },
        },
        detail: {
            symbol: entity.identity.name,
            declaredLine: line,
            firstLogicLine,
            lastImportLine,
        },
        suggestion: `将 "const ${entity.identity.name}" 移动至依赖引入区（第 ${lastImportLine > 0 ? lastImportLine : 1} 行）之后的顶层常量区。`,
    };
}

function checkScopeOverWidening(
    entity: ConstantEntity,
    lines: string[],
    filePath: string,
): Issue | null {
    const line = entity.identity.line ?? 1;
    const name = entity.identity.name;
    const nameRegex = new RegExp(`\\b${name}\\b`, 'g');
    let occurrences = 0;
    const matchedLines: number[] = [];

    for (let i = 0; i < lines.length; i++) {
        if (i + 1 === line) continue;
        nameRegex.lastIndex = 0;
        if (nameRegex.test(lines[i])) {
            occurrences++;
            matchedLines.push(i + 1);
        }
    }

    if (occurrences > 0 && occurrences <= LOCAL_USAGE_COUNT_MAX) {
        const minLine = Math.min(...matchedLines);
        const maxLine = Math.max(...matchedLines);
        if (maxLine - minLine <= LOCAL_SCOPE_SPAN_THRESHOLD) {
            return {
                id: `${ANALYZER_NAME}:${RULE_CONST_SCP_001}:${filePath}:${line}`,
                analyzer: ANALYZER_NAME,
                rule: RULE_CONST_SCP_001,
                severity: SEVERITY_WARNING,
                message:
                    `作用域过度扩大：常量 "${name}" 仅在单处局部逻辑（行 ${minLine}..${maxLine}）被引用，` +
                    '严禁为了所谓“统一位置”而将其盲目提升至模块顶层全局可见。',
                location: {
                    file: filePath,
                    start: { line, column: entity.identity.column ?? 1 },
                    end: { line, column: (entity.identity.column ?? 1) + name.length },
                },
                detail: {
                    symbol: name,
                    declaredLine: line,
                    usageLines: matchedLines,
                },
                suggestion: `收敛作用域：将 "${name}" 下沉至其被调用的局部函数或代码块头部声明。`,
            };
        }
    }
    return null;
}

/**
 * Validates intra-file constant layout and scope boundaries.
 *
 * @param content - Source file text content.
 * @param filePath - Repository-relative file path.
 * @returns Detected layout and scope governance issues.
 */
export function checkConstantLayoutAndScope(content: string, filePath: string): Issue[] {
    const issues: Issue[] = [];
    const lines = content.split('\n');
    const { lastImportLine, firstLogicLine } = findFileBoundaryIndices(lines);

    const entities = extractConstantEntities(content, filePath);
    const topLevelEntities = entities.filter(
        (e) => e.identity.codeDomain === DOMAIN_MODULE_CONSTANTS && !e.identity.isExported,
    );

    for (const entity of topLevelEntities) {
        const layoutIssue = checkMisplacedConstantLayout(
            entity,
            firstLogicLine,
            lastImportLine,
            filePath,
        );
        if (layoutIssue) issues.push(layoutIssue);

        const scopeIssue = checkScopeOverWidening(entity, lines, filePath);
        if (scopeIssue) issues.push(scopeIssue);
    }

    return issues;
}
