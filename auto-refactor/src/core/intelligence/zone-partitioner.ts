/**
 * Module: Core Engine — Intra-File Semantic Zone Partitioner
 * File Path: src/core/intelligence/zone-partitioner.ts
 * Architecture Role: Language-agnostic structural decomposition engine detecting functional
 *   zones within ultra-large single source files (dense compute kernels vs interface gateways).
 * Dependencies & Triggers: Consumes NormalizedNode and CodeDensityMetrics; invoked by
 *   LargeFileAnalyzer and elastic budget validators on large/dense files.
 * Responsibilities:
 *   1. Segment files into 4 canonical zones (Kernel, Gateway, Table, State);
 *   2. Compute zone distribution, boundary line spans, and topological Entanglement Index (EI);
 *   3. Qualify well-decoupled multi-thousand/tens-of-thousands LOC files for safe admission.
 * Exit Semantics & Design Rationale: Never throws; single-pass O(N) evaluation with sub-millisecond
 *   overhead per file.
 */

import type { NormalizedNode } from '../ast/multilang';
import { NodeKind } from '../ast/multilang';
import type { CodeDensityMetrics } from './code-density-analyzer';

/** Canonical semantic zone classification kinds. */
export type SemanticZoneType =
    'ZONE_COMPUTE_KERNEL' | 'ZONE_INTERFACE_GATEWAY' | 'ZONE_LOOKUP_TABLE' | 'ZONE_STATE_LIFECYCLE';

/** High-density algorithm and mathematical computation kernel zone. */
export const ZONE_COMPUTE_KERNEL: SemanticZoneType = 'ZONE_COMPUTE_KERNEL';

/** Public facade, RPC interface, and event subscription gateway zone. */
export const ZONE_INTERFACE_GATEWAY: SemanticZoneType = 'ZONE_INTERFACE_GATEWAY';

/** Static table, enum mapping, and dictionary configuration lookup zone. */
export const ZONE_LOOKUP_TABLE: SemanticZoneType = 'ZONE_LOOKUP_TABLE';

/** Runtime state initialization, teardown, and lifecycle handler zone. */
export const ZONE_STATE_LIFECYCLE: SemanticZoneType = 'ZONE_STATE_LIFECYCLE';

/** Contiguous semantic zone slice within a single file. */
export interface SemanticZoneSegment {
    readonly zone: SemanticZoneType;
    readonly startLine: number;
    readonly endLine: number;
    readonly lineCount: number;
    readonly declarationsCount: number;
    readonly summary: string;
}

/** Comprehensive intra-file zone partitioning profile. */
export interface IntraFileZoneProfile {
    readonly filePath: string;
    readonly totalLines: number;
    readonly effectiveLoc: number;
    readonly segments: SemanticZoneSegment[];
    readonly distribution: Record<SemanticZoneType, number>;
    readonly entanglementIndex: number;
    readonly isDecoupled: boolean;
    readonly rationale: string;
}

/** Pattern heuristics for interface and gateway markers. */
const GATEWAY_PATTERN =
    /(?:api|handle|route|call|invoke|gateway|export|dispatch|facade|#[napi]|extern\s+"C")/i;

/** Pattern heuristics for state and lifecycle management. */
const STATE_PATTERN =
    /(?:state|pool|context|session|manager|mutex|lock|buffer|init|dispose|drop|constructor)/i;

/** Pattern heuristics for static data and lookup tables. */
const TABLE_PATTERN = /(?:table|matrix|lookup|dict|mapping|mask|constants|registry|catalog)/i;

/**
 * Classifies an individual normalized AST declaration node into a candidate semantic zone.
 */
function classifyNodeZone(node: NormalizedNode): SemanticZoneType {
    const name = (node.name || '').toLowerCase();

    // 1. Data and lookup tables: constants or variables with high literal density
    if (node.kind === NodeKind.Constant || node.kind === NodeKind.Field) {
        if (TABLE_PATTERN.test(name)) {
            return ZONE_LOOKUP_TABLE;
        }
    }

    // 2. State & Lifecycle: classes, structs, impl blocks, or stateful coordinators
    if (
        node.kind === NodeKind.Class ||
        node.kind === NodeKind.Struct ||
        node.kind === NodeKind.Impl
    ) {
        return ZONE_STATE_LIFECYCLE;
    }
    if (STATE_PATTERN.test(name)) {
        return ZONE_STATE_LIFECYCLE;
    }

    // 3. Interface Gateway: explicitly exported or matching gateway naming patterns
    if (node.exported || GATEWAY_PATTERN.test(name)) {
        return ZONE_INTERFACE_GATEWAY;
    }

    // 4. Default: pure compute kernel / algorithmic implementation
    return ZONE_COMPUTE_KERNEL;
}

/**
 * Fallback line-level scanner when full AST traversal is unavailable or truncated.
 */
function partitionByTextHeuristics(
    content: string,
    filePath: string,
    totalLines: number,
    effectiveLoc: number,
): IntraFileZoneProfile {
    const lines = content.split(/\r\n|\n/);
    const rawSegments: Array<{ zone: SemanticZoneType; line: number }> = [];

    let currentZone: SemanticZoneType = ZONE_COMPUTE_KERNEL;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('//') || line.startsWith('#') || line.startsWith('/*')) {
            continue;
        }

        if (
            line.includes('function') ||
            line.includes('fn ') ||
            line.includes('def ') ||
            line.includes('export')
        ) {
            if (GATEWAY_PATTERN.test(line) || line.includes('export')) {
                currentZone = ZONE_INTERFACE_GATEWAY;
            } else {
                currentZone = ZONE_COMPUTE_KERNEL;
            }
        } else if (
            STATE_PATTERN.test(line) &&
            (line.includes('class') || line.includes('struct') || line.includes('impl'))
        ) {
            currentZone = ZONE_STATE_LIFECYCLE;
        } else if (
            TABLE_PATTERN.test(line) &&
            (line.includes('const') || line.includes('let') || line.includes('='))
        ) {
            currentZone = ZONE_LOOKUP_TABLE;
        }

        rawSegments.push({ zone: currentZone, line: i + 1 });
    }

    return coalesceSegments(rawSegments, filePath, totalLines, effectiveLoc);
}

