/**
 * Module: Core Engine — Structured Resource Topology & Scale-Adaptive Analyzer
 * File Path: src/core/architecture/structured-resource-topology.ts
 * Architecture Role: Evaluates naming hierarchy, dynamic scale thresholds, semantic volume,
 *   caller inverted index, multi-modal cohesion, Tarjan SCC decomposition, and risk.
 * Dependencies & Triggers: Consumes internal typing and utility functions;
 *   consumed by NamingAnalyzer.
 * Responsibilities: Enforce architectural resource topology and scale-adaptive rules.
 * Exit Semantics & Design Rationale: Pure architectural analysis engine. Cyclomatic complexity
 *   is strictly bounded (CC <= 10 per function) with full mathematical invariances.
 */

/** Maximum allowed token depth before hierarchy is flagged. */
export const MAX_HIERARCHY_DEPTH = 3;

/** Maximum length of a resource basename before being flagged as over-descriptive. */
export const MAX_DESCRIPTIVE_NAME_LENGTH = 45;

/** Minimum core ELOC floor for log10 scaling. */
export const CORE_ELOC_MIN_FLOOR = 10;

/** Base omnibus capacity scaling multiplier. */
export const OMNIBUS_BASE_CAPACITY = 120;

/** Lower bound for omnibus capacity threshold in lines. */
export const OMNIBUS_MIN_CAPACITY = 60;

/** Scaling factor for percentage rounding. */
export const PERCENT_ROUNDING_SCALE = 100;

/** Scaling factor for three-decimal rounding. */
export const COHESION_ROUNDING_SCALE = 1000;

/** Severity constant for warning findings. */
export const SEVERITY_WARNING = 'warning' as const;

/** Severity constant for info findings. */
export const SEVERITY_INFO = 'info' as const;

/** Minimum ELOC threshold for fragmented resources. */
export const MIN_FRAGMENT_ELOC = 15;

/** Minimum Semantic Volume threshold for fragmented resources. */
export const MIN_FRAGMENT_SV = 30;

/** Scale factor multiplier for semantic volume over-capacity. */
export const SV_OVER_CAPACITY_FACTOR = 1.5;

/** Node archetype string constants. */
const TYPE_PURE = 'pure-type';
const TYPE_HIGH_LAYER = 'high-layer';
const TYPE_RUNTIME_INSTANCE = 'runtime-instance';
const TYPE_EVENT = 'event';
const TYPE_STRATEGY = 'strategy';
const TYPE_SMALL_LEAF = 'small-leaf';

/** Architectural strategy recommended to break a strongly connected cycle. */
export type SccResolutionStrategy =
    | 'TYPE_SINKING'
    | 'INTERFACE_INVERSION'
    | 'DEPENDENCY_INJECTION'
    | 'EVENT_DECOUPLING'
    | 'REGISTRY_EXTRACTION'
    | 'RE_MERGING';

const STRATEGY_TYPE_SINKING: SccResolutionStrategy = 'TYPE_SINKING';
const STRATEGY_INTERFACE_INVERSION: SccResolutionStrategy = 'INTERFACE_INVERSION';
const STRATEGY_DEPENDENCY_INJECTION: SccResolutionStrategy = 'DEPENDENCY_INJECTION';
const STRATEGY_EVENT_DECOUPLING: SccResolutionStrategy = 'EVENT_DECOUPLING';
const STRATEGY_REGISTRY_EXTRACTION: SccResolutionStrategy = 'REGISTRY_EXTRACTION';
const STRATEGY_RE_MERGING: SccResolutionStrategy = 'RE_MERGING';

/** Structured breakdown of a resource file path and name. */
export interface StructuredResourceNamingParts {
    readonly baseType: string;
    readonly domain: string | null;
    readonly subdomain: string | null;
    readonly extraParts: readonly string[];
    readonly depth: number;
    readonly isOverDescriptive: boolean;
    readonly rawBaseName: string;
}

