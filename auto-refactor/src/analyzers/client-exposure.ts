/**
 * Module: Static Analysis Engine — Client Exposure Risk Analyzer
 * File Path: src/analyzers/client-exposure.ts
 * Architecture Role: Domain analyzer guarding against internal API endpoint exposure,
 *   CSS-only auth bypass, inactive feature flag payload leakage, unreleased test routes,
 *   and synthetic iframe message events missing userActivation or origin checks.
 * Dependencies & Triggers: Core types, exposure messages.
 * Responsibilities:
 *   1. SEC-EXP-001: Detect internal or administrative API paths in client code.
 *   2. SEC-EXP-002: Detect CSS/visual hiding used as the sole authorization mechanism.
 *   3. SEC-EXP-003: Detect disabled feature flags delivering full implementation code.
 *   4. SEC-EXP-004: Detect unreleased, debug, or internal staging routes packaged for clients.
 *   5. SEC-EXP-005: Detect iframe message event listeners invoking sensitive actions
 *      without userActivation or origin check.
 * Exit Semantics & Design Rationale: Pure, fail-safe scanner returning Issue[]. Zero throw.
 */

import type { Analyzer, AnalyzerContext, Issue, Severity } from '../core/types';
import { SEVERITY_ERROR, SEVERITY_WARNING } from '../core/types';
import { ExposureMessages } from '../core/messages/exposure';
import { createLineIssue } from '../core/rules/diagnostic-catalog';
import { REGEX, normalizePathSeparators } from '../core/constants';

/** Canonical analyzer identifier for client-side exposure and credential security audits. */
export const ANALYZER_CLIENT_EXPOSURE_ID = 'client-exposure';

const INTERNAL_ENDPOINT_PATTERNS: readonly RegExp[] = Object.freeze([
    REGEX.SECURITY.INTERNAL_ENDPOINT_CALL,
    REGEX.SECURITY.INTERNAL_ENDPOINT_PATH,
]);

const MAX_LISTENER_SCAN_WINDOW = 40;

const EXEMPT_PATH_SUBSTRINGS = Object.freeze(['/tests/', '/test/', '/scripts/', '/fixtures/']);

interface ExposureIssueParams {
    readonly file: string;
    readonly line: number;
    readonly rule: string;
    readonly severity: Severity;
    readonly message: string;
    readonly suggestion: string;
    readonly detail: Record<string, unknown>;
}

function makeExposureIssue(params: ExposureIssueParams): Issue {
    return createLineIssue(ANALYZER_CLIENT_EXPOSURE_ID, params.file, {
        lineIdx: params.line - 1,
        rule: params.rule,
        severity: params.severity,
        message: params.message,
        suggestion: params.suggestion,
        detail: params.detail,
    });
}

/**
 * Audits client code for internal administrative endpoint exposure (SEC-EXP-001).
 */
function auditInternalApiEndpoints(file: string, rawLines: string[], issues: Issue[]): void {
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        for (const pattern of INTERNAL_ENDPOINT_PATTERNS) {
            if (pattern.test(line)) {
                issues.push(
                    makeExposureIssue({
                        file,
                        line: i + 1,
                        rule: 'SEC-EXP-001',
                        severity: SEVERITY_ERROR,
                        message: `${ExposureMessages.INTERNAL_API_EXPOSED.message}: Internal endpoint matched on line ${i + 1}`,
                        suggestion: ExposureMessages.INTERNAL_API_EXPOSED.suggestion,
                        detail: { line: i + 1 },
                    }),
                );
                break;
            }
        }
    }
}

/**
 * Audits client markup for CSS visual hiding in lieu of server auth (SEC-EXP-002).
 */
function auditCssAuthorizationBypass(file: string, rawLines: string[], issues: Issue[]): void {
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (REGEX.SECURITY.CSS_AUTH_BYPASS.test(line)) {
            issues.push(
                makeExposureIssue({
                    file,
                    line: i + 1,
                    rule: 'SEC-EXP-002',
                    severity: SEVERITY_ERROR,
                    message: `${ExposureMessages.CLIENT_CSS_AUTH_BYPASS.message}: Element with privileged actions visually hidden`,
                    suggestion: ExposureMessages.CLIENT_CSS_AUTH_BYPASS.suggestion,
                    detail: { line: i + 1 },
                }),
            );
        }
    }
}

/**
 * Audits feature flag usage for full implementation code delivery (SEC-EXP-003).
 */
