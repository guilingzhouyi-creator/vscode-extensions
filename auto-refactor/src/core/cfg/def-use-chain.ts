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
                    } else if (new RegExp(`\\b${v}\\.[a-zA-Z_$]`).test(stmt.rawText)) {
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
     * @param cfg - Control flow graph to audit.
     * @returns Consolidated findings.
     */
    static analyze(cfg: ControlFlowGraph): FlowAnalysisResult {
        const floatingPromises: FloatingPromiseFinding[] = [];
        const unguardedDereferences: UnguardedNullFinding[] = [];
        const unclosedResources: UnclosedResourceFinding[] = [];

        const defs = DefUseAnalyzer.extractDefinitions(cfg);
        const uses = DefUseAnalyzer.extractUses(cfg);

        // 1. Detect floating promise expressions (ASY-FLW-001)
        for (const block of cfg.blocks) {
            for (const stmt of block.statements) {
                if (stmt.isFloatingPromise) {
                    floatingPromises.push({
                        line: stmt.line,
                        rawText: stmt.rawText,
                        callName: stmt.calls[0] || 'anonymousAsyncCall',
                    });
                }
            }
        }

        // 2. Detect unguarded null dereferences (SAF-NIL-001)
        // If a statement checks a variable and doesn't terminate, subsequent dereferences are flagged
        const guardedNullVars = new Set<string>();
        for (const block of cfg.blocks) {
            for (const stmt of block.statements) {
                if (stmt.isNullGuard && !block.isTerminator()) {
                    for (const v of stmt.usedVars) {
                        guardedNullVars.add(v);
                    }
                }
                if (guardedNullVars.size > 0) {
                    for (const v of stmt.usedVars) {
                        if (guardedNullVars.has(v)) {
                            const derefPattern = new RegExp(`\\b${v}\\.[a-zA-Z0-9_$]+`);
                            if (derefPattern.test(stmt.rawText) && !stmt.isNullGuard) {
                                unguardedDereferences.push({
                                    line: stmt.line,
                                    variable: v,
                                    rawText: stmt.rawText,
                                });
                            }
                        }
                    }
                }
            }
        }

        // 3. Detect unclosed or unregistered resource handles escaping to exit
        for (const def of defs) {
            if (!def.isResource) continue;
            const hasCleanup = uses.some((u) => u.variable === def.variable && u.kind === 'cleanup');
            if (!hasCleanup) {
                unclosedResources.push({
                    variable: def.variable,
                    defLine: def.line,
                    exitBlockId: cfg.exit.id,
                    exitLine: cfg.exit.statements[0]?.line || def.line,
                });
            }
        }

        return {
            floatingPromises,
            unguardedDereferences,
            unclosedResources,
        };
    }
}