/** Weighting parameters for semantic volume calculation. */
export interface SemanticVolumeWeights {
    readonly we: number;
    readonly wa: number;
    readonly ws: number;
    readonly wl: number;
    readonly wd: number;
}

/** Default weighting configuration for semantic volume. */
export const DEFAULT_SV_WEIGHTS: SemanticVolumeWeights = {
    we: 0.25,
    wa: 0.3,
    ws: 0.2,
    wl: 0.15,
    wd: 0.1,
};

/** Weighting parameters for multi-modal cohesion index. */
export interface CohesionWeights {
    readonly wn: number;
    readonly wt: number;
    readonly wc: number;
    readonly wd: number;
    readonly wh: number;
}

/** Default weighting configuration for multi-modal cohesion. */
export const DEFAULT_COHESION_WEIGHTS: CohesionWeights = {
    wn: 0.1,
    wt: 0.25,
    wc: 0.3,
    wd: 0.25,
    wh: 0.1,
};

/** Set of recognized base architectural resource categories. */
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
 *
 * @param fileName - Target file name or relative path.
 * @returns Parsed resource naming parts.
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
    const extraParts = tokens.length > MAX_HIERARCHY_DEPTH ? tokens.slice(MAX_HIERARCHY_DEPTH) : [];
    const depth = isRecognized ? Math.min(tokens.length, MAX_HIERARCHY_DEPTH) : 1;
    const isOverDescriptive =
        tokens.length > MAX_HIERARCHY_DEPTH || baseName.length > MAX_DESCRIPTIVE_NAME_LENGTH;

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
 *
 * @param allFiles - Collection of files with ELOC.
 * @param frozenResourcePaths - Frozen resource paths set.
 * @returns Baseline core ELOC.
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
 *
 * @param language - Target programming language.
 * @param coreELOC - Core codebase effective line count.
 * @param densityPrior - Language density prior.
 * @returns Omnibus capacity threshold in ELOC.
 */
export function computeOmnibusCapacity(
    language: string,
    coreELOC: number,
    densityPrior: number = 1.0,
): number {
    void language;
    const effectiveDensity = Math.max(0.5, densityPrior);
    const scaleFactor = Math.log10(Math.max(CORE_ELOC_MIN_FLOOR, coreELOC));
    const baseCapacity = OMNIBUS_BASE_CAPACITY * effectiveDensity * scaleFactor;
    return Math.max(OMNIBUS_MIN_CAPACITY, Math.round(baseCapacity));
}

/** Backward compatible alias for computeOmnibusCapacity. */
export const calculateOmnibusCapacityThreshold = computeOmnibusCapacity;

/** Input metrics bundle for semantic volume calculation. */
export interface SemanticVolumeMetrics {
    readonly eloc: number;
    readonly astNodeCount: number;
    readonly symbolCount: number;
    readonly literalCount: number;
    readonly astDepth: number;
}

/**
 * Calculates Semantic Volume (SV) against line-packing/minification evasion.
 * Supports both object bundle and legacy positional scalar signatures.
 *
 * @param args - Either [metrics, weights] or positional scalar parameters.
 * @returns Semantic volume score.
 */
export function calculateSemanticVolume(
    ...args:
        | [metrics: SemanticVolumeMetrics, weights?: SemanticVolumeWeights]
        | [
              eloc: number,
              astNodeCount: number,
              symbolCount: number,
              literalCount: number,
              astDepth: number,
              weights?: SemanticVolumeWeights,
          ]
): number {
    if (typeof args[0] === 'object') {
        const [first, maybeWeights] = args as [SemanticVolumeMetrics, SemanticVolumeWeights?];
        const weights = maybeWeights ?? DEFAULT_SV_WEIGHTS;
        const rawSV =
            weights.we * first.eloc +
            weights.wa * first.astNodeCount +
            weights.ws * first.symbolCount +
            weights.wl * first.literalCount +
            weights.wd * first.astDepth;
        return Math.round(rawSV * PERCENT_ROUNDING_SCALE) / PERCENT_ROUNDING_SCALE;
    }
    const [eloc, astNodeCount, symbolCount, literalCount, astDepth, weights = DEFAULT_SV_WEIGHTS] =
        args as [number, number, number, number, number, SemanticVolumeWeights?];
    const rawSV =
        weights.we * eloc +
        weights.wa * astNodeCount +
        weights.ws * symbolCount +
        weights.wl * literalCount +
        weights.wd * astDepth;
    return Math.round(rawSV * PERCENT_ROUNDING_SCALE) / PERCENT_ROUNDING_SCALE;
}

