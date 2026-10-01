/**
 * Module: Core Engine — Structured Resource Topology & Scale-Adaptive Analyzer
 * File Path: src/core/architecture/structured-resource-topology.ts
 * Architecture Role: Evaluates naming hierarchy, dynamic scale thresholds, semantic volume,
 *   caller inverted index, multi-modal cohesion, Tarjan SCC cycle decomposition, and tripartite risk.
 * Exit Semantics & Design Rationale: Pure architectural analysis engine. Cyclomatic complexity
 *   is strictly bounded (CC <= 10 per function) with full mathematical invariances.
 */

export interface StructuredResourceNamingParts {
    readonly baseType: string;
    readonly domain: string | null;
    readonly subdomain: string | null;
    readonly extraParts: readonly string[];
    readonly depth: number;
    readonly isOverDescriptive: boolean;
    readonly rawBaseName: string;
}

export interface SemanticVolumeWeights {
    readonly we: number;
    readonly wa: number;
    readonly ws: number;
    readonly wl: number;
    readonly wd: number;
}

export const DEFAULT_SV_WEIGHTS: SemanticVolumeWeights = {
    we: 0.25,
    wa: 0.3,
    ws: 0.2,
    wl: 0.15,
    wd: 0.1,
};

export interface CohesionWeights {
    readonly wn: number;
    readonly wt: number;
    readonly wc: number;
    readonly wd: number;
    readonly wh: number;
}

export const DEFAULT_COHESION_WEIGHTS: CohesionWeights = {
    wn: 0.1,
    wt: 0.25,
    wc: 0.3,
    wd: 0.25,
    wh: 0.1,
};

export const RECOGNIZED_RESOURCE_BASE_TYPES: ReadonlySet<string> = new Set([
    'constants',
    'strings',
    'rules',
    'config',
    'enums',
    'errors',
    'messages',
    'tokens',
    'routes',
    'schemas',
]);

/**
 * Parses file basename into 3-tier structured resource topology.
 */
export function parseStructuredResourceNaming(fileName: string): StructuredResourceNamingParts {
    const rawName = fileName.split(/[/\\]/).pop() || fileName;
    const baseName = rawName.replace(/\.[^/.]+$/, '');
    const tokens = baseName.split(/[_-]/).filter(Boolean);

    if (tokens.length === 0) {
        return {
            baseType: '',
            domain: null,
            subdomain: null,
            extraParts: [],
            depth: 0,
            isOverDescriptive: false,
            rawBaseName: baseName,
        };
    }

    const firstLower = tokens[0].toLowerCase();
    const isRecognized = RECOGNIZED_RESOURCE_BASE_TYPES.has(firstLower);
    const baseType = isRecognized ? firstLower : tokens[0];
    const domain = tokens.length > 1 ? tokens[1] : null;
    const subdomain = tokens.length > 2 ? tokens[2] : null;
    const extraParts = tokens.length > 3 ? tokens.slice(3) : [];
    const depth = isRecognized ? Math.min(tokens.length, 3) : 1;
    const isOverDescriptive = tokens.length > 3 || baseName.length > 45;

    return {
        baseType,
        domain,
        subdomain,
        extraParts,
        depth,
        isOverDescriptive,
        rawBaseName: baseName,
    };
}

/**
 * Snapshot-conditioned core ELOC baseline calculation.
 * Invariant: d(ELOC_core) / d(ELOC(r)) | R_t == 0
 */
export function calculateSnapshotCoreELOC(
    allFiles: readonly {
        readonly path: string;
        readonly eloc: number;
        readonly isResource: boolean;
    }[],
    frozenResourcePaths: ReadonlySet<string>,
): number {
    let coreSum = 0;
    for (const file of allFiles) {
        if (!frozenResourcePaths.has(file.path) && !file.isResource) {
            coreSum += file.eloc;
        }
    }
    return Math.max(1, coreSum);
}

/**
 * Calculates dynamic omnibus capacity threshold.
 */
export function calculateOmnibusCapacityThreshold(
    language: string,
    coreELOC: number,
    densityPrior: number = 1.0,
): number {
    const effectiveDensity = Math.max(0.5, densityPrior);
    const scaleFactor = Math.log10(Math.max(10, coreELOC));
    const baseCapacity = 120 * effectiveDensity * scaleFactor;
    return Math.max(60, Math.round(baseCapacity));
}

/**
 * Calculates Semantic Volume (SV) against line-packing/minification evasion.
 */
export function calculateSemanticVolume(
    eloc: number,
    astNodeCount: number,
    symbolCount: number,
    literalCount: number,
    astDepth: number,
    weights: SemanticVolumeWeights = DEFAULT_SV_WEIGHTS,
): number {
    const rawSV =
        weights.we * eloc +
        weights.wa * astNodeCount +
        weights.ws * symbolCount +
        weights.wl * literalCount +
        weights.wd * astDepth;
    return Math.round(rawSV * 100) / 100;
}

