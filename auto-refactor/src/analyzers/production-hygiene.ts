/**
 * Module: Static Analysis Engine — Production Build Hygiene Analyzer
 * File Path: src/analyzers/production-hygiene.ts
 * Architecture Role: Domain analyzer guarding against dev-residue, source map leakage,
 *   and backend environment secret leaks in production build artifacts and client code.
 * Dependencies & Triggers: Core types, exposure messages.
 * Responsibilities:
 *   1. PROD-HYG-001: Detect console.debug, TODO markers, and local paths in production artifacts.
 *   2. PROD-HYG-002: Detect source map references (sourceMappingURL) in production bundles.
 *   3. PROD-HYG-003: Detect backend environment secrets leaked into frontend client code.
 * Exit Semantics & Design Rationale: Pure, fail-safe scanner returning Issue[]. Zero throw.
 */

import type { Analyzer, AnalyzerContext, Issue, Severity } from '../core/types';
import { SEVERITY_ERROR, SEVERITY_WARNING } from '../core/types';
import { ExposureMessages } from '../core/messages/exposure';
import { createLineIssue } from '../core/rules/diagnostic-catalog';
import { REGEX } from '../core/constants';
/** Canonical analyzer identifier for production bundle artifact and secret hygiene audits. */
export const ANALYZER_PRODUCTION_HYGIENE_ID = 'production-hygiene';

const PROD_OUTPUT_DIRS = ['/dist/', '/build/', '/out/', '/release/'];

const SENSITIVE_BACKEND_ENV_RE = REGEX.SECURITY.SENSITIVE_BACKEND_ENV;

const LOCAL_ABSOLUTE_PATH_RE = REGEX.SECURITY.LOCAL_ABSOLUTE_PATH;

/** Regular expression matching public sourceMappingURL directives excluding inline data URIs. */
export const SOURCE_MAP_PUBLIC_DIRECTIVE_RE = REGEX.SECURITY.SOURCE_MAP_PUBLIC_DIRECTIVE;

function makeProdHygieneIssue(
    file: string,
    line: number,
    rule: string,
    severity: Severity,
    message: string,
    suggestion: string,
    detail: Record<string, unknown>,
): Issue {
    return createLineIssue(ANALYZER_PRODUCTION_HYGIENE_ID, file, {
        lineIdx: line - 1,
        rule,
        severity,
        message,
        suggestion,
        detail,
    });
}

/**
 * Checks whether a file path points to a production build output artifact.
 */
function isProductionArtifact(filePath: string): boolean {
    const normalized = ('/' + filePath.replace(/\\/g, '/')).toLowerCase();
    if (
        normalized.endsWith('.min.js') ||
        normalized.endsWith('.min.css') ||
        normalized.endsWith('.map')
    ) {
        return true;
    }
    return PROD_OUTPUT_DIRS.some((dir) => normalized.includes(dir));
}

/**
 * Audits production build artifacts for debug leftovers, TODOs, and absolute paths (PROD-HYG-001).
 */
function auditDebugResidueAndPaths(file: string, rawLines: string[], issues: Issue[]): void {
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (REGEX.SECURITY.CONSOLE_DEBUG_TRACE.test(line)) {
            issues.push(
                makeProdHygieneIssue(
                    file,
                    i + 1,
                    'PROD-HYG-001',
                    SEVERITY_WARNING,
                    `${ExposureMessages.PROD_DEBUG_RESIDUE.message}: console.debug call present in production artifact`,
                    ExposureMessages.PROD_DEBUG_RESIDUE.suggestion,
                    { violation: 'debug-console-call', line: i + 1 },
                ),
            );
        }
        if (
            REGEX.SECURITY.PENDING_TODO_FIXME.test(line) &&
            !line.includes('// license') &&
            !line.includes('/*')
        ) {
            issues.push(
                makeProdHygieneIssue(
                    file,
                    i + 1,
                    'PROD-HYG-001',
                    SEVERITY_WARNING,
                    `${ExposureMessages.PROD_DEBUG_RESIDUE.message}: Pending marker present in production artifact`,
                    ExposureMessages.PROD_DEBUG_RESIDUE.suggestion,
                    { violation: 'todo-marker-in-prod', line: i + 1 },
                ),
            );
        }
        if (LOCAL_ABSOLUTE_PATH_RE.test(line)) {
            issues.push(
                makeProdHygieneIssue(
                    file,
                    i + 1,
                    'PROD-HYG-001',
                    SEVERITY_ERROR,
                    `${ExposureMessages.PROD_DEBUG_RESIDUE.message}: Workstation absolute path exposed in artifact`,
                    ExposureMessages.PROD_DEBUG_RESIDUE.suggestion,
                    { violation: 'absolute-path-leak', line: i + 1 },
                ),
            );
        }
    }
}

/**
 * Audits production output for public Source Map leakage (PROD-HYG-002).
 */
function auditSourceMapLeakage(file: string, rawLines: string[], issues: Issue[]): void {
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (SOURCE_MAP_PUBLIC_DIRECTIVE_RE.test(line)) {
            issues.push(
                makeProdHygieneIssue(
                    file,
                    i + 1,
                    'PROD-HYG-002',
                    SEVERITY_ERROR,
                    `${ExposureMessages.PROD_SOURCE_MAP_LEAK.message}: Public sourceMappingURL directive in production build`,
                    ExposureMessages.PROD_SOURCE_MAP_LEAK.suggestion,
                    { violation: 'source-map-exposed', line: i + 1 },
                ),
            );
            break;
        }
    }
}

/**
 * Audits client-facing files for backend environment secret leakage (PROD-HYG-003).
 */
function auditBackendEnvSecrets(file: string, rawLines: string[], issues: Issue[]): void {
    const isClientFacing =
        file.includes('/src/presentation/') ||
        file.includes('/src/client/') ||
        file.includes('/src/web/') ||
        file.endsWith('.tsx') ||
        file.endsWith('.jsx');

    if (!isClientFacing) return;

    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        const match = SENSITIVE_BACKEND_ENV_RE.exec(line);
        if (match) {
            issues.push(
                makeProdHygieneIssue(
                    file,
                    i + 1,
                    'PROD-HYG-003',
                    SEVERITY_ERROR,
                    `${ExposureMessages.PROD_ENV_SECRET_LEAK.message}: Sensitive variable '${match[0]}' in client code`,
                    ExposureMessages.PROD_ENV_SECRET_LEAK.suggestion,
                    { variable: match[0], line: i + 1 },
                ),
            );
        }
    }
}

/**
 * Production build hygiene and client secret leakage analyzer.
 */
export class ProductionHygieneAnalyzer implements Analyzer {
    readonly name = ANALYZER_PRODUCTION_HYGIENE_ID;

    public resetState(): void {
        // Stateless production hygiene analyzer - safe for pool reuse
    }

    analyze(_sourceFile: unknown, context: AnalyzerContext): Issue[] {
        const file = context.filePath;
        const issues: Issue[] = [];
        const rawLines = context.content.split('\n');

        if (isProductionArtifact(file)) {
            auditDebugResidueAndPaths(file, rawLines, issues);
            auditSourceMapLeakage(file, rawLines, issues);
        }

        auditBackendEnvSecrets(file, rawLines, issues);

        return issues;
    }

    /**
     * Streaming lifecycle finalization hook; allows single-pass scanning without SourceFile AST.
     */
    finalize(context: AnalyzerContext): Issue[] {
        return this.analyze(undefined, context);
    }
}
