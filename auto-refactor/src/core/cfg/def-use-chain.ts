/**
 * Module: Core Engine — Variable Def-Use Chain & Flow Analysis
 * File Path: src/core/cfg/def-use-chain.ts
 * Architecture Role: Dataflow analyzer operating on top of Control Flow Graphs to track variable
 *                    definitions, references, floating promises, and unclosed resource paths.
 * Dependencies & Triggers: Consumed by pattern adapters, quality gates, and static checks;
 *                          imports ControlFlowGraph from ./cfg-builder and types from ./types.
 * Responsibilities: Extract def-use chains, detect floating unhandled promises (ASY-FLW-001),
 *                   flag unguarded null dereferences (SAF-NIL-001), and assert resource closures.
 * Exit Semantics & Design Rationale: Pure functional analysis over graph topology; returns
 *                   structured findings and guarantees zero mutations of input graphs.
 */

import type { ControlFlowGraph } from './cfg-builder';
import type {
    FlowAnalysisResult,
    FloatingPromiseFinding,
    UnclosedResourceFinding,
    UnguardedNullFinding,
    VariableDef,
    VariableUse,
} from './types';

/** Heuristic patterns identifying resource allocation or acquisition expressions. */
const RESOURCE_ALLOC_PATTERNS = [
    /\b(?:createStatusBarItem|createOutputChannel|createTerminal|createFileSystemWatcher)\b/,
    /\b(?:registerCommand|registerTextEditorCommand|registerTreeDataProvider)\b/,
    /\b(?:open|connect|acquire|subscribe|addListener)\b/,
    /\bnew\s+(?:Disposable|EventEmitter|CancellationTokenSource)\b/,
];