/**
 * Inverted caller index builder and sparse candidate graph generator.
 * Time Complexity: O(|E_s|) where |E_s| = sum(|I(c)|^2) << |S|^2.
 */
export function buildSparseCallerGraph(
    callerImports: readonly {
        readonly callerPath: string;
        readonly importedSymbols: readonly string[];
    }[],
): {
    readonly invertedIndex: ReadonlyMap<string, readonly string[]>;
    readonly sparseEdges: readonly [string, string, number][];
} {
    const inverted = new Map<string, string[]>();
    for (const entry of callerImports) {
        for (const sym of entry.importedSymbols) {
            const list = inverted.get(sym) ?? [];
            list.push(entry.callerPath);
            inverted.set(sym, list);
        }
    }

    const coOccurrence = new Map<string, number>();
    for (const entry of callerImports) {
        const syms = entry.importedSymbols;
        const len = syms.length;
        for (let i = 0; i < len; i++) {
            for (let j = i + 1; j < len; j++) {
                const u = syms[i] < syms[j] ? syms[i] : syms[j];
                const v = syms[i] < syms[j] ? syms[j] : syms[i];
                const key = `${u}::${v}`;
                coOccurrence.set(key, (coOccurrence.get(key) ?? 0) + 1);
            }
        }
    }

    const sparseEdges: [string, string, number][] = [];
    for (const [key, weight] of coOccurrence.entries()) {
        const [u, v] = key.split('::');
        sparseEdges.push([u, v, weight]);
    }

    return { invertedIndex: inverted, sparseEdges };
}

/**
 * Multi-modal semantic cohesion calculator.
 */
export function calculateMultiModalCohesion(
    nameJaccard: number,
    typeAffinity: number,
    callerOverlap: number,
    domainPurity: number,
    historyCovariance: number,
    weights: CohesionWeights = DEFAULT_COHESION_WEIGHTS,
): number {
    const score =
        weights.wn * Math.max(0, Math.min(1, nameJaccard)) +
        weights.wt * Math.max(0, Math.min(1, typeAffinity)) +
        weights.wc * Math.max(0, Math.min(1, callerOverlap)) +
        weights.wd * Math.max(0, Math.min(1, domainPurity)) +
        weights.wh * Math.max(0, Math.min(1, historyCovariance));
    return Math.round(score * 1000) / 1000;
}

export type SccResolutionStrategy =
    | 'TYPE_SINKING'
    | 'INTERFACE_INVERSION'
    | 'DEPENDENCY_INJECTION'
    | 'EVENT_DECOUPLING'
    | 'REGISTRY_EXTRACTION'
    | 'RE_MERGING';

export interface SccCycleDiagnosis {
    readonly stronglyConnectedComponents: readonly (readonly string[])[];
    readonly cyclicComponents: readonly {
        readonly nodes: readonly string[];
        readonly strategy: SccResolutionStrategy;
        readonly rationale: string;
    }[];
}

/**
 * Tarjan SCC cycle decomposition on sub-library dependency graph.
 */
export function diagnoseSccDependencyCycles(
    adjList: ReadonlyMap<string, readonly string[]>,
    nodeTypes?: ReadonlyMap<
        string,
        'pure-type' | 'high-layer' | 'runtime-instance' | 'event' | 'strategy' | 'small-leaf'
    >,
): SccCycleDiagnosis {
    let index = 0;
    const indices = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];

    function strongConnect(v: string): void {
        indices.set(v, index);
        lowlink.set(v, index);
        index++;
        stack.push(v);
        onStack.add(v);

        const neighbors = adjList.get(v) ?? [];
        for (const w of neighbors) {
            if (!indices.has(w)) {
                strongConnect(w);
                lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
            } else if (onStack.has(w)) {
                lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
            }
        }

        if (lowlink.get(v) === indices.get(v)) {
            const component: string[] = [];
            let w: string;
            do {
                w = stack.pop()!;
                onStack.delete(w);
                component.push(w);
            } while (w !== v);
            sccs.push(component);
        }
    }

    for (const node of adjList.keys()) {
        if (!indices.has(node)) {
            strongConnect(node);
        }
    }

    const cyclicComponents = sccs
        .filter((comp) => comp.length > 1)
        .map((nodes) => {
            const types = nodes.map((n) => nodeTypes?.get(n) ?? 'pure-type');
            let strategy: SccResolutionStrategy = 'TYPE_SINKING';
            let rationale = 'Extract common types into base type definition file';

            if (types.every((t) => t === 'pure-type')) {
                strategy = 'TYPE_SINKING';
                rationale = 'Extract common interfaces/types into types-base module';
            } else if (types.includes('high-layer')) {
                strategy = 'INTERFACE_INVERSION';
                rationale = 'Apply Dependency Inversion Principle (DIP) to decouple layers';
            } else if (types.includes('runtime-instance')) {
                strategy = 'DEPENDENCY_INJECTION';
                rationale = 'Pass instances via dependency injection rather than direct imports';
            } else if (types.includes('event')) {
                strategy = 'EVENT_DECOUPLING';
                rationale = 'Decouple state changes using event emitter pub/sub';
            } else if (types.includes('strategy')) {
                strategy = 'REGISTRY_EXTRACTION';
                rationale = 'Extract dynamic strategies into centralized registry';
            } else if (types.every((t) => t === 'small-leaf')) {
                strategy = 'RE_MERGING';
                rationale = 'Micro sub-libraries are highly cohesive; re-merge into parent domain';
            }

            return { nodes, strategy, rationale };
        });

    return {
        stronglyConnectedComponents: sccs,
        cyclicComponents,
    };
}