/** Backward compatible alias for calculateSemanticVolume. */
export const computeSemanticVolume = calculateSemanticVolume;

/**
 * Records pairwise co-occurrence counts into an accumulator index.
 * Encapsulates the O(|I(c)|^2) local matrix traversal to reduce loop depth to 2.
 *
 * @param importedSymbols - Symbols imported by a single caller module.
 * @param coOccurrenceMap - Accumulator index mapping pair keys to co-occurrence counts.
 */
function recordPairCoOccurrences(
    importedSymbols: readonly string[],
    coOccurrenceMap: Map<string, number>,
): void {
    const symbolCount = importedSymbols.length;
    for (let i = 0; i < symbolCount; i++) {
        const firstSymbol = importedSymbols[i];
        for (let j = i + 1; j < symbolCount; j++) {
            const secondSymbol = importedSymbols[j];
            const smallerSymbol = firstSymbol < secondSymbol ? firstSymbol : secondSymbol;
            const largerSymbol = firstSymbol < secondSymbol ? secondSymbol : firstSymbol;
            const pairKey = `${smallerSymbol}::${largerSymbol}`;
            coOccurrenceMap.set(pairKey, (coOccurrenceMap.get(pairKey) ?? 0) + 1);
        }
    }
}

/**
 * Appends a caller path to the inverted symbol index, allocating a bucket only on first encounter.
 *
 * @param invertedCallersMap - Inverted symbol index map.
 * @param symbolName - Symbol identifier.
 * @param callerPath - Caller path importing the symbol.
 */
function addInvertedCaller(
    invertedCallersMap: Map<string, string[]>,
    symbolName: string,
    callerPath: string,
): void {
    const callers = invertedCallersMap.get(symbolName);
    if (callers !== undefined) {
        callers.push(callerPath);
        return;
    }
    invertedCallersMap.set(symbolName, [callerPath]);
}

/**
 * Construct an inverted symbol caller index and sparse co-occurrence graph edges.
 *
 * @param callerImports - Readonly array of caller paths and their imported symbols.
 * @returns Inverted symbol index map and sparse co-occurrence edges.
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
    const invertedCallersMap = new Map<string, string[]>();
    for (const entry of callerImports) {
        for (const sym of entry.importedSymbols) {
            addInvertedCaller(invertedCallersMap, sym, entry.callerPath);
        }
    }

    const coOccurrenceMap = new Map<string, number>();
    for (const entry of callerImports) {
        recordPairCoOccurrences(entry.importedSymbols, coOccurrenceMap);
    }

    const sparseEdges: [string, string, number][] = [];
    for (const [key, weight] of coOccurrenceMap.entries()) {
        const [firstSym, secondSym] = key.split('::');
        sparseEdges.push([firstSym, secondSym, weight]);
    }

    return { invertedIndex: invertedCallersMap, sparseEdges };
}

/** Multi-modal cohesion factors input bundle. */
export interface MultiModalCohesionFactors {
    readonly nameJaccard: number;
    readonly typeAffinity: number;
    readonly callerOverlap: number;
    readonly domainPurity: number;
    readonly historyCovariance: number;
}

/**
 * Multi-modal semantic cohesion calculator.
 * Supports both object bundle and legacy positional scalar signatures.
 *
 * @param args - Either [factors, weights] or positional scalar parameters.
 * @returns Composite cohesion score.
 */
