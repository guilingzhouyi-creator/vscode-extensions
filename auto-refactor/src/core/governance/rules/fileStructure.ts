/**
 * Module: Core Engine - Governance Rules - File Structure
 * File Path: src/core/governance/rules/fileStructure.ts
 * Architecture Role: File-level rule provider exporting FileNamingRule and ModuleHeaderRule, plus
 *     the shared PATH_DECL_RE used to recognize declared file-path document tags.
 * Dependencies & Triggers: Imports Node's path module and shared governance types; invoked once per
 *     file by GovernanceAnalyzer.finalize during any governance-enabled scan, CI job or daemon run.
 * Responsibilities: FileNamingRule derives basename/ext, exempts index/main/lib/mod/api/types,
 *     cli and README names, then enforces snake_case or kebab/camel naming per language profile;
 *     ModuleHeaderRule checks declared paths in the first 35 lines and requires a header for
 *     files of at least 40 lines, reporting naming, path-mismatch or missing-header findings.
 * Exit Semantics & Design Rationale: both rules return null when a file is clean or exempt and a
 *     violation list otherwise; they never throw and are not auto-fixable. Explicit naming parity
 *     prevents cross-platform casing issues and keeps entry modules discoverable, while path
 *     declaration checks stop header drift from hiding the real module location.
 */
import * as path from 'path';
import { isToolOrTestScript } from '../pathScope';
import type { GovernanceRule, GovernanceViolation, RuleEvaluationContext } from '../types';

const SNAKE_CASE_RE = /^[a-z0-9]+(_[a-z0-9]+)*$/;
const KEBAB_OR_CAMEL_RE = /^[a-z0-9]+(-[a-z0-9]+)*$|^[a-z][a-zA-Z0-9]*$/;
const PASCAL_CASE_RE = /^[A-Z][a-zA-Z0-9]*$/;
const PATH_DECL_TAG_RE = /文件路径|@file/;
const HEADER_KEYWORD_RE = /\/\*\*|职责|Responsibilities|Overview|模块归属|\/\/\s*={10,}|#\s*={10,}/;

/**
 * Validates snake_case file naming convention.
 */
function validateSnakeCaseNaming(
    nameWithoutExt: string,
    ext: string,
): { valid: boolean; suggestion: string } {
    const checked = ext === '.py' ? nameWithoutExt.replace(/^_(?!_)/, '') : nameWithoutExt;
    if (!SNAKE_CASE_RE.test(checked)) {
        return {
            valid: false,
            suggestion: `Rename file to snake_case (e.g. \`${checked.replace(/[-\s]+/g, '_').toLowerCase()}${ext}\`).`,
        };
    }
    return { valid: true, suggestion: '' };
}

/**
 * Validates kebab-case file naming convention.
 */
function validateKebabCaseNaming(
    nameWithoutExt: string,
    ext: string,
    ctx: RuleEvaluationContext,
): { valid: boolean; suggestion: string } {
    if (KEBAB_OR_CAMEL_RE.test(nameWithoutExt)) {
        return { valid: true, suggestion: '' };
    }
    const isPascal = PASCAL_CASE_RE.test(nameWithoutExt);
    const opts = ctx.ctx?.options as Record<string, unknown> | undefined;
    const allowPascal = opts?.allowPascalCaseClasses !== false;
    const matchesDecl = isPascal && allowPascal && hasTypeDecl(ctx.content, nameWithoutExt);
    if (matchesDecl) {
        return { valid: true, suggestion: '' };
    }
    const kebab = nameWithoutExt.replace(/[_]/g, '-').toLowerCase();
    return {
        valid: false,
        suggestion: `Rename file to kebab-case (e.g. \`${kebab}${ext}\`).`,
    };
}

/**
 * GOV-FIL-001: File and Module Naming Convention.
 * Enforces kebab-case/camelCase in TS and snake_case in GDScript/Rust.
 */
export const FileNamingRule: GovernanceRule = {
    id: 'GOV-FIL-001',
    name: 'Standard File & Module Naming Convention',
    category: 'file_structure',
    severity: 'warning',
    risk: 'low',
    rationale:
        'Inconsistent file naming causes cross-platform casing issues and impairs modular discovery.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        const baseName = path.basename(ctx.filePath);
        const ext = path.extname(baseName);
        const nameWithoutExt = baseName.slice(0, -ext.length);

        // Skip special files (including documentation entry points)
        const IGNORED_BASENAMES = new Set([
            'index',
            'main',
            'lib',
            'mod',
            'api',
            'types',
            'cli',
            'README',
            'readme',
            'Readme',
        ]);
        if (IGNORED_BASENAMES.has(nameWithoutExt) || nameWithoutExt.toLowerCase() === 'readme') {
            return null;
        }

        // Python package markers (`__init__.py`, `__main__.py`, …) are mandated by the runtime and
        // pytest pins `conftest.py`; neither is a style violation, so they are exempt from the
        // snake_case check that would otherwise reject the surrounding double underscores.
        if (
            ext === '.py' &&
            (nameWithoutExt === 'conftest' || /^__[a-z0-9_]+__$/.test(nameWithoutExt))
        ) {
            return null;
        }

        const convention = ctx.capabilities.namingConventions.file;
        let result = { valid: true, suggestion: '' };

        if (convention === 'snake_case') {
            result = validateSnakeCaseNaming(nameWithoutExt, ext);
        } else if (convention === 'kebab-case') {
            result = validateKebabCaseNaming(nameWithoutExt, ext, ctx);
        }

        if (!result.valid) {
            return [
                {
                    ruleId: 'GOV-FIL-001',
                    message: `File \`${baseName}\` violates standard \`${convention}\` naming convention for ${ctx.capabilities.languageId}.`,
                    line: 1,
                    column: 1,
                    suggestion: result.suggestion,
                    fixable: false,
                },
            ];
        }
        return null;
    },
};

