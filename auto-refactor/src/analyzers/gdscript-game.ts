/**
 * Module: Static Analysis Engine — GDScript Game Domain Adapter
 * File Path: src/analyzers/gdscript-game.ts
 * Architecture Role: Domain adapter mapping Godot game engine contracts to generalized patterns.
 * Dependencies & Triggers: Core types, source-mask, and patterns kernel.
 * Responsibilities:
 *   1. GDM-PRF-001: Hot-path allocation guard via generalized hot-path matcher.
 *   2. GDM-POL-001: Object pool state reset contract verification.
 *   3. GDM-SIG-001: Signal disconnection and leak guard.
 *   4. GDM-ISO-001: Domain decoupling isolation guard via generalized boundary matcher.
 * Exit Semantics & Design Rationale: Pure, fail-safe scanner returning Issue[]. Zero throw.
 */

import type { Analyzer, AnalyzerContext, Issue, Severity } from '../core/types';
import { SEVERITY_ERROR, SEVERITY_WARNING } from '../core/types';
import { ANALYZER_GDSCRIPT_GAME } from '../core/scoring/dimensionLiterals';
import { REGEX } from '../core/constants';
import { createLineIssue } from '../core/rules/diagnostic-catalog';
import { maskSourceText, type SourceMaskConfig } from '../core/policy/source-mask';
import { isTestFilePath, isFixtureOrMockPath, isScriptOrGatePath } from '../core/path';
import {
    matchHotPathAllocations,
    matchBoundaryIsolation,
    type HotPathPattern,
    type BoundaryIsolationPattern,
} from '../core/domain-matcher';

const EXT_GD = '.gd';
const ACCEPTED_EXTENSIONS: readonly string[] = Object.freeze([EXT_GD] as const);

const GD_COMMENT_CHAR = '#';
const GD_QUOTE_CHARS = '"\'`';

const GD_MASK: SourceMaskConfig = Object.freeze({
    lineComment: GD_COMMENT_CHAR,
    quoteChars: GD_QUOTE_CHARS,
    multilineTemplates: false,
});

const HOT_PATH_PATTERN_NAME = 'gdscript-process-loops';