export function calculateMultiModalCohesion(
    ...args:
        | [factors: MultiModalCohesionFactors, weights?: CohesionWeights]
        | [
              nameJaccard: number,
              typeAffinity: number,
              callerOverlap: number,
              domainPurity: number,
              historyCovariance: number,
              weights?: CohesionWeights,
          ]
): number {
    if (typeof args[0] === 'object') {
        const [first, maybeWeights] = args as [MultiModalCohesionFactors, CohesionWeights?];
        const weights = maybeWeights ?? DEFAULT_COHESION_WEIGHTS;
        const score =
            weights.wn * Math.max(0, Math.min(1, first.nameJaccard)) +
            weights.wt * Math.max(0, Math.min(1, first.typeAffinity)) +
            weights.wc * Math.max(0, Math.min(1, first.callerOverlap)) +
            weights.wd * Math.max(0, Math.min(1, first.domainPurity)) +
            weights.wh * Math.max(0, Math.min(1, first.historyCovariance));
        return Math.round(score * COHESION_ROUNDING_SCALE) / COHESION_ROUNDING_SCALE;
    }
    const [
        nameJaccard,
        typeAffinity,
        callerOverlap,
        domainPurity,
        historyCovariance,
        weights = DEFAULT_COHESION_WEIGHTS,
    ] = args as [number, number, number, number, number, CohesionWeights?];
    const score =
        weights.wn * Math.max(0, Math.min(1, nameJaccard)) +
        weights.wt * Math.max(0, Math.min(1, typeAffinity)) +
        weights.wc * Math.max(0, Math.min(1, callerOverlap)) +
        weights.wd * Math.max(0, Math.min(1, domainPurity)) +
        weights.wh * Math.max(0, Math.min(1, historyCovariance));
    return Math.round(score * COHESION_ROUNDING_SCALE) / COHESION_ROUNDING_SCALE;
}

/** Backward compatible alias for calculateMultiModalCohesion. */
export const computeMultiModalCohesion = calculateMultiModalCohesion;

/** Diagnostic report containing discovered SCC cycle components and remedies. */
export interface SccCycleDiagnosis {
    readonly stronglyConnectedComponents: readonly (readonly string[])[];
    readonly cyclicComponents: readonly {
        readonly nodes: readonly string[];
        readonly strategy: SccResolutionStrategy;
        readonly rationale: string;
    }[];
}

/** Tarjan SCC cycle decomposition engine on directed dependency graph. */
class TarjanSccComputer {
    private index = 0;
    private readonly indices = new Map<string, number>();
    private readonly lowlink = new Map<string, number>();
    private readonly onStack = new Set<string>();
    private readonly stack: string[] = [];
    private readonly sccs: string[][] = [];

    constructor(private readonly adjList: ReadonlyMap<string, readonly string[]>) {}

    computeCycleComponents(): string[][] {
        for (const node of this.adjList.keys()) {
            if (!this.indices.has(node)) {
                this.computeStrongConnect(node);
            }
        }
        return this.sccs;
    }

    private computeStrongConnect(nodeId: string): void {
        this.indices.set(nodeId, this.index);
        this.lowlink.set(nodeId, this.index);
        this.index++;
        this.stack.push(nodeId);
        this.onStack.add(nodeId);

        const neighbors = this.adjList.get(nodeId) ?? [];
        for (const neighborNode of neighbors) {
            if (!this.indices.has(neighborNode)) {
                this.computeStrongConnect(neighborNode);
                this.lowlink.set(
                    nodeId,
                    Math.min(this.lowlink.get(nodeId)!, this.lowlink.get(neighborNode)!),
                );
            } else if (this.onStack.has(neighborNode)) {
                this.lowlink.set(
                    nodeId,
                    Math.min(this.lowlink.get(nodeId)!, this.indices.get(neighborNode)!),
                );
            }
        }

        if (this.lowlink.get(nodeId) === this.indices.get(nodeId)) {
            this.popComponent(nodeId);
        }
    }

