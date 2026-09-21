/**
 * Module: Engine Core — Unsupported-Language Fail-Closed Guard
 * File Path: src/core/ast/language-support.ts
 * Architecture Role: Shared guard consumed by both analysis paths (in-process Scanner and worker)
 * Dependencies & Triggers: Called once per file by analyzer.ts `runAnalyzers` and worker.ts
 *     `analyzeFile`; consult the adapter registry through `hasAdapterFor`
 * Responsibilities: Resolve the configured `unsupportedLanguage` severity and build the
 *     LANG-UNSUPPORTED diagnostic for files no language adapter can parse
 * Exit Semantics & Design Rationale: Pure functions; `unsupportedLanguageDiagnostic` returns
 *     null when the language is supported or the check is disabled, so callers push nothing.
 *     The guard exists because the adapter registry falls back to the TypeScript parser for
 *     unknown extensions: without it, an unsupported language yields zero AST findings and a
 *     successful exit, silently understating results (fail-open).
 */

import type { Issue, ScanConfig, UnsupportedLanguageSeverity } from '../types';
import { hasAdapterFor } from './adapters';
import * as path from 'path';

/** Rule id of the engine-level unsupported-language diagnostic. */
export const LANG_UNSUPPORTED_RULE = 'LANG-UNSUPPORTED';

/**
 * Resolve the effective unsupported-language reporting severity.
 *
 * @param cfg - Resolved scan config; an absent value means the fail-closed default `error`.
 * @returns The severity the guard must apply.
 */
export function unsupportedLanguageSeverity(cfg: ScanConfig): UnsupportedLanguageSeverity {
    return cfg.unsupportedLanguage ?? 'error';
}

/**
 * Build the fail-closed diagnostic for a file that no language adapter claims.
 *
 * @param filePath - Repo-relative file path being analyzed, used verbatim in the issue location.
 * @param cfg - Resolved scan config supplying the severity and selected parser.
 * @returns The diagnostic, or null when the extension is claimed by an adapter or the check is off.
 */
export function unsupportedLanguageDiagnostic(filePath: string, cfg: ScanConfig): Issue | null {
    if (hasAdapterFor(filePath, cfg.parser)) return null;
    const severity = unsupportedLanguageSeverity(cfg);
    if (severity === 'off') return null;
    const ext = path.extname(filePath).toLowerCase();
    return {
        id: `core:${LANG_UNSUPPORTED_RULE}:${filePath}:1`,
        analyzer: 'language',
        rule: LANG_UNSUPPORTED_RULE,
        severity,
        message:
            `No language adapter claims '${ext}': '${filePath}' was parsed by the fallback ` +
            'TypeScript adapter, so AST-based analyzers (complexity, constants, architecture, ' +
            'dependency-graph, scoring) have no signal for this file',
        location: { file: filePath, start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
        detail: { extension: ext, parser: cfg.parser, severity },
        suggestion:
            'Add a language adapter for this extension, exclude the path, or set ' +
            '`unsupportedLanguage` to "warning"/"off" to acknowledge the reduced coverage',
    };
}