const PATH_DECL_RE = /(?:文件路径:|@file(?:name)?)\s*[:=]?\s*([^\s*]+)/;

/**
 * Number of leading lines scanned for a declared path tag during the path-parity check.
 */
const PATH_DECL_SCAN_LINES = 35;

/**
 * Minimum file length (lines) before a module header comment is required.
 */
const MIN_HEADER_ENFORCEMENT_LINES = 40;

/**
 * Number of leading lines scanned when checking for a module responsibility/header comment.
 */
const HEADER_SCAN_LINES = 50;

/**
 * Validates declared @file or localized file-path tag against actual physical path.
 */
function validatePathParity(lines: string[], normalizedPath: string): GovernanceViolation | null {
    const scanLimit = Math.min(PATH_DECL_SCAN_LINES, lines.length);
    for (let i = 0; i < scanLimit; i++) {
        const line = lines[i];
        if (!/^\s*(?:\/\*|\*|\/\/|#|"{3}|'{3})/.test(line)) continue;
        if (!PATH_DECL_TAG_RE.test(line)) continue;
        const match = PATH_DECL_RE.exec(line);
        if (!match || !match[1]) continue;

        const declPath = match[1].trim().replace(/\\/g, '/');
        const cleanDecl = declPath.replace(/^res:\/\//, '').replace(/^\/+/, '');
        const cleanPhysical = normalizedPath.replace(/^\/+/, '');
        const declBasename = path.basename(cleanDecl);
        const physicalBasename = path.basename(cleanPhysical);

        const matches =
            cleanPhysical === cleanDecl ||
            cleanPhysical.endsWith('/' + cleanDecl) ||
            cleanDecl.endsWith('/' + cleanPhysical);

        if (!matches || declBasename !== physicalBasename) {
            return {
                ruleId: 'GOV-FIL-002',
                message: `Declared header path \`${declPath}\` does not match physical file path \`${normalizedPath}\`.`,
                line: i + 1,
                column: match.index != null ? match.index + 1 : 1,
                suggestion: `Synchronize declared header path to match the real relative path: \`${normalizedPath}\`.`,
                fixable: false,
            };
        }
    }
    return null;
}

/**
 * Checks whether the module contains an architectural docstring header in leading lines.
 */
function hasModuleHeaderDocstring(lines: string[], isPython: boolean): boolean {
    const headLimit = Math.min(HEADER_SCAN_LINES, lines.length);
    for (let i = 0; i < headLimit; i++) {
        const l = lines[i];
        const trimmed = l.trim();
        if (isPython && (trimmed.startsWith('"""') || trimmed.startsWith("'''"))) {
            return true;
        }
        if (HEADER_KEYWORD_RE.test(l)) {
            return true;
        }
    }
    return false;
}

const EXT_PY = '.py';

/**
 * GOV-FIL-002: Module Responsibility & Architectural Docstring Header.
 * Ensures significant modules provide architectural overview comments and path parity.
 */
export const ModuleHeaderRule: GovernanceRule = {
    id: 'GOV-FIL-002',
    name: 'Module Responsibility & Architectural Docstring Header',
    category: 'file_structure',
    severity: 'info',
    risk: 'low',
    rationale:
        'Substantial production modules must declare their architectural role and responsibility boundary.',
    isFixable: false,
    checkFile(ctx: RuleEvaluationContext): GovernanceViolation[] | null {
        const normalizedPath = ctx.filePath.replace(/\\/g, '/');
        if (isToolOrTestScript(normalizedPath)) {
            return null;
        }

        // 1. Path Parity Check
        const parityViolation = validatePathParity(ctx.lines, normalizedPath);
        if (parityViolation) return [parityViolation];

        // 2. Only enforce header presence for substantial production modules (> 40 lines)
        if (ctx.lines.length < MIN_HEADER_ENFORCEMENT_LINES) return null;

        const isPython = normalizedPath.endsWith(EXT_PY);
        if (!hasModuleHeaderDocstring(ctx.lines, isPython)) {
            return [
                {
                    ruleId: 'GOV-FIL-002',
                    message: `Module \`${path.basename(ctx.filePath)}\` lacks a responsibility or docstring header comment in the first 15 lines.`,
                    line: 1,
                    column: 1,
                    suggestion:
                        'Add a header comment block describing module responsibility and boundary contract.',
                    fixable: false,
                },
            ];
        }

        return null;
    },
};

function hasTypeDecl(content: string, name: string): boolean {
    const patterns = [`class ${name}`, `interface ${name}`, `type ${name}`, `enum ${name}`];
    return patterns.some((p) => content.includes(p));
}