    private popComponent(rootNode: string): void {
        const component: string[] = [];
        let poppedNode: string;
        do {
            poppedNode = this.stack.pop()!;
            this.onStack.delete(poppedNode);
            component.push(poppedNode);
        } while (poppedNode !== rootNode);
        this.sccs.push(component);
    }
}

function resolveCycleStrategy(
    nodes: readonly string[],
    nodeTypes?: ReadonlyMap<
        string,
        'pure-type' | 'high-layer' | 'runtime-instance' | 'event' | 'strategy' | 'small-leaf'
    >,
): { nodes: string[]; strategy: SccResolutionStrategy; rationale: string } {
    const types = nodes.map((n) => nodeTypes?.get(n) ?? TYPE_PURE);
    if (types.every((t) => t === TYPE_PURE)) {
        return {
            nodes: [...nodes],
            strategy: STRATEGY_TYPE_SINKING,
            rationale: 'Extract common interfaces/types into types-base module',
        };
    }
    if (types.includes(TYPE_HIGH_LAYER)) {
        return {
            nodes: [...nodes],
            strategy: STRATEGY_INTERFACE_INVERSION,
            rationale: 'Apply Dependency Inversion Principle (DIP) to decouple layers',
        };
    }
    if (types.includes(TYPE_RUNTIME_INSTANCE)) {
        return {
            nodes: [...nodes],
            strategy: STRATEGY_DEPENDENCY_INJECTION,
            rationale: 'Pass instances via dependency injection rather than direct imports',
        };
    }
    if (types.includes(TYPE_EVENT)) {
        return {
            nodes: [...nodes],
            strategy: STRATEGY_EVENT_DECOUPLING,
            rationale: 'Decouple state changes using event emitter pub/sub',
        };
    }
    if (types.includes(TYPE_STRATEGY)) {
        return {
            nodes: [...nodes],
            strategy: STRATEGY_REGISTRY_EXTRACTION,
            rationale: 'Extract dynamic strategies into centralized registry',
        };
    }
    if (types.every((t) => t === TYPE_SMALL_LEAF)) {
        return {
            nodes: [...nodes],
            strategy: STRATEGY_RE_MERGING,
            rationale: 'Micro sub-libraries are highly cohesive; re-merge into parent domain',
        };
    }
    return {
        nodes: [...nodes],
        strategy: STRATEGY_TYPE_SINKING,
        rationale: 'Extract common types into base type definition file',
    };
}

/**
 * Tarjan SCC cycle decomposition on sub-library dependency graph.
 *
 * @param adjList - Directed dependency adjacency list.
 * @param nodeTypes - Optional node archetype classification map.
 * @returns Strongly connected components and cycle resolution strategies.
 */
export function auditDependencyCycles(
    adjList: ReadonlyMap<string, readonly string[]>,
    nodeTypes?: ReadonlyMap<
        string,
        'pure-type' | 'high-layer' | 'runtime-instance' | 'event' | 'strategy' | 'small-leaf'
    >,
): SccCycleDiagnosis {
    const computer = new TarjanSccComputer(adjList);
    const sccs = computer.computeCycleComponents();
    const cyclicComponents = sccs
        .filter((comp) => comp.length > 1)
        .map((nodes) => resolveCycleStrategy(nodes, nodeTypes));

    return {
        stronglyConnectedComponents: sccs,
        cyclicComponents,
    };
}

/** Backward compatible alias for auditDependencyCycles. */
export const diagnoseSccDependencyCycles = auditDependencyCycles;

/**
 * Bayesian prior update for language density coefficient.
 *
 * @param prior - Prior language density estimate.
 * @param sampleDensity - Sample observed density.
 * @param learningRate - Update learning rate lambda.
 * @returns Posterior updated density prior.
 */
