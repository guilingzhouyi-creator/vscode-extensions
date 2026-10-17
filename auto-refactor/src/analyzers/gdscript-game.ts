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
import { maskSourceText, type SourceMaskConfig } from '../core/policy/source-mask';
import {
    matchHotPathAllocations,
    matchBoundaryIsolation,
    type HotPathPattern,
    type BoundaryIsolationPattern,
} from '../core/patterns';

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
        /\bfunc\s+(?:_process|_physics_process)\s*\([^)]*\)\s*:/,
        /\b(?:for|while)\b.*:/,
    ],
    allocationPatterns: [
        /\b(?:[A-Z][a-zA-Z0-9_]*|Array|Dictionary)\.new\s*\(/,
        /\.duplicate\s*\(\s*(?:true|false)?\s*\)/,
        /\[\s*\]/,
        /\{\s*\}/,
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

const FORBIDDEN_TARGETS: readonly string[] = Object.freeze([
    'extends Node',
    'extends Control',
    'extends Node2D',
    'extends Node3D',
    'extends CanvasItem',
    'EventBus',
    'get_node(',
    '$"',
    "$' ",
] as const);

const GAME_ISOLATION_PATTERN: BoundaryIsolationPattern = Object.freeze({
    name: ISOLATION_PATTERN_NAME,
    sourceLayerIndicators: SOURCE_LAYER_INDICATORS,
    forbiddenTargets: FORBIDDEN_TARGETS,
    reason: ISOLATION_REASON,
});

const EXEMPT_PATH_RE = /(?:^|\/)(?:tests?|fixtures|scripts)\//i;

function isExemptPath(file: string): boolean {
    return EXEMPT_PATH_RE.test(file);
}

const KEYWORD_POOL = 'pool';
const KEYWORD_FACTORY = 'factory';

const POOL_ACQUIRE_NAMES: ReadonlySet<string> = new Set(['acquire', 'get_obj']);
const POOL_RESET_NAMES: ReadonlySet<string> = new Set(['reset_state']);

const FUNC_DEF_RE = /^\s*func\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/;
const RESET_STATE_CALL_RE = /(?:\.|\b)(reset_state)\s*\(/;
const SIGNAL_CONNECT_RE = /\.connect\s*\(/;
const SIGNAL_DISCONNECT_RE = /\.disconnect\s*\(/;

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
    return `Domain logic imports/references presentation or scene node '${targetIdentifier}'.`;
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
    return {
        id: `${ANALYZER_GDSCRIPT_GAME}:${rule}:${file}:${line}`,
        analyzer: ANALYZER_GDSCRIPT_GAME,
        rule,
        severity,
        message,
        location: { file, start: { line, column: 1 }, end: { line, column: 1 } },
        detail,
        suggestion,
    };
}

function auditPoolContracts(file: string, raw: readonly string[], issues: Issue[]): void {
    const isPoolFile = file.includes(KEYWORD_POOL) || file.includes(KEYWORD_FACTORY);
    if (!isPoolFile) return;

    let hasAcquireOrGet = false;
    let hasResetInvocation = false;

    for (const line of raw) {
        const funcDef = FUNC_DEF_RE.exec(line);
        if (funcDef && POOL_ACQUIRE_NAMES.has(funcDef[1])) {
            hasAcquireOrGet = true;
        }
        const resetCall = RESET_STATE_CALL_RE.exec(line);
        if (resetCall && POOL_RESET_NAMES.has(resetCall[1])) {
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
        if (SIGNAL_CONNECT_RE.test(line)) connectCount++;
        if (SIGNAL_DISCONNECT_RE.test(line)) disconnectCount++;
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
     * @param _sf - Unused AST source file parameter.
     * @param ctx - File scan context containing content and path.
     * @returns Array of discovered issues.
     */
    analyze(_sf: unknown, ctx: AnalyzerContext): Issue[] {
        const file = ctx.filePath.replace(/\\/g, '/');
        const hasValidExt = ACCEPTED_EXTENSIONS.some((ext) => file.endsWith(ext));
        if (!hasValidExt) return [];
        if (isExemptPath(file)) return [];

        const content = ctx.content || '';
        if (content.length === 0) return [];

        const { raw, masked } = maskSourceText(content, GD_MASK);
        const issues: Issue[] = [];

        // 1. GDM-PRF-001 via generalized hot path matcher
        const hotViolations = matchHotPathAllocations(masked, GAME_HOT_PATH_PATTERN);
        for (const h of hotViolations) {
            issues.push(
                makeGameIssue({
                    file,
                    line: h.line,
                    rule: 'GDM-PRF-001',
                    severity: SEVERITY_ERROR,
                    message: formatHotPathMessage(h.allocationType),
                    suggestion: GAME_DIAGNOSTICS.hotPath.suggestion,
                    detail: { line: h.line, text: h.rawText, scope: h.scopeName },
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