function auditFeatureFlagCodeSplitting(file: string, rawLines: string[], issues: Issue[]): void {
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (REGEX.SECURITY.FEATURE_FLAG_DEAD_GATE.test(line)) {
            issues.push(
                makeExposureIssue({
                    file,
                    line: i + 1,
                    rule: 'SEC-EXP-003',
                    severity: SEVERITY_WARNING,
                    message: `${ExposureMessages.DISABLED_FLAG_LEAKAGE.message}: Disabled feature flag branch bundled to client`,
                    suggestion: ExposureMessages.DISABLED_FLAG_LEAKAGE.suggestion,
                    detail: { line: i + 1 },
                }),
            );
        }
    }
}

/**
 * Audits router definitions for unreleased and debug routes (SEC-EXP-004).
 */
function auditUnreleasedRoutes(file: string, rawLines: string[], issues: Issue[]): void {
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (REGEX.SECURITY.CLIENT_DEBUG_ROUTE.test(line)) {
            issues.push(
                makeExposureIssue({
                    file,
                    line: i + 1,
                    rule: 'SEC-EXP-004',
                    severity: SEVERITY_ERROR,
                    message: `${ExposureMessages.UNRELEASED_ROUTE_EXPOSED.message}: Unreleased or test route found in router config`,
                    suggestion: ExposureMessages.UNRELEASED_ROUTE_EXPOSED.suggestion,
                    detail: { line: i + 1 },
                }),
            );
        }
    }
}

function hasGuardedActivationOrOrigin(lines: string[], start: number, end: number): boolean {
    for (let i = start; i < end; i++) {
        if (REGEX.SECURITY.USER_ACTIVATION_OR_ORIGIN.test(lines[i])) {
            return true;
        }
    }
    return false;
}

function findSensitiveActionLine(lines: string[], start: number, end: number): number {
    for (let i = start; i < end; i++) {
        if (REGEX.SECURITY.SENSITIVE_ACTION_TRIGGER.test(lines[i])) {
            return i + 1;
        }
    }
    return -1;
}

function auditIframeUserActivation(file: string, rawLines: string[], issues: Issue[]): void {
    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i];
        if (!REGEX.SECURITY.MESSAGE_LISTENER.test(line)) {
            continue;
        }
        const windowEnd = Math.min(rawLines.length, i + MAX_LISTENER_SCAN_WINDOW);
        const sensitiveLine = findSensitiveActionLine(rawLines, i, windowEnd);
        if (sensitiveLine === -1) {
            continue;
        }
        if (hasGuardedActivationOrOrigin(rawLines, i, windowEnd)) {
            continue;
        }
        issues.push(
            makeExposureIssue({
                file,
                line: i + 1,
                rule: 'SEC-EXP-005',
                severity: SEVERITY_ERROR,
                message: `${ExposureMessages.IFRAME_SYNTHETIC_USER_ACTIVATION.message}: Sensitive action on line ${sensitiveLine} lacks event.userActivation or origin guard`,
                suggestion: ExposureMessages.IFRAME_SYNTHETIC_USER_ACTIVATION.suggestion,
                detail: { listenerLine: i + 1, sensitiveLine },
            }),
        );
    }
}

/**
 * Client exposure risk and frontend security analyzer.
 */
export class ClientExposureAnalyzer implements Analyzer {
    readonly name = ANALYZER_CLIENT_EXPOSURE_ID;

    analyze(_sourceFile: unknown, context: AnalyzerContext): Issue[] {
        const file = normalizePathSeparators(context.filePath);
        const norm = ('/' + file).toLowerCase();
        if (EXEMPT_PATH_SUBSTRINGS.some((sub) => norm.includes(sub))) {
            return [];
        }

        const issues: Issue[] = [];
        const rawLines = context.content.split('\n');

        auditInternalApiEndpoints(file, rawLines, issues);
        auditCssAuthorizationBypass(file, rawLines, issues);
        auditFeatureFlagCodeSplitting(file, rawLines, issues);
        auditUnreleasedRoutes(file, rawLines, issues);
        auditIframeUserActivation(file, rawLines, issues);

        return issues;
    }

    /**
     * Streaming lifecycle finalization hook; allows single-pass scanning without SourceFile AST.
     */
    finalize(context: AnalyzerContext): Issue[] {
        return this.analyze(undefined, context);
    }
}