export function updateLanguageDensityPrior(
    prior: number,
    sampleDensity: number,
    learningRate: number = 0.1,
): number {
    const lambda = Math.max(0.01, Math.min(0.5, learningRate));
    const updated = (1 - lambda) * prior + lambda * sampleDensity;
    return Math.round(updated * COHESION_ROUNDING_SCALE) / COHESION_ROUNDING_SCALE;
}

/** Dimensions input bundle for tripartite orthogonal risk. */
export interface TripartiteRiskDimensions {
    readonly confidence: number;
    readonly severity: number;
    readonly impact: number;
}

/** Exponents input bundle for tripartite orthogonal risk. */
export interface TripartiteRiskExponents {
    readonly alpha?: number;
    readonly beta?: number;
    readonly gamma?: number;
}

const DEFAULT_ALPHA = 1.0;
const DEFAULT_BETA = 1.2;
const DEFAULT_GAMMA = 0.8;

/**
 * Tripartite orthogonal risk calculator.
 * Risk = Confidence^alpha * Severity^beta * Impact^gamma.
 * Supports both object bundle and legacy positional scalar signatures.
 *
 * @param args - Either [dimensions, exponents] or positional scalar parameters.
 * @returns Tripartite risk breakdown.
 */
export function calculateTripartiteRisk(
    ...args:
        | [dimensions: TripartiteRiskDimensions, exponents?: TripartiteRiskExponents]
        | [
              confidence: number,
              severity: number,
              impact: number,
              alpha?: number,
              beta?: number,
              gamma?: number,
          ]
): {
    readonly confidence: number;
    readonly severity: number;
    readonly impact: number;
    readonly risk: number;
} {
    const isObjectForm = typeof args[0] === 'object';
    const dims: TripartiteRiskDimensions = isObjectForm
        ? (args[0] as TripartiteRiskDimensions)
        : {
              confidence: args[0] as number,
              severity: args[1] as number,
              impact: args[2] as number,
          };
    const exponents: TripartiteRiskExponents | undefined = isObjectForm
        ? (args[1] as TripartiteRiskExponents | undefined)
        : {
              alpha: args[3] as number | undefined,
              beta: args[4] as number | undefined,
              gamma: args[5] as number | undefined,
          };

    const alpha = exponents?.alpha ?? DEFAULT_ALPHA;
    const beta = exponents?.beta ?? DEFAULT_BETA;
    const gamma = exponents?.gamma ?? DEFAULT_GAMMA;
    const clampedConfidence = Math.max(0, Math.min(1, dims.confidence));
    const clampedSeverity = Math.max(0, Math.min(1, dims.severity));
    const clampedImpact = Math.max(0, Math.min(1, dims.impact));
    const rawRisk =
        Math.pow(clampedConfidence, alpha) *
        Math.pow(clampedSeverity, beta) *
        Math.pow(clampedImpact, gamma);

    return {
        confidence: clampedConfidence,
        severity: clampedSeverity,
        impact: clampedImpact,
        risk: Math.round(rawRisk * COHESION_ROUNDING_SCALE) / COHESION_ROUNDING_SCALE,
    };
}

/** Backward compatible alias for calculateTripartiteRisk. */
export const computeTripartiteRisk = calculateTripartiteRisk;

/** Diagnostic finding emitted by resource topology validation. */
export interface ResourceTopologyFinding {
    readonly ruleId: string;
    readonly filePath: string;
    readonly message: string;
    readonly severity: 'warning' | 'info';
    readonly details: Record<string, unknown>;
}

/** Candidate resource file metric shape. */
export interface CandidateResourceFile {
    readonly filePath: string;
    readonly eloc: number;
    readonly astNodeCount: number;
    readonly symbolCount: number;
    readonly literalCount: number;
    readonly astDepth: number;
    readonly language: string;
    readonly isExecutableLogic: boolean;
}