/** Heuristic patterns identifying resource disposal or registration calls. */
const RESOURCE_CLEANUP_PATTERNS = [
    /\b(?:dispose|close|disconnect|release|destroy)\s*\(/,
    /\bsubscriptions\.push\s*\(/,
];

/**
 * Checks if a character code represents an ECMAScript identifier word character [a-zA-Z0-9_].
 */
function isWordCharCode(code: number): boolean {
    return (
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 95
    );
}

/**
 * Checks if a character code represents a property name start/part character [a-zA-Z0-9_$].
 */
function isPropertyCharCode(code: number): boolean {
    return (
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 95 ||
        code === 36
    );
}

/**
 * High-performance, zero-allocation lexical check testing whether rawText contains
 * an explicit member dereference on the given variable (e.g. `\b${v}\.[a-zA-Z0-9_$]+`).
 * Eliminates repeated RegExp compilation inside nested block * statement * variable loops.
 */
function hasMemberDereference(rawText: string, variable: string): boolean {
    if (!rawText || !variable) return false;
    let idx = 0;
    while ((idx = rawText.indexOf(variable, idx)) !== -1) {
        if (idx === 0 || !isWordCharCode(rawText.charCodeAt(idx - 1))) {
            const dotIdx = idx + variable.length;
            if (dotIdx < rawText.length && rawText.charCodeAt(dotIdx) === 46) {
                const propIdx = dotIdx + 1;
                if (propIdx < rawText.length && isPropertyCharCode(rawText.charCodeAt(propIdx))) {
                    return true;
                }
            }
        }
        idx += variable.length;
    }
    return false;
}

/**
 * Analyzes variable definition-use chains and control-flow safety invariants.
 */
export class DefUseAnalyzer {
    /**
     * Extracts all variable definitions across all basic blocks in the graph.
     *
     * @param cfg - Target control flow graph.
     * @returns Array of variable definitions.
     */
    static extractDefinitions(cfg: ControlFlowGraph): VariableDef[] {
        const defs: VariableDef[] = [];
        for (const block of cfg.blocks) {
            for (const stmt of block.statements) {
                for (const v of stmt.definedVars) {
                    const isResource = RESOURCE_ALLOC_PATTERNS.some((p) => p.test(stmt.rawText));
                    defs.push({
                        variable: v,
                        blockId: block.id,
                        statementId: stmt.id,
                        line: stmt.line,
                        isResource,
                    });
                }
            }
        }
        return defs;
    }

    /**
     * Extracts all variable uses across all basic blocks in the graph.
     *
     * @param cfg - Target control flow graph.
     * @returns Array of variable use sites.
     */
    static extractUses(cfg: ControlFlowGraph): VariableUse[] {
        const uses: VariableUse[] = [];
        for (const block of cfg.blocks) {
            for (const stmt of block.statements) {
                for (const v of stmt.usedVars) {
                    let kind: VariableUse['kind'] = 'read';
                    if (RESOURCE_CLEANUP_PATTERNS.some((p) => p.test(stmt.rawText))) {
                        kind = 'cleanup';
                    } else if (hasMemberDereference(stmt.rawText, v)) {
                        kind = 'dereference';
                    }
                    uses.push({
                        variable: v,
                        blockId: block.id,
                        statementId: stmt.id,
                        line: stmt.line,
                        kind,
                    });
                }
            }
        }
        return uses;
    }

    /**
     * Performs complete flow analysis over the graph to find floating promises,
     * unguarded null dereferences, and escaping unclosed resources.
     * Concurrency: Thread-safe, reentrant, zero mutable static state.
     *
    /**
     * Identifies unhandled floating promise calls within the CFG.
     */
    private static collectFloatingPromises(cfg: ControlFlowGraph): FloatingPromiseFinding[] {
        const findings: FloatingPromiseFinding[] = [];
        for (const block of cfg.blocks) {
            for (const stmt of block.statements) {
                if (stmt.isFloatingPromise) {
                    findings.push({
                        line: stmt.line,
                        rawText: stmt.rawText,
                        callName: stmt.calls[0] || 'anonymousAsyncCall',
                    });
                }
            }
        }
        return findings;
    }

    /**
     * Determines which variables are safely guarded by terminating branches.
     */
    private static collectProtectedVars(cfg: ControlFlowGraph): Set<string> {
        const protectedVars = new Set<string>();
        for (const block of cfg.blocks) {
            const leavesOnGuard = block.successors.some((succ) => succ.id === cfg.exit.id);
            for (const stmt of block.statements) {
                if (!stmt.isNullGuard) continue;
                for (const v of stmt.usedVars) {
                    if (leavesOnGuard) {
                        protectedVars.add(v);
                    } else {
                        protectedVars.delete(v);
                    }
                }
            }
        }
        return protectedVars;
    }

    /**
     * Scans for dereference sites that occur without terminating null guards.
     */
    private static collectUnguardedDereferences(
        cfg: ControlFlowGraph,
        protectedVars: ReadonlySet<string>,
    ): UnguardedNullFinding[] {
        const findings: UnguardedNullFinding[] = [];
        for (const block of cfg.blocks) {
            for (const stmt of block.statements) {
                if (stmt.isNullGuard) continue;
                for (const v of stmt.usedVars) {
                    if (protectedVars.has(v)) continue;
                    if (hasMemberDereference(stmt.rawText, v)) {
                        findings.push({
                            line: stmt.line,
                            variable: v,
                            rawText: stmt.rawText,
                        });
                    }
                }
            }
        }
        return findings;
    }

    /**
     * Checks whether resource handles acquire cleanup registration before exiting.
     */
    private static collectUnclosedResources(
        cfg: ControlFlowGraph,
        defs: readonly VariableDef[],
        uses: readonly VariableUse[],
    ): UnclosedResourceFinding[] {
        const findings: UnclosedResourceFinding[] = [];
        for (const def of defs) {
            if (!def.isResource) continue;
            const hasCleanup = uses.some(
                (u) => u.variable === def.variable && u.kind === 'cleanup',
            );
            if (!hasCleanup) {
                findings.push({
                    variable: def.variable,
                    defLine: def.line,
                    exitBlockId: cfg.exit.id,
                    exitLine: cfg.exit.statements[0]?.line || def.line,
                });
            }
        }
        return findings;
    }

    /**
     * Performs complete flow analysis over the graph to find floating promises,
     * unguarded null dereferences, and escaping unclosed resources.
     * Concurrency: Thread-safe, reentrant, zero mutable static state.
     *
     * @param cfg - Control flow graph to audit.
     * @returns Consolidated findings.
     */
    static analyze(cfg: ControlFlowGraph): FlowAnalysisResult {
        const defs = DefUseAnalyzer.extractDefinitions(cfg);
        const uses = DefUseAnalyzer.extractUses(cfg);
        const floatingPromises = DefUseAnalyzer.collectFloatingPromises(cfg);
        const protectedVars = DefUseAnalyzer.collectProtectedVars(cfg);
        const unguardedDereferences = DefUseAnalyzer.collectUnguardedDereferences(cfg, protectedVars);
        const unclosedResources = DefUseAnalyzer.collectUnclosedResources(cfg, defs, uses);

        return {
            floatingPromises,
            unguardedDereferences,
            unclosedResources,
        };
    }
}
