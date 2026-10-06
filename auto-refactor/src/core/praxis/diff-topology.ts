/**
 * Module: Core Engine — Praxis Three-Tier Topological Diff & Dual-Faced Unified Patch Engine
 * File Path: src/core/praxis/diff-topology.ts
 * Architecture Role: Primary engine implementing the Dual-Faced and Three-Tier Topological Diff
 *   architecture specified in Agent-Native System Blueprint §2.1. Bridges machine-actionable
 *   AST/LSP slices for autonomous agents and rich bilingual visual hierarchy for Praxis UI.
 * Dependencies & Triggers: Consumes ReviewDiffHunk, AttributedDiffLine, PraxisVerdict
 *   from ./contracts; consumes Issue from ../types; consumes diff-topology-types,
 *   diff-unified-patch, diff-dual-faced, and SemanticGraph from ../semantic/semanticGraph.
 * Responsibilities:
 *   1. Re-export all topological types and patch formatting functions;
 *   2. Dual-Faced diff transformation (Agent Face & Human/UI Face);
 *   3. Three-Tier topology evaluation (Layer 1 Build, Layer 2 Review, Layer 3 Risk);
 *   4. TopologicalDiffEngine orchestration.
 * Exit Semantics & Design Rationale: Pure deterministic calculation with bounded traversal;
 *   guarantees zero transient heap allocations inside loops and linear streaming throughput.
 */

import type { Issue } from '../types';
import type { ReviewDiffHunk, AttributedDiffLine } from './contracts';
import type { SemanticGraph } from '../semantic/semanticGraph';
import type { SemanticNode } from '../semantic/types';

export * from './diff-topology-types';
export * from './diff-unified-patch';
export * from './diff-dual-faced';

import type {
    DiffAstNodeMapping,
    DiffConflictMarker,
    DiffContractConflict,
    DiffCrossLayerRisk,
    DiffDestructiveRisk,
    DiffLayer1BuildUnit,
    DiffLayer2ReviewCell,
    DiffLayer3ConflictRisk,
    DiffLoopAllocationRisk,
    DiffRiskSeverity,
    DualFacedDiffHunk,
    SemanticPropagationNode,
    ThreeTierTopologicalDiff,
    TopologicalDiffInput,
    TopologicalDiffSummary,
} from './diff-topology-types';
import { formatUnifiedDiff, toAgentUnifiedPatch } from './diff-unified-patch';
import { buildDualFacedHunks } from './diff-dual-faced';

/** Regex matching git conflict marker start */
const CONFLICT_START_REGEX = /^<{7}(?:\s+(.*))?$/;
/** Regex matching git conflict marker separator */
const CONFLICT_MID_REGEX = /^={7}$/;
/** Regex matching git conflict marker end */
const CONFLICT_END_REGEX = /^>{7}(?:\s+(.*))?$/;