function auditResourceScaleFindings(
    candidateFile: CandidateResourceFile,
    parts: StructuredResourceNamingParts,
    coreELOC: number,
    findings: ResourceTopologyFinding[],
): void {
    const semanticVolume = computeSemanticVolume(candidateFile);
    const capacityLimit = computeOmnibusCapacity(candidateFile.language, coreELOC);

    if (
        parts.depth === 1 &&
        (candidateFile.eloc > capacityLimit ||
            semanticVolume > capacityLimit * SV_OVER_CAPACITY_FACTOR)
    ) {
        findings.push({
            ruleId: 'NAM-RES-001',
            filePath: candidateFile.filePath,
            message: `Structured resource file '${candidateFile.filePath}' is overly generic with high capacity (ELOC=${candidateFile.eloc}, SV=${semanticVolume}, Limit=${capacityLimit}). Recommend splitting by domain.`,
            severity: SEVERITY_WARNING,
            details: { eloc: candidateFile.eloc, sv: semanticVolume, threshold: capacityLimit },
        });
    }

    if (
        parts.depth === MAX_HIERARCHY_DEPTH &&
        candidateFile.eloc < MIN_FRAGMENT_ELOC &&
        semanticVolume < MIN_FRAGMENT_SV
    ) {
        findings.push({
            ruleId: 'NAM-RES-002',
            filePath: candidateFile.filePath,
            message: `Structured resource file '${candidateFile.filePath}' is over-specialized and fragmented (ELOC=${candidateFile.eloc}, SV=${semanticVolume}). Recommend merging into parent domain.`,
            severity: SEVERITY_INFO,
            details: { eloc: candidateFile.eloc, sv: semanticVolume },
        });
    }
}

function auditNamingHierarchy(
    candidateFile: CandidateResourceFile,
    parts: StructuredResourceNamingParts,
    isRecognized: boolean,
    findings: ResourceTopologyFinding[],
): void {
    if (parts.extraParts.length > 0) {
        findings.push({
            ruleId: 'NAM-RES-003',
            filePath: candidateFile.filePath,
            message: `Structured resource file '${candidateFile.filePath}' exceeds 3-tier naming hierarchy (depth=${parts.depth + parts.extraParts.length}).`,
            severity: SEVERITY_WARNING,
            details: { extraParts: parts.extraParts },
        });
    }

    if (parts.isOverDescriptive) {
        findings.push({
            ruleId: 'NAM-RES-004',
            filePath: candidateFile.filePath,
            message: `Structured resource file '${candidateFile.filePath}' has overly descriptive naming tokens.`,
            severity: SEVERITY_WARNING,
            details: { baseName: parts.rawBaseName },
        });
    }

    if (candidateFile.isExecutableLogic && isRecognized) {
        findings.push({
            ruleId: 'NAM-RES-005',
            filePath: candidateFile.filePath,
            message: `Structured resource file '${candidateFile.filePath}' declares a resource type but contains heavy executable business logic.`,
            severity: SEVERITY_WARNING,
            details: { symbolCount: candidateFile.symbolCount },
        });
    }
}

function auditSingleResourceFile(
    candidateFile: CandidateResourceFile,
    coreELOC: number,
    findings: ResourceTopologyFinding[],
): void {
    const parts = parseStructuredResourceNaming(candidateFile.filePath);
    const isRecognized = RECOGNIZED_RESOURCE_BASE_TYPES.has(parts.baseType.toLowerCase());
    if (!isRecognized) {
        return;
    }

    auditResourceScaleFindings(candidateFile, parts, coreELOC, findings);
    auditNamingHierarchy(candidateFile, parts, isRecognized, findings);
}

/**
 * Full audit executor for structured resource topology.
 *
 * @param files - All candidate files with AST metrics.
 * @param coreELOC - Baseline core effective lines of code.
 * @returns Detected resource topology findings.
 */
export function auditStructuredResourceTopology(
    files: readonly CandidateResourceFile[],
    coreELOC: number,
): readonly ResourceTopologyFinding[] {
    const findings: ResourceTopologyFinding[] = [];
    for (const file of files) {
        auditSingleResourceFile(file, coreELOC, findings);
    }
    return findings;
}
