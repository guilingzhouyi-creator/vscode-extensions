/**
 * Module: Static Analysis Engine — Client Exposure Risk Analyzer
 * File Path: src/analyzers/client-exposure.ts
 * Architecture Role: Domain analyzer guarding against internal API endpoint exposure,
 *   CSS-only auth bypass, inactive feature flag payload leakage, and unreleased test routes.
 * Dependencies & Triggers: Core types, exposure messages.
 * Responsibilities:
 *   1. SEC-EXP-001: Detect internal or administrative API paths in client code.
 *   2. SEC-EXP-002: Detect CSS/visual hiding used as the sole authorization mechanism.
 *   3. SEC-EXP-003: Detect disabled feature flags delivering full implementation code.
 *   4. SEC-EXP-004: Detect unreleased, debug, or internal staging routes packaged for clients.
 * Exit Semantics & Design Rationale: Pure, fail-safe scanner returning Issue[]. Zero throw.
 */

import type { Analyzer, AnalyzerContext, Issue, Severity } from '../core/types';
import { SEVERITY_ERROR, SEVERITY_WARNING } from '../core/types';
import { ExposureMessages } from '../core/messages/exposure';

export const ANALYZER_CLIENT_EXPOSURE_ID = 'client-exposure';

const INTERNAL_ENDPOINT_PATTERNS = [
    /(?:fetch|axios\.(?:get|post|put|delete)|request)\s*\(\s*['"`](?:https?:\/\/[^'"`]+)?\/(?:api\/)?(?:internal|admin\/internal|actuator|debug|private)\//i,
    /['"`]\/(?:internal|admin\/internal|actuator|debug)\/[a-zA-Z0-9_/-]+['"`]/i,
];

const CSS_AUTH_BYPASS_RE =
    /<(?:button|div|span|form)[^>]*(?:style\s*=\s*['"][^'"]*display\s*:\s*none|hidden\b)[^>]*(?:admin|manage|delete|grant|privileged)/i;

const DISABLED_FEATURE_FLAG_RE =
    /\bif\s*\(\s*(?:FEATURE_FLAGS\.[A-Z0-9_]+\s*===?\s*false|!FEATURE_FLAGS\.[A-Z0-9_]+)\s*\)\s*\{/i;

const UNRELEASED_ROUTE_RE =
    /\b(?:path|route)\s*:\s*['"`]\/(?:test|sandbox|debug|preview|internal-only)[a-zA-Z0-9_/-]*['"`]/i;

function makeExposureIssue(
    file: string,
    line: number,
    rule: string,
    severity: Severity,
    message: string,
    suggestion: string,
    detail: Record<string, unknown>,
): Issue {
    return {
        id: `${ANALYZER_CLIENT_EXPOSURE_ID}:${rule}:${file}:${line}`,
        analyzer: ANALYZER_CLIENT_EXPOSURE_ID,
        rule,
        severity,
        message,
        location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
        detail,
        suggestion,
    };
}

/**
 * Audits client code for internal administrative endpoint exposure (SEC-EXP-001).
 */
function auditInternalApiEndpoints(
    file: string,
    rawLines: string[],
    issues: Issue[],
): void {
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        for (const pattern of INTERNAL_ENDPOINT_PATTERNS) {
            if (pattern.test(line)) {
                issues.push(
                    makeExposureIssue(
                        file,
                        i + 1,
                        'SEC-EXP-001',
                        SEVERITY_ERROR,
                        `${ExposureMessages.INTERNAL_API_EXPOSED.message}: Internal endpoint matched on line ${i + 1}`,
                        ExposureMessages.INTERNAL_API_EXPOSED.suggestion,
                        { line: i + 1 },
                    ),
                );
                break;
            }
        }
    }
}

/**
 * Audits client markup for CSS visual hiding in lieu of server auth (SEC-EXP-002).
 */
function auditCssAuthorizationBypass(
    file: string,
    rawLines: string[],
    issues: Issue[],
): void {
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (CSS_AUTH_BYPASS_RE.test(line)) {
            issues.push(
                makeExposureIssue(
                    file,
                    i + 1,
                    'SEC-EXP-002',
                    SEVERITY_ERROR,
                    `${ExposureMessages.CLIENT_CSS_AUTH_BYPASS.message}: Element with privileged actions visually hidden`,
                    ExposureMessages.CLIENT_CSS_AUTH_BYPASS.suggestion,
                    { line: i + 1 },
                ),
            );
        }
    }
}

/**
 * Audits feature flag usage for full implementation code delivery (SEC-EXP-003).
 */
function auditFeatureFlagCodeSplitting(
    file: string,
    rawLines: string[],
    issues: Issue[],
): void {
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (DISABLED_FEATURE_FLAG_RE.test(line)) {
            issues.push(
                makeExposureIssue(
                    file,
                    i + 1,
                    'SEC-EXP-003',
                    SEVERITY_WARNING,
                    `${ExposureMessages.DISABLED_FLAG_LEAKAGE.message}: Disabled feature flag branch bundled to client`,
                    ExposureMessages.DISABLED_FLAG_LEAKAGE.suggestion,
                    { line: i + 1 },
                ),
            );
        }
    }
}

/**
 * Audits router definitions for unreleased and debug routes (SEC-EXP-004).
 */
function auditUnreleasedRoutes(
    file: string,
    rawLines: string[],
    issues: Issue[],
): void {
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (UNRELEASED_ROUTE_RE.test(line)) {
            issues.push(
                makeExposureIssue(
                    file,
                    i + 1,
                    'SEC-EXP-004',
                    SEVERITY_ERROR,
                    `${ExposureMessages.UNRELEASED_ROUTE_EXPOSED.message}: Unreleased or test route found in router config`,
                    ExposureMessages.UNRELEASED_ROUTE_EXPOSED.suggestion,
                    { line: i + 1 },
                ),
            );
        }
    }
}

/**
 * Client exposure risk and frontend security analyzer.
 */
export class ClientExposureAnalyzer implements Analyzer {
    readonly name = ANALYZER_CLIENT_EXPOSURE_ID;

    analyze(_sf: any, context: AnalyzerContext): Issue[] {
        const file = context.filePath.replace(/\\/g, '/');
        const norm = ('/' + file).toLowerCase();
        if (
            norm.includes('/tests/') ||
            norm.includes('/test/') ||
            norm.includes('/scripts/') ||
            norm.includes('/fixtures/')
        ) {
            return [];
        }

        const issues: Issue[] = [];
        const rawLines = context.content.split('\n');

        auditInternalApiEndpoints(file, rawLines, issues);
        auditCssAuthorizationBypass(file, rawLines, issues);
        auditFeatureFlagCodeSplitting(file, rawLines, issues);
        auditUnreleasedRoutes(file, rawLines, issues);

        return issues;
    }
}
