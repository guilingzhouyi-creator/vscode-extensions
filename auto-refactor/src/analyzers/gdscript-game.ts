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

const ACCEPTED_EXTENSIONS = ['.gd'];

const GD_MASK: SourceMaskConfig = {
    lineComment: '#',
    quoteChars: '"\'`',
    multilineTemplates: false,
};

const GAME_HOT_PATH_PATTERN: HotPathPattern = {
    name: 'gdscript-process-loops',
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
};

const GAME_ISOLATION_PATTERN: BoundaryIsolationPattern = {
    name: 'gdscript-domain-isolation',
    sourceLayerIndicators: [
        '/domain/',
        '/domains/',
        '/logic/',
        '/model/',
        '/entities/',
        'extends RefCounted',
        'extends Resource',
        '@domain',
        '@pure-logic',
    ],
    forbiddenTargets: [
        'extends Node',
        'extends Control',
        'extends Node2D',
        'extends Node3D',
        'extends CanvasItem',
        'EventBus',
        'get_node(',
        '$"',
        "$' ",
    ],
    reason: 'Pure domain logic must remain decoupled from Godot scene tree and global EventBus',
};

function makeGameIssue(
    file: string,
    line: number,
    rule: string,
    severity: Severity,
    message: string,
    suggestion: string,
    detail: Record<string, unknown>,
): Issue {
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

function isExemptPath(file: string): boolean {
    const lower = file.toLowerCase();
    return (
        lower.startsWith('test/') ||
        lower.startsWith('tests/') ||
        lower.startsWith('fixtures/') ||
        lower.startsWith('scripts/') ||
        lower.includes('/test/') ||
        lower.includes('/tests/') ||
        lower.includes('/fixtures/') ||
        lower.includes('/scripts/')
    );
}

function auditPoolContracts(file: string, raw: readonly string[], issues: Issue[]): void {
    const isPoolFile = file.includes('pool') || file.includes('factory');
    if (!isPoolFile) return;

    let hasAcquireOrGet = false;
    let hasResetInvocation = false;

    for (const line of raw) {
        if (line.includes('func acquire(') || line.includes('func get_obj(')) {
            hasAcquireOrGet = true;
        }
        if (line.includes('.reset_state(') || line.includes('reset_state()')) {
            hasResetInvocation = true;
        }
    }

    if (hasAcquireOrGet && !hasResetInvocation) {
        issues.push(
            makeGameIssue(
                file,
                1,
                'GDM-POL-001',
                SEVERITY_ERROR,
                'Object pool acquisition logic missing reset_state() contract.',
                'Ensure recycled objects invoke reset_state() before returning to caller to avoid state corruption.',
                { file },
            ),
        );
    }
}

function auditSignalConnections(file: string, masked: readonly string[], issues: Issue[]): void {
    let connectCount = 0;
    let disconnectCount = 0;

    for (const line of masked) {
        if (line.includes('.connect(')) connectCount++;
        if (line.includes('.disconnect(')) disconnectCount++;
    }

    if (connectCount > disconnectCount + 2) {
        issues.push(
            makeGameIssue(
                file,
                1,
                'GDM-SIG-001',
                SEVERITY_WARNING,
                `Potential signal leak: ${connectCount} connects vs ${disconnectCount} disconnects without lifecycle cleanup.`,
                'Ensure dynamic signal connections are disconnected in cleanup or use one-shot flags.',
                { connects: connectCount, disconnects: disconnectCount },
            ),
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
                makeGameIssue(
                    file,
                    h.line,
                    'GDM-PRF-001',
                    SEVERITY_ERROR,
                    `Transient heap allocation (${h.allocationType}) in loop or hot path risks frame drops.`,
                    'Pre-allocate collections outside loops, use object pools, or reuse buffer instances.',
                    { line: h.line, text: h.rawText, scope: h.scopeName },
                ),
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
                makeGameIssue(
                    file,
                    iso.line,
                    'GDM-ISO-001',
                    SEVERITY_ERROR,
                    `Domain logic imports/references presentation or scene node '${iso.targetIdentifier}'.`,
                    'Decouple domain logic from scene tree. Use dependency injection, data snapshots, or pure state machine.',
                    { line: iso.line, text: iso.rawText, target: iso.targetIdentifier },
                ),
            );
        }

        return issues;
    }
}