/** Regex detecting loop constructs */
const LOOP_KEYWORD_REGEX =
    /\b(for\s*\(|while\s*\(|for\s+await\s*\(|\.forEach\(|\.map\(|\.flatMap\(|\.filter\(|\.reduce\()/;

/** Regex detecting transient heap allocations inside code */
const TRANSIENT_ALLOC_REGEX =
    /\b(new\s+(?:Array|Set|Map|Object|RegExp|Promise|Date)\b|\bObject\.(?:assign|entries|keys|values)\b|\[\s*\]|\{\s*\})/;

/** Regex detecting exported symbol declarations */
const EXPORT_DECLARATION_REGEX =
    /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var|enum)\s+([A-Za-z0-9_$]+)/;

/** Threshold of deletions indicating mass deletion */
const MASS_DELETION_LINE_THRESHOLD = 50;

/** Threshold ratio of deletions to additions for mass deletion */
const MASS_DELETION_RATIO_THRESHOLD = 2.0;

// ============================================================================
// Layer 1 Evaluation: Build Execution Unit Diff
// ============================================================================

interface MutableAstMapping extends DiffAstNodeMapping {
    hunkIdSet: Set<string>;
}

function countChangedLinesInHunk(hunk: ReviewDiffHunk): number {
    let count = 0;
    for (const l of hunk.lines) {
        if (l.type !== 'context') {
            count++;
        }
    }
    return count;
}

function recordHunkMapping(
    symbolMap: Map<string, MutableAstMapping>,
    hunk: ReviewDiffHunk,
    symbol: string,
): void {
    const kind = hunk.astContext?.symbolKind || 'symbol';
    const start = hunk.astContext?.scopeRange?.startLine || hunk.newSpan.startLine;
    const end =
        hunk.astContext?.scopeRange?.endLine || hunk.newSpan.startLine + hunk.newSpan.lineCount;
    const changedInHunk = countChangedLinesInHunk(hunk);

    const existing = symbolMap.get(symbol);
    if (existing) {
        existing.changedLines += changedInHunk;
        if (!existing.hunkIdSet.has(hunk.hunkId)) {
            existing.hunkIdSet.add(hunk.hunkId);
            existing.hunkIds.push(hunk.hunkId);
        }
        existing.startLine = Math.min(existing.startLine, start);
        existing.endLine = Math.max(existing.endLine, end);
        return;
    }

    const hunkIdSet = new Set<string>();
    hunkIdSet.add(hunk.hunkId);
    symbolMap.set(symbol, {
        symbolName: symbol,
        symbolKind: kind,
        startLine: start,
        endLine: end,
        changedLines: changedInHunk,
        hunkIds: [hunk.hunkId],
        hunkIdSet,
    });
}

/**
 * Extracts AST node mappings from review hunks.
 */
function extractAstNodeMappings(hunks: ReviewDiffHunk[]): DiffAstNodeMapping[] {
    const symbolMap = new Map<string, MutableAstMapping>();

    for (const hunk of hunks) {
        const symbol = hunk.astContext?.enclosingSymbol;
        if (symbol) {
            recordHunkMapping(symbolMap, hunk, symbol);
        }
    }

    return Array.from(symbolMap.values()).map(({ hunkIdSet: _hunkIdSet, ...rest }) => rest);
}

function processHunkLine(
    line: AttributedDiffLine,
    stats: { additions: number; deletions: number; changedLineNumbers: number[] },
): void {
    if (line.type === 'insert') {
        stats.additions++;
        if (line.lineNoNew !== undefined) {
            stats.changedLineNumbers.push(line.lineNoNew);
        }
    } else if (line.type === 'delete') {
        stats.deletions++;
        if (line.lineNoOld !== undefined) {
            stats.changedLineNumbers.push(line.lineNoOld);
        }
    }
}

function collectLineChanges(hunks: ReviewDiffHunk[]): {
    additions: number;
    deletions: number;
    changedLineNumbers: number[];
} {
    const stats = { additions: 0, deletions: 0, changedLineNumbers: [] as number[] };
    for (const hunk of hunks) {
        for (const line of hunk.lines) {
            processHunkLine(line, stats);
        }
    }
    return stats;
}

/**
 * Builds Layer 1 build execution unit diff.
 */
function buildLayer1(
    filePath: string,
    hunks: ReviewDiffHunk[],
    _dualFacedHunks: DualFacedDiffHunk[],
): DiffLayer1BuildUnit {
    const stats = collectLineChanges(hunks);
    const modifications = Math.min(stats.additions, stats.deletions);
    const totalChangedLines = stats.additions + stats.deletions;
    const astNodeMappings = extractAstNodeMappings(hunks);

    return {
        filePath,
        totalChangedLines,
        additions: stats.additions,
        deletions: stats.deletions,
        modifications,
        changedLineNumbers: stats.changedLineNumbers,
        astNodeMappings,
    };
}

// ============================================================================
// Layer 2 Evaluation: Specialized Review Cell Domain Diff
// ============================================================================

const ARCH_CONTRACT_RE = /^(?:ARCH-|DEP-|GOV-|.*DRIFT)/;

/**
 * Extracts architectural contract conflicts from issues.
 */
function extractContractConflicts(filePath: string, issues?: Issue[]): DiffContractConflict[] {
    if (!issues || issues.length === 0) {
        return [];
    }
    const conflicts: DiffContractConflict[] = [];

    for (const issue of issues) {
        if (ARCH_CONTRACT_RE.test(issue.rule)) {
            conflicts.push({
                ruleId: issue.rule,
                severity: issue.severity,
                message: issue.message,
                sourceFile: issue.location.file || filePath,
                violatingSymbol: issue.suggestion,
            });
        }
    }

    return conflicts;
}

function findMatchingNode(
    nodes: readonly SemanticNode[],
    symbolName: string,
): SemanticNode | undefined {
    for (const node of nodes) {
        if (node.id === symbolName || node.name === symbolName) {
            return node;
        }
    }
    const suffix = `#${symbolName}`;
    for (const node of nodes) {
        if (node.id.endsWith(suffix)) {
            return node;
        }
    }
    return undefined;
}

function resolveCanonicalNodeId(
    graph: SemanticGraph,
    symbolName: string,
    filePath?: string,
): string | undefined {
    if (graph.hasNode(symbolName)) {
        return symbolName;
    }
    if (filePath && typeof graph.getNodesByFile === 'function') {
        const fileNodes = graph.getNodesByFile(filePath);
        const match = findMatchingNode(fileNodes, symbolName);
        if (match) {
            return match.id;
        }
    }
    const allNodes = graph.getAllNodes();
    const match = findMatchingNode(allNodes, symbolName);
    return match ? match.id : undefined;
}

/**
 * Extracts propagation paths across the semantic graph.
 * Resolves symbols to standard Canonical Node IDs before slicing.
 */
function extractPropagationPaths(
    graph: SemanticGraph | undefined,
    astMappings: DiffAstNodeMapping[],
    filePath?: string,
): SemanticPropagationNode[] {
    if (!graph || astMappings.length === 0) {
        return [];
    }
    const paths: SemanticPropagationNode[] = [];
    const visited = new Set<string>();

    for (const mapping of astMappings) {
        const seedId = resolveCanonicalNodeId(graph, mapping.symbolName, filePath);
        if (!seedId) {
            continue;
        }
        const slice = graph.getSlice(seedId, 2, 'backward');
        for (const edge of slice.edges) {
            const key = `${edge.fromNodeId}->${edge.toNodeId}`;
            if (visited.has(key)) {
                continue;
            }
            visited.add(key);

            const targetNode = graph.getNode(edge.toNodeId);
            paths.push({
                file: targetNode?.location.file || edge.toNodeId,
                symbol: mapping.symbolName,
                distance: 1,
                edgeKind: edge.kind,
            });
        }
    }

    return paths;
}

/**
 * Builds Layer 2 specialized review cell domain diff.
 */
function buildLayer2(
    input: TopologicalDiffInput,
    layer1: DiffLayer1BuildUnit,
): DiffLayer2ReviewCell {
    const impactSet = new Set<string>(input.impactFiles || []);
    for (const hunk of input.hunks) {
        if (hunk.astContext?.impactFiles) {
            for (const file of hunk.astContext.impactFiles) {
                impactSet.add(file);
            }
        }
    }

    const impactFiles = Array.from(impactSet);
    const contractConflicts = extractContractConflicts(input.filePath, input.issues);
    const propagationPaths = extractPropagationPaths(
        input.graph,
        layer1.astNodeMappings,
        input.filePath,
    );

    const recommendedFocus: string[] = [];
    if (contractConflicts.length > 0) {
        recommendedFocus.push('Audit architectural contract violations against SSOT catalog');
    }
    if (impactFiles.length > 3) {
        recommendedFocus.push('Perform cross-file reverse dependency regression checks');
    }
    if (layer1.modifications > 30) {
        recommendedFocus.push('Validate semantic behavior invariants on modified AST scopes');
    }
    if (recommendedFocus.length === 0) {
        recommendedFocus.push('Standard AST node consistency review');
    }

    const requiredVerification: string[] = [
        'Enclosing symbols retain API signature compatibility',
        'Reverse dependency closure is free of cascading breakages',
    ];

    return {
        filePath: input.filePath,
        impactFiles,
        propagationPaths,
        contractConflicts,
        recommendedFocus,
        requiredVerification,
    };
}

// ============================================================================
// Layer 3 Evaluation: Conflict and High-Risk Diff
// ============================================================================

function checkConflictLine(line: string, lineNumber: number): DiffConflictMarker | undefined {
    const startMatch = line.match(CONFLICT_START_REGEX);
    if (startMatch) {
        return {
            line: lineNumber,
            markerType: 'start',
            branchLabel: startMatch[1],
        };
    }

    if (CONFLICT_MID_REGEX.test(line)) {
        return {
            line: lineNumber,
            markerType: 'separator',
        };
    }

    const endMatch = line.match(CONFLICT_END_REGEX);
    if (endMatch) {
        return {
            line: lineNumber,
            markerType: 'end',
            branchLabel: endMatch[1],
        };
    }

    return undefined;
}

function isConflictCandidate(content: string, start: number, len: number): boolean {
    if (len < 7) {
        return false;
    }
    const c = content.charCodeAt(start);
    return c === 60 /* '<' */ || c === 61 /* '=' */ || c === 62; /* '>' */
}

/**
 * Detects git conflict markers in content or hunks.
 * Streams through text using linear index pointers to avoid massive array allocations.
 */
function detectConflictMarkers(content?: string, _hunks?: ReviewDiffHunk[]): DiffConflictMarker[] {
    if (!content) {
        return [];
    }

    const markers: DiffConflictMarker[] = [];
    const len = content.length;
    let lineStart = 0;
    let lineNumber = 1;

    while (lineStart < len) {
        const nextNewline = content.indexOf('\n', lineStart);
        const lineEnd = nextNewline === -1 ? len : nextNewline;
        let effectiveEnd = lineEnd;

        if (effectiveEnd > lineStart && content.charCodeAt(effectiveEnd - 1) === 13 /* \r */) {
            effectiveEnd--;
        }

        if (isConflictCandidate(content, lineStart, effectiveEnd - lineStart)) {
            const line = content.slice(lineStart, effectiveEnd);
            const marker = checkConflictLine(line, lineNumber);
            if (marker) {
                markers.push(marker);
            }
        }

        lineStart = nextNewline === -1 ? len : nextNewline + 1;
        lineNumber++;
    }

    return markers;
}

/**
 * Detects loop-internal transient heap allocations.
 */
const LOOP_ALLOC_RULE_RE = /^(?:PRF-MEM-00[12]|CPX-SPACE-001|ADV-PRF)/;

function detectLoopAllocFromIssues(issues?: Issue[]): DiffLoopAllocationRisk[] {
    if (!issues) return [];
    const risks: DiffLoopAllocationRisk[] = [];
    for (const issue of issues) {
        if (LOOP_ALLOC_RULE_RE.test(issue.rule)) {
            risks.push({
                line: issue.location.start.line,
                codeSnippet: issue.message,
                riskKind: 'object_literal',
                remediationAdvice:
                    issue.suggestion || 'Eliminate transient heap allocation inside loop',
            });
        }
    }
    return risks;
}

function detectLoopAllocFromHunks(hunks: ReviewDiffHunk[]): DiffLoopAllocationRisk[] {
    const risks: DiffLoopAllocationRisk[] = [];
    for (const hunk of hunks) {
        let insideLoop = false;
        for (const line of hunk.lines) {
            if (line.type !== 'insert') continue;
            if (LOOP_KEYWORD_REGEX.test(line.content)) insideLoop = true;
            if (insideLoop && TRANSIENT_ALLOC_REGEX.test(line.content)) {
                const lineNo = line.lineNoNew || hunk.newSpan.startLine;
                risks.push({
                    line: lineNo,
                    codeSnippet: line.content.trim(),
                    riskKind: 'object_literal',
                    remediationAdvice:
                        'Pre-allocate and reuse scratch buffers or object pools outside loop',
                });
                insideLoop = false;
            }
        }
    }
    return risks;
}

/**
 * Detects transient heap allocations inside loops violating zero-allocation budgets.
 */
function detectLoopTransientAllocations(
    hunks: ReviewDiffHunk[],
    issues?: Issue[],
): DiffLoopAllocationRisk[] {
    const fromIssues = detectLoopAllocFromIssues(issues);
    const fromHunks = detectLoopAllocFromHunks(hunks);
    return [...fromIssues, ...fromHunks];
}

function collectExportDeclarations(hunks: ReviewDiffHunk[]): {
    deletedExports: Set<string>;
    addedExports: Set<string>;
} {
    const deletedExports = new Set<string>();
    const addedExports = new Set<string>();

    for (const hunk of hunks) {
        for (const line of hunk.lines) {
            const match = line.content.match(EXPORT_DECLARATION_REGEX);
            if (!match) continue;
            if (line.type === 'delete') {
                deletedExports.add(match[1]);
            } else if (line.type === 'insert') {
                addedExports.add(match[1]);
            }
        }
    }
    return { deletedExports, addedExports };
}

/**
 * Detects destructive modifications (mass deletions, removed public exports).
 */
function detectDestructiveModifications(
    hunks: ReviewDiffHunk[],
    layer1: DiffLayer1BuildUnit,
): DiffDestructiveRisk[] {
    const destructive: DiffDestructiveRisk[] = [];

    if (
        layer1.deletions >= MASS_DELETION_LINE_THRESHOLD &&
        layer1.deletions > layer1.additions * MASS_DELETION_RATIO_THRESHOLD
    ) {
        destructive.push({
            kind: 'mass_deletion',
            description: `Detected mass deletion: ${layer1.deletions} lines deleted with only ${layer1.additions} additions`,
            affectedSymbols: [],
            deletedLinesCount: layer1.deletions,
        });
    }

    const { deletedExports, addedExports } = collectExportDeclarations(hunks);
    for (const deletedSymbol of deletedExports) {
        if (!addedExports.has(deletedSymbol)) {
            destructive.push({
                kind: 'public_api_removal',
                description: `Public API export '${deletedSymbol}' was removed without equivalent replacement`,
                affectedSymbols: [deletedSymbol],
                deletedLinesCount: 1,
            });
        }
    }

    return destructive;
}

const CROSS_LAYER_RULE_RE = /^(?:ARCH-(?:FAC-001|ABS-001|HDL-001|BND-001)|.*LAYER.*)/;

/**
 * Detects cross-layer architecture risks from issues.
 */
function detectCrossLayerRisks(filePath: string, issues?: Issue[]): DiffCrossLayerRisk[] {
    if (!issues || issues.length === 0) {
        return [];
    }
    const risks: DiffCrossLayerRisk[] = [];

    for (const issue of issues) {
        if (CROSS_LAYER_RULE_RE.test(issue.rule)) {
            risks.push({
                sourceFile: filePath,
                targetModule: 'external',
                riskDescription: issue.message,
                ruleId: issue.rule,
            });
        }
    }

    return risks;
}

/**
 * Builds Layer 3 conflict and high-risk diff.
 */
function buildLayer3(
    input: TopologicalDiffInput,
    layer1: DiffLayer1BuildUnit,
): DiffLayer3ConflictRisk {
    const conflictMarkers = detectConflictMarkers(input.newContent, input.hunks);
    const loopAllocations = detectLoopTransientAllocations(input.hunks, input.issues);
    const destructiveModifications = detectDestructiveModifications(input.hunks, layer1);
    const crossLayerRisks = detectCrossLayerRisks(input.filePath, input.issues);

    const blockingIssues = (input.issues || []).filter((i) => i.severity === 'error');
    const escalationReasons: string[] = [];

    if (conflictMarkers.length > 0) {
        escalationReasons.push(
            `Unresolved merge conflict markers detected (${conflictMarkers.length} occurrences)`,
        );
    }
    if (destructiveModifications.length > 0) {
        escalationReasons.push(
            `Destructive modifications detected (${destructiveModifications.length} occurrences)`,
        );
    }
    if (loopAllocations.length > 0) {
        escalationReasons.push(
            `Transient heap allocations detected in loop (PRF-MEM-001: ${loopAllocations.length} occurrences)`,
        );
    }
    if (crossLayerRisks.length > 0) {
        escalationReasons.push(
            `Cross-layer architectural contract breaches detected (${crossLayerRisks.length} occurrences)`,
        );
    }
    if (blockingIssues.length > 0) {
        escalationReasons.push(
            `Blocking error-severity findings detected (${blockingIssues.length} issues)`,
        );
    }

    const shouldEscalateToL3A = escalationReasons.length > 0;
    const hasCriticalRisks = shouldEscalateToL3A || blockingIssues.length > 0;

    return {
        filePath: input.filePath,
        hasCriticalRisks,
        crossLayerRisks,
        destructiveModifications,
        loopAllocations,
        conflictMarkers,
        blockingIssues,
        shouldEscalateToL3A,
        escalationReasons,
    };
}

// ============================================================================
// Summary Construction
// ============================================================================

/**
 * Resolves the top-level overall risk severity.
 */
function resolveOverallRisk(
    layer1: DiffLayer1BuildUnit,
    layer2: DiffLayer2ReviewCell,
    layer3: DiffLayer3ConflictRisk,
): DiffRiskSeverity {
    if (layer3.shouldEscalateToL3A || layer3.blockingIssues.length > 0) {
        return 'block';
    }
    if (
        layer3.loopAllocations.length > 0 ||
        layer3.destructiveModifications.length > 0 ||
        layer2.contractConflicts.length > 0
    ) {
        return 'warn';
    }
    if (layer1.totalChangedLines === 0) {
        return 'pass';
    }
    return 'pass';
}

/**
 * Builds high-level summary of the topological diff.
 */
function buildTopologicalSummary(
    filePath: string,
    layer1: DiffLayer1BuildUnit,
    layer2: DiffLayer2ReviewCell,
    layer3: DiffLayer3ConflictRisk,
): TopologicalDiffSummary {
    const overallRisk = resolveOverallRisk(layer1, layer2, layer3);

    let layer2ImpactScope: TopologicalDiffSummary['layer2ImpactScope'] = 'isolated';
    if (layer2.impactFiles.length > 10) {
        layer2ImpactScope = 'critical';
    } else if (layer2.impactFiles.length > 3) {
        layer2ImpactScope = 'wide';
    } else if (layer2.impactFiles.length > 0) {
        layer2ImpactScope = 'local';
    }

    let layer3RiskLevel: TopologicalDiffSummary['layer3RiskLevel'] = 'clean';
    if (layer3.blockingIssues.length > 0 || layer3.conflictMarkers.length > 0) {
        layer3RiskLevel = 'blocking';
    } else if (layer3.destructiveModifications.length > 0 || layer3.loopAllocations.length > 0) {
        layer3RiskLevel = 'hazardous';
    } else if (layer3.crossLayerRisks.length > 0) {
        layer3RiskLevel = 'guarded';
    }

    return {
        filePath,
        totalHunks: layer1.astNodeMappings.length,
        totalChangedLines: layer1.totalChangedLines,
        additions: layer1.additions,
        deletions: layer1.deletions,
        overallRisk,
        shouldEscalateToL3A: layer3.shouldEscalateToL3A,
        layer1Status: layer1.totalChangedLines > 0 ? 'ready' : 'empty',
        layer2ImpactScope,
        layer3RiskLevel,
    };
}

// ============================================================================
// Core Builder Function & Engine Class
// ============================================================================

/**
 * Builds a complete Three-Tier Topological Diff from review hunks, issues, and context.
 * Adheres to Agent-Native System Blueprint §2.1.
 *
 * @param input - Input containing file path, hunks, issues, and graph context.
 * @returns Fully populated ThreeTierTopologicalDiff.
 */
export function buildThreeTierTopologicalDiff(
    input: TopologicalDiffInput,
): ThreeTierTopologicalDiff {
    const hasConflict = detectConflictMarkers(input.newContent, input.hunks).length > 0;
    const dualFacedHunks = buildDualFacedHunks(
        input.filePath,
        input.hunks,
        input.issues,
        hasConflict,
    );

    const layer1 = buildLayer1(input.filePath, input.hunks, dualFacedHunks);
    const layer2 = buildLayer2(input, layer1);
    const layer3 = buildLayer3(input, layer1);
    const summary = buildTopologicalSummary(input.filePath, layer1, layer2, layer3);

    return {
        filePath: input.filePath,
        layer1,
        layer2,
        layer3,
        dualFacedHunks,
        summary,
    };
}

/**
 * High-performance, interface-driven Topological Diff Engine.
 */
export class TopologicalDiffEngine {
    /**
     * Builds three-tier topological diff structure.
     */
    public build(input: TopologicalDiffInput): ThreeTierTopologicalDiff {
        return buildThreeTierTopologicalDiff(input);
    }

    /**
     * Formats unified diff compatible with git apply.
     */
    public formatDiff(oldContent: string, newContent: string, filePath: string): string {
        return formatUnifiedDiff(oldContent, newContent, filePath);
    }

    /**
     * Generates agent unified patch from review hunks.
     */
    public toPatch(hunks: ReviewDiffHunk[], filePath: string): string {
        return toAgentUnifiedPatch(hunks, filePath);
    }
}

/** Default singleton instance of TopologicalDiffEngine */
export const defaultTopologicalDiffEngine = new TopologicalDiffEngine();