const GAME_HOT_PATH_PATTERN: HotPathPattern = Object.freeze({
    name: HOT_PATH_PATTERN_NAME,
    hotPathScopes: [
        /\bfunc\s+(?:_process|_physics_process)\s*\([^)]*\)(?:\s*->\s*[^:]+)?\s*:/,
        /\b(?:for|while)\b.*:/,
    ],
    allocationPatterns: [
        /\b(?:[A-Z][a-zA-Z0-9_]*|Array|Dictionary)\.new\s*\(/,
        /\.duplicate\s*\(\s*(?:true|false)?\s*\)/,
        /(?:^|[=:(,+\s])\[\s{0,2}\]/,
        /(?:^|[=:(,+\s])\{\s{0,2}\}/,
    ],
    poolExemptions: [/\.acquire\s*\(/, /\.reset_state\s*\(/],
});

const ISOLATION_PATTERN_NAME = 'gdscript-domain-isolation';
const ISOLATION_REASON =
    'Pure domain logic must remain decoupled from Godot scene tree and global EventBus';

const SOURCE_LAYER_INDICATORS: readonly string[] = Object.freeze([
    '/domain/',
    '/domains/',
    '/logic/',
    '/model/',
    '/entities/',
    'extends RefCounted',
    'extends Resource',
    '@domain',
    '@pure-logic',
] as const);

const FORBIDDEN_TARGETS: readonly (string | RegExp)[] = Object.freeze([
    'extends Node',
    'extends Control',
    'extends Node2D',
    'extends Node3D',
    'extends CanvasItem',
    /\bEventBus\b/,
    'get_node(',
    '$"',
    "$' ",
]);

const GAME_ISOLATION_PATTERN: BoundaryIsolationPattern = Object.freeze({
    name: ISOLATION_PATTERN_NAME,
    sourceLayerIndicators: SOURCE_LAYER_INDICATORS,
    forbiddenTargets: FORBIDDEN_TARGETS,
    reason: ISOLATION_REASON,
});

function isExemptPath(file: string): boolean {
    return isTestFilePath(file) || isFixtureOrMockPath(file) || isScriptOrGatePath(file);
}

const KEYWORD_POOL = 'pool';
const KEYWORD_FACTORY = 'factory';

const POOL_ACQUIRE_NAMES: ReadonlySet<string> = new Set(['acquire', 'get_obj']);

const MSG_POOL_MISSING_RESET = 'Object pool acquisition logic missing reset_state() contract.';
const SUGGEST_POOL_MISSING_RESET =
    'Ensure recycled objects invoke reset_state() before returning to caller to avoid state corruption.';

const SUGGEST_SIGNAL_LEAK =
    'Ensure dynamic signal connections are disconnected in cleanup or use one-shot flags.';

const SUGGEST_HOT_PATH_ALLOC =
    'Pre-allocate collections outside loops, use object pools, or reuse buffer instances.';

const SUGGEST_DOMAIN_ISOLATION =
    'Decouple domain logic from scene tree. Use dependency injection, data snapshots, or pure state machine.';

/** Structured diagnostic messaging catalog for GDScript game domain rules. */
const GAME_DIAGNOSTICS = Object.freeze({
    poolMissingReset: {
        message: MSG_POOL_MISSING_RESET,
        suggestion: SUGGEST_POOL_MISSING_RESET,
    },
    signalLeak: {
        suggestion: SUGGEST_SIGNAL_LEAK,
    },
    hotPath: {
        suggestion: SUGGEST_HOT_PATH_ALLOC,
    },
    isolation: {
        suggestion: SUGGEST_DOMAIN_ISOLATION,
    },
});

function formatSignalLeakMessage(connectCount: number, disconnectCount: number): string {
    return `Potential signal leak: ${connectCount} connects vs ${disconnectCount} disconnects without lifecycle cleanup.`;
}

function formatHotPathMessage(allocationType: string): string {
    return `Transient heap allocation (${allocationType}) in loop or hot path risks frame drops.`;
}

function formatIsolationMessage(targetIdentifier: string): string {
    const cleanId = targetIdentifier.replace(/^\\b|\\b$/g, '');
    return `Domain logic imports/references presentation or scene node '${cleanId}'.`;
}

interface GameIssueParams {
    readonly file: string;
    readonly line: number;
    readonly rule: string;
    readonly severity: Severity;
    readonly message: string;
    readonly suggestion: string;
    readonly detail: Record<string, unknown>;
}

function makeGameIssue(params: GameIssueParams): Issue {
    const { file, line, rule, severity, message, suggestion, detail } = params;
    return createLineIssue(ANALYZER_GDSCRIPT_GAME, file, {
        lineIdx: Math.max(0, line - 1),
        rule,
        severity,
        message,
        detail,
        suggestion,
    });
}

function auditPoolContracts(file: string, raw: readonly string[], issues: Issue[]): void {
    const isPoolFile = file.includes(KEYWORD_POOL) || file.includes(KEYWORD_FACTORY);
    if (!isPoolFile) return;

    let hasAcquireOrGet = false;
    let hasResetInvocation = false;

    for (const line of raw) {
        const funcDef = REGEX.SYNTAX.GDSCRIPT_FUNC.exec(line);
        if (funcDef && POOL_ACQUIRE_NAMES.has(funcDef[1])) {
            hasAcquireOrGet = true;
        }
        if (REGEX.SYNTAX.GDSCRIPT_RESET_STATE_CALL.test(line)) {
            hasResetInvocation = true;
        }
    }

    if (hasAcquireOrGet && !hasResetInvocation) {
        issues.push(
            makeGameIssue({
                file,
                line: 1,
                rule: 'GDM-POL-001',
                severity: SEVERITY_ERROR,
                message: GAME_DIAGNOSTICS.poolMissingReset.message,
                suggestion: GAME_DIAGNOSTICS.poolMissingReset.suggestion,
                detail: { file },
            }),
        );
    }
}

function auditSignalConnections(file: string, masked: readonly string[], issues: Issue[]): void {
    let connectCount = 0;
    let disconnectCount = 0;

    for (const line of masked) {
        if (line.includes('.connect') && REGEX.SYNTAX.GDSCRIPT_SIGNAL_CONNECT.test(line)) {
            connectCount++;
        }
        if (line.includes('.disconnect') && REGEX.SYNTAX.GDSCRIPT_SIGNAL_DISCONNECT.test(line)) {
            disconnectCount++;
        }
    }

    if (connectCount > disconnectCount + 2) {
        issues.push(
            makeGameIssue({
                file,
                line: 1,
                rule: 'GDM-SIG-001',
                severity: SEVERITY_WARNING,
                message: formatSignalLeakMessage(connectCount, disconnectCount),
                suggestion: GAME_DIAGNOSTICS.signalLeak.suggestion,
                detail: { connects: connectCount, disconnects: disconnectCount },
            }),
        );
    }
}

/**
 * GDScript game domain analyzer enforcing loop allocation, object pool reset,
 * signal lifecycle cleanup, and headless domain decoupling.
 */
export class GdscriptGameAnalyzer implements Analyzer {
    readonly name = ANALYZER_GDSCRIPT_GAME;

    public resetState(): void {
        // Stateless per-file analyzer — safe for pool reuse
    }

    /**
     * Streaming finalization hook invoked per file.
     *
     * @param ctx - File scan context.
     * @returns Array of issues found in the file.
     */
    finalize(ctx: AnalyzerContext): Issue[] {
        return this.analyze(undefined, ctx);
    }

    /**
     * Synchronous analysis routine for GDScript game domain rules.
     * Concurrency: Thread-safe, reentrant, zero mutable shared state.
     *
     * @param _sourceFile - Unused AST source file parameter.
     * @param ctx - File scan context containing content and path.
     * @returns Array of discovered issues.
     */
    analyze(_sourceFile: unknown, ctx: AnalyzerContext): Issue[] {
        const file = ctx.filePath.replace(/\\/g, '/');
        const hasValidExt = ACCEPTED_EXTENSIONS.some((ext) => file.endsWith(ext));
        if (!hasValidExt) return [];
        if (isExemptPath(file)) return [];

        const content = ctx.content || '';
        if (content.length === 0) return [];

        const { raw, masked } =
            ctx.lines && ctx.maskedLines
                ? { raw: ctx.lines, masked: ctx.maskedLines }
                : maskSourceText(content, GD_MASK);
        const issues: Issue[] = [];

        // 1. GDM-PRF-001 via generalized hot path matcher
        const hotViolations = matchHotPathAllocations(masked, GAME_HOT_PATH_PATTERN);
        for (const violation of hotViolations) {
            issues.push(
                makeGameIssue({
                    file,
                    line: violation.line,
                    rule: 'GDM-PRF-001',
                    severity: SEVERITY_ERROR,
                    message: formatHotPathMessage(violation.allocationType),
                    suggestion: GAME_DIAGNOSTICS.hotPath.suggestion,
                    detail: {
                        line: violation.line,
                        text: violation.rawText,
                        scope: violation.scopeName,
                    },
                }),
            );
        }

        // 2. GDM-POL-001
        auditPoolContracts(file, raw, issues);

        // 3. GDM-SIG-001
        auditSignalConnections(file, masked, issues);

        // 4. GDM-ISO-001 via generalized boundary isolation matcher
        const isoViolations = matchBoundaryIsolation(file, masked, GAME_ISOLATION_PATTERN);
        for (const iso of isoViolations) {
            issues.push(
                makeGameIssue({
                    file,
                    line: iso.line,
                    rule: 'GDM-ISO-001',
                    severity: SEVERITY_ERROR,
                    message: formatIsolationMessage(iso.targetIdentifier),
                    suggestion: GAME_DIAGNOSTICS.isolation.suggestion,
                    detail: { line: iso.line, text: iso.rawText, target: iso.targetIdentifier },
                }),
            );
        }

        return issues;
    }
}