/**
 * Bayesian prior update for language density coefficient.
 */
export function updateLanguageDensityPrior(
    prior: number,
    sampleDensity: number,
    learningRate: number = 0.1,
): number {
    const lambda = Math.max(0.01, Math.min(0.5, learningRate));
    const updated = (1 - lambda) * prior + lambda * sampleDensity;
    return Math.round(updated * 1000) / 1000;
}

/**
 * Tripartite orthogonal risk calculator.
 * Risk = Confidence^alpha * Severity^beta * Impact^gamma
 */
export function calculateTripartiteRisk(
    confidence: number,
    severity: number,
    impact: number,
    alpha: number = 1.0,
    beta: number = 1.2,
    gamma: number = 0.8,
): {
    readonly confidence: number;
    readonly severity: number;
    readonly impact: number;
    readonly risk: number;
} {
    const c = Math.max(0, Math.min(1, confidence));
    const s = Math.max(0, Math.min(1, severity));
    const i = Math.max(0, Math.min(1, impact));
    const rawRisk = Math.pow(c, alpha) * Math.pow(s, beta) * Math.pow(i, gamma);
    return {
        confidence: c,
        severity: s,
        impact: i,
        risk: Math.round(rawRisk * 1000) / 1000,
    };
}

export interface ResourceTopologyFinding {
    readonly ruleId: string;
    readonly filePath: string;
    readonly message: string;
    readonly severity: 'warning' | 'info';
    readonly details: Record<string, unknown>;
}

/**
 * Full audit executor for structured resource topology.
 */
export function auditStructuredResourceTopology(
    files: readonly {
        readonly filePath: string;
        readonly eloc: number;
        readonly astNodeCount: number;
        readonly symbolCount: number;
        readonly literalCount: number;
        readonly astDepth: number;
        readonly language: string;
        readonly isExecutableLogic: boolean;
    }[],
    coreELOC: number,
): readonly ResourceTopologyFinding[] {
    const findings: ResourceTopologyFinding[] = [];

    for (const f of files) {
        const parts = parseStructuredResourceNaming(f.filePath);
        const isRecognized = RECOGNIZED_RESOURCE_BASE_TYPES.has(parts.baseType.toLowerCase());

        if (!isRecognized) {
            continue;
        }

        const sv = calculateSemanticVolume(
            f.eloc,
            f.astNodeCount,
            f.symbolCount,
            f.literalCount,
            f.astDepth,
        );
        const threshold = calculateOmnibusCapacityThreshold(f.language, coreELOC);

        if (parts.depth === 1 && (f.eloc > threshold || sv > threshold * 1.5)) {
            findings.push({
                ruleId: 'NAM-RES-001',
                filePath: f.filePath,
                message: `Structured resource file '${f.filePath}' is overly generic with high capacity (ELOC=${f.eloc}, SV=${sv}, Limit=${threshold}). Recommend splitting by domain.`,
                severity: 'warning',
                details: { eloc: f.eloc, sv, threshold },
            });
        }

        if (parts.depth === 3 && f.eloc < 15 && sv < 30) {
            findings.push({
                ruleId: 'NAM-RES-002',
                filePath: f.filePath,
                message: `Structured resource file '${f.filePath}' is over-specialized and fragmented (ELOC=${f.eloc}, SV=${sv}). Recommend merging into parent domain.`,
                severity: 'info',
                details: { eloc: f.eloc, sv },
            });
        }

        if (parts.extraParts.length > 0) {
            findings.push({
                ruleId: 'NAM-RES-003',
                filePath: f.filePath,
                message: `Structured resource file '${f.filePath}' exceeds 3-tier naming hierarchy (depth=${parts.depth + parts.extraParts.length}).`,
                severity: 'warning',
                details: { extraParts: parts.extraParts },
            });
        }

        if (parts.isOverDescriptive) {
            findings.push({
                ruleId: 'NAM-RES-004',
                filePath: f.filePath,
                message: `Structured resource file '${f.filePath}' has overly descriptive naming tokens.`,
                severity: 'warning',
                details: { baseName: parts.rawBaseName },
            });
        }

        if (f.isExecutableLogic && isRecognized) {
            findings.push({
                ruleId: 'NAM-RES-005',
                filePath: f.filePath,
                message: `Structured resource file '${f.filePath}' declares a resource type but contains heavy executable business logic.`,
                severity: 'warning',
                details: { symbolCount: f.symbolCount },
            });
        }
    }

    return findings;
}
