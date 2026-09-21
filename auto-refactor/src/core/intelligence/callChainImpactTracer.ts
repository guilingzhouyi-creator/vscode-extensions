/**
 * Module: Core Engine - Call Chain Impact Tracer
 * File Path: src/core/intelligence/callChainImpactTracer.ts
 * Architecture Role: Reverse dependency and caller closure tracer that calculates cross-file
 *   blast radius and call chain propagation paths for modified symbols within an AST slice.
 * Dependencies & Triggers: Consumes CallGraph and SymbolIndex; consumed by sliceAuditService
 *   and multiAgentCoordinator.
 * Responsibilities: Perform bounded reverse caller traversal (default depth <= 3), detect
 *   uncontained breaking signature drifts, evaluate side-effect risk, and emit GOV-SLC-001 issues.
 * Exit Semantics & Design Rationale: Safe in-memory graph walk with cycle detection and depth
 *   budgets; guarantees deterministic ordering and never throws on missing index targets.
 */

import type { CallGraph, CallGraphEdge } from './callGraph';
import type { ASTSliceNode, CallChainHop, CallChainImpactResult } from '../router/sliceTypes';
import type { Issue } from '../types';
import { ANALYZER_GOVERNANCE } from '../scoring/dimensionLiterals';

/** Rule ID emitted when a breaking mutation leaks across external callers. */
export const RULE_GOV_SLICE_SIDE_EFFECT = 'GOV-SLC-001';

/**
 * Determine risk level based on breaking status and caller distribution.
 *
 * @param hasBreakingMutation - Whether the symbol experienced a signature change.
 * @param crossFileCallersCount - Number of callers in other files.
 * @param totalCallers - Total callers count.
 * @returns Categorized risk level.
 */
function evaluateRiskLevel(
    hasBreakingMutation: boolean,
    crossFileCallersCount: number,
    totalCallers: number,
): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (hasBreakingMutation && crossFileCallersCount > 0) {
        return 'CRITICAL';
    }
    if (hasBreakingMutation && totalCallers > 0) {
        return 'HIGH';
    }
    if (crossFileCallersCount > 5) {
        return 'MEDIUM';
    }
    return 'LOW';
}

/**
 * CallChainImpactTracer traverses reverse call graphs to assess mutation blast radius.
 */
export class CallChainImpactTracer {
    /**
     * Trace the caller propagation closure for a symbol up to maxDepth.
     *
     * @param targetSymbol - Name of symbol modified in slice.
     * @param targetFile - File where the symbol is defined.
     * @param hasBreakingMutation - Whether signature or contract changed breakably.
     * @param callGraph - In-memory CallGraph instance (if available).
     * @param maxDepth - Maximum reverse traversal hops (default: 3).
     * @returns Complete CallChainImpactResult.
     */
    public traceSymbolImpact(
        targetSymbol: string,
        targetFile: string,
        hasBreakingMutation: boolean,
        callGraph?: CallGraph,
        maxDepth = 3,
    ): CallChainImpactResult {
        const callChains: CallChainHop[] = [];
        const impactedFilesSet = new Set<string>();
        const visitedEdges = new Set<string>();
        const issues: Issue[] = [];

        if (callGraph) {
            let currentCallees = [targetSymbol];
            let currentDepth = 1;
            const visitedCallers = new Set<string>([targetSymbol]);
            const nextCalleesSet = new Set<string>();

            while (currentCallees.length > 0 && currentDepth <= maxDepth) {
                const nextCallees: string[] = [];
                nextCalleesSet.clear();

                for (const callee of currentCallees) {
                    const incomingEdges: CallGraphEdge[] = callGraph.callersOf(callee);

                    for (const edge of incomingEdges) {
                        const edgeKey = `${edge.callerFile}:${edge.caller || ''}:${edge.line || 0}:${callee}`;
                        if (visitedEdges.has(edgeKey)) continue;
                        visitedEdges.add(edgeKey);

                        const callerName = edge.caller || 'anonymous';
                        callChains.push({
                            file: edge.callerFile,
                            callerSymbol: callerName,
                            line: edge.line || 1,
                            depth: currentDepth,
                        });

                        if (edge.callerFile !== targetFile) {
                            impactedFilesSet.add(edge.callerFile);
                        }

                        if (
                            edge.caller &&
                            !visitedCallers.has(edge.caller) &&
                            !nextCalleesSet.has(edge.caller)
                        ) {
                            visitedCallers.add(edge.caller);
                            nextCalleesSet.add(edge.caller);
                            nextCallees.push(edge.caller);
                        }
                    }
                }

                currentCallees = nextCallees;
                currentDepth++;
            }
        }

        const impactedFiles = Array.from(impactedFilesSet).sort();
        const crossFileCallers = callChains.filter((c) => c.file !== targetFile);
        const riskLevel = evaluateRiskLevel(
            hasBreakingMutation,
            crossFileCallers.length,
            callChains.length,
        );

        if (hasBreakingMutation && crossFileCallers.length > 0) {
            issues.push({
                id: `issue:gov-slc-001:${targetFile}:${targetSymbol}`,
                rule: RULE_GOV_SLICE_SIDE_EFFECT,
                severity: 'error',
                analyzer: ANALYZER_GOVERNANCE,
                message:
                    `AST slice mutation in symbol '${targetSymbol}' introduces breaking signature drift ` +
                    `propagating across ${crossFileCallers.length} external call-sites in ${impactedFiles.length} files.`,
                location: {
                    file: targetFile,
                    start: { line: 1, column: 1 },
                    end: { line: 1, column: 1 },
                },
                detail: {
                    category: 'governance',
                    risk: 'critical',
                    rationale:
                        'AST slice breaking signature mutation without caller synchronization',
                    fixable: false,
                    targetLanguage: 'typescript',
                },
            });
        }

        return {
            targetSymbol,
            targetFile,
            hasBreakingMutation,
            totalImpactedCallers: callChains.length,
            impactedFiles,
            callChains,
            riskLevel,
            issues,
        };
    }

    /**
     * Trace impact directly from an ASTSliceNode.
     *
     * @param slice - Extracted AST slice node.
     * @param callGraph - In-memory CallGraph instance.
     * @param maxDepth - Maximum reverse traversal depth.
     * @returns CallChainImpactResult for the slice's primary symbol.
     */
    public traceSliceImpact(
        slice: ASTSliceNode,
        callGraph?: CallGraph,
        maxDepth = 3,
    ): CallChainImpactResult {
        return this.traceSymbolImpact(
            slice.symbolName,
            slice.filePath,
            slice.featureVector.hasSignatureMutation,
            callGraph,
            maxDepth,
        );
    }
}

/** Global default singleton instance of CallChainImpactTracer. */
export const defaultCallChainImpactTracer = new CallChainImpactTracer();