/**
 * Coalesces consecutive line/node classifications into structured zone segments.
 */
function coalesceSegments(
    items: Array<{ zone: SemanticZoneType; line: number }>,
    filePath: string,
    totalLines: number,
    effectiveLoc: number,
): IntraFileZoneProfile {
    if (items.length === 0) {
        return {
            filePath,
            totalLines,
            effectiveLoc,
            segments: [],
            distribution: {
                ZONE_COMPUTE_KERNEL: 1.0,
                ZONE_INTERFACE_GATEWAY: 0.0,
                ZONE_LOOKUP_TABLE: 0.0,
                ZONE_STATE_LIFECYCLE: 0.0,
            },
            entanglementIndex: 0.0,
            isDecoupled: true,
            rationale: 'Empty or uniform source structure',
        };
    }

    const segments: SemanticZoneSegment[] = [];
    let curZone = items[0].zone;
    let startLine = items[0].line;
    let endLine = items[0].line;
    let declCount = 1;

    for (let i = 1; i < items.length; i++) {
        const it = items[i];
        if (it.zone === curZone) {
            endLine = it.line;
            declCount++;
        } else {
            segments.push({
                zone: curZone,
                startLine,
                endLine,
                lineCount: Math.max(1, endLine - startLine + 1),
                declarationsCount: declCount,
                summary: `${curZone}: lines ${startLine}-${endLine}`,
            });
            curZone = it.zone;
            startLine = it.line;
            endLine = it.line;
            declCount = 1;
        }
    }

    segments.push({
        zone: curZone,
        startLine,
        endLine,
        lineCount: Math.max(1, endLine - startLine + 1),
        declarationsCount: declCount,
        summary: `${curZone}: lines ${startLine}-${endLine}`,
    });

    // Compute distribution ratios
    const zoneCounts: Record<SemanticZoneType, number> = {
        ZONE_COMPUTE_KERNEL: 0,
        ZONE_INTERFACE_GATEWAY: 0,
        ZONE_LOOKUP_TABLE: 0,
        ZONE_STATE_LIFECYCLE: 0,
    };

    let totalSegmentLines = 0;
    for (const seg of segments) {
        zoneCounts[seg.zone] += seg.lineCount;
        totalSegmentLines += seg.lineCount;
    }

    const denom = totalSegmentLines > 0 ? totalSegmentLines : 1;
    const distribution: Record<SemanticZoneType, number> = {
        ZONE_COMPUTE_KERNEL: +(zoneCounts.ZONE_COMPUTE_KERNEL / denom).toFixed(3),
        ZONE_INTERFACE_GATEWAY: +(zoneCounts.ZONE_INTERFACE_GATEWAY / denom).toFixed(3),
        ZONE_LOOKUP_TABLE: +(zoneCounts.ZONE_LOOKUP_TABLE / denom).toFixed(3),
        ZONE_STATE_LIFECYCLE: +(zoneCounts.ZONE_STATE_LIFECYCLE / denom).toFixed(3),
    };

    // Entanglement Index (EI): ratio of zone transitions over total segments
    // Clean file: few contiguous blocks (EI <= 0.15); interleaved: flips constantly (EI > 0.3)
    const transitions = Math.max(0, segments.length - 1);
    const entanglementIndex = +(transitions / Math.max(1, items.length)).toFixed(4);
    const isDecoupled = entanglementIndex <= 0.25;

    const rationale = isDecoupled
        ? `Clean intra-file semantic separation (EI: ${entanglementIndex}, ${segments.length} contiguous zones)`
        : `High intra-file entanglement (EI: ${entanglementIndex}, ${segments.length} fragmented transitions between compute and gateway)`;

    return {
        filePath,
        totalLines,
        effectiveLoc,
        segments,
        distribution,
        entanglementIndex,
        isDecoupled,
        rationale,
    };
}

/**
 * Partitions a single source file into structured semantic zones.
 *
 * @param content - Source file raw text content
 * @param filePath - Path to source file
 * @param density - Code density metrics
 * @param astRoot - Optional normalized AST root
 * @returns Intra-file semantic zone profile
 */
export function partitionFileZones(
    content: string,
    filePath: string,
    density: CodeDensityMetrics,
    astRoot?: NormalizedNode,
): IntraFileZoneProfile {
    const totalLines = density.physicalLines;
    const effectiveLoc = density.effectiveCodeLines;

    if (!astRoot || !Array.isArray(astRoot.children) || astRoot.children.length === 0) {
        return partitionByTextHeuristics(content, filePath, totalLines, effectiveLoc);
    }

    const items: Array<{ zone: SemanticZoneType; line: number }> = [];

    for (const child of astRoot.children) {
        if (
            child.topLevel ||
            child.functionLike ||
            child.kind === NodeKind.Class ||
            child.kind === NodeKind.Struct ||
            child.kind === NodeKind.Impl
        ) {
            const zone = classifyNodeZone(child);
            const line = child.start?.line ?? 1;
            items.push({ zone, line });
        }
    }

    if (items.length === 0) {
        return partitionByTextHeuristics(content, filePath, totalLines, effectiveLoc);
    }

    return coalesceSegments(items, filePath, totalLines, effectiveLoc);
}
