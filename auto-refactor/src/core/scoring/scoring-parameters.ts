/**
 * Module: Core Scoring — Unified Scoring Parameter Single Source of Truth
 * File Path: src/core/scoring/scoring-parameters.ts
 * Architecture Role: Central declarative registry for every numeric constant that shapes a
 *   scoring curve (autonomy weights, clone density half-point, supply chain dampening, the
 *   Michaelis-Menten half-saturation point, macro-file log damping knee, security attack
 *   surface ceiling, and the anti-gaming conjunction threshold), so no consumer module has
 *   to carry its own private magic number.
 * Dependencies & Triggers: Imports nothing; consumed by `autonomy-scorer`, `scorer-formulas`,
 *   `qualityScorer`, `hierarchicalScorer`, `antiGaming`, and the Praxis composite gate.
 * Responsibilities:
 *   1. Declare the frozen default configuration for autonomy, quality, and anti-gaming scoring;
 *   2. Deep-merge a caller supplied partial override without mutating the defaults;
 *   3. Reject weights, thresholds, and scale constants that cannot define a meaningful curve.
 * Exit Semantics & Design Rationale: Pure data plus pure resolution functions; the resolver
 *   throws a `RangeError` on a non-positive weight mass or an out-of-range ratio so a broken
 *   configuration fails at the boundary instead of silently producing a meaningless score.
 *   Defaults preserve the previously published behaviour except where the model was corrected:
 *   autonomy aggregation is geometric (non-compensatory) and the composite floor is shared.
 */

/** Aggregation strategy for a multi-axis composite index. */
export type ScoringAggregationMode = 'geometric' | 'arithmetic';

/** Relative contribution of each CAI sub-dimension; only the ratios carry meaning. */
export interface AutonomyScoringWeights {
    readonly effectiveLoc: number;
    readonly symbolCall: number;
    readonly domainKernel: number;
    readonly codeOriginality: number;
    readonly supplyChainResilience: number;
    readonly criticalPathAutonomy: number;
}

/** Sub-linear dampening coefficients for the supply chain resilience curve. */
export interface SupplyChainScoringConfig {
    readonly directWeight: number;
    readonly transitiveWeight: number;
    readonly depthWeight: number;
    readonly minResilience: number;
}

/** Parameters governing the in-house autonomy index (CAI). */
export interface AutonomyScoringConfig {
    readonly weights: AutonomyScoringWeights;
    readonly aggregationMode: ScoringAggregationMode;
    /** Clone findings per thousand proprietary ELOC at which originality reads 50. */
    readonly cloneHalfPoint: number;
    /** Proprietary ELOC divisor that turns an absolute clone count into a density. */
    readonly cloneDensityElocUnit: number;
    /** Score floor for the external-package call fallback when no symbol index exists. */
    readonly minSymbolCallScore: number;
    /** Score deducted per distinct external package in the same fallback path. */
    readonly externalPackagePenalty: number;
    /** Irreducible toolchain/provenance reserve ensuring CAI asymptotically stays below 100%. */
    readonly epistemicReserve: number;
    /** ELOC half-point controlling finite-sample provenance convergence below the ceiling. */
    readonly epistemicSampleHalfPointEloc: number;
    readonly supplyChain: SupplyChainScoringConfig;
}

/** Attack surface model that lowers the clean-code ceiling for exposed APIs and volume. */
export interface SecurityCeilingScoringConfig {
    readonly exportWeight: number;
    readonly locWeight: number;
    readonly exportLimit: number;
    readonly locLimit: number;
    readonly maxDiscount: number;
    readonly baselineLines: number;
    /** Irreducible security reserve keeping clean ceilings strictly below 100. */
    readonly epistemicBaseReserve: number;
}

/** Epistemic & structural-surface asymptote keeping every dimension strictly below 100. */
export interface EpistemicCeilingScoringConfig {
    readonly baseReserve: number;
    readonly maxSurfaceDiscount: number;
    readonly volumeHalfPointLines: number;
    readonly exportSurfaceHalfPoint: number;
    readonly volumeWeight: number;
    readonly exportWeight: number;
    readonly baselineLines: number;
}

/** Parameters governing a single-dimension index curve. */
export interface QualityScoringConfig {
    /** Deduction density (points per 100 lines) at which a dimension index reads 50. */
    readonly saturationHalfpoint: number;
    /** Scale factor at which micro-file smoothing ends and macro-file damping starts. */
    readonly macroFileKneeScale: number;
    /** Logarithmic damping weight applied past the knee. */
    readonly macroFileLogWeight: number;
    /** Lower asymptote of the micro-file scale mapping in (0, 1). */
    readonly microFileFloorScale: number;
    readonly securityCeiling: SecurityCeilingScoringConfig;
    readonly epistemicCeiling: EpistemicCeilingScoringConfig;
}

/** Parameters governing the canonical `BLOCK_GAMING_DETECTED` conjunction. */
export interface AntiGamingScoringConfig {
    /** Semantic change ratio at or below which a change counts as trivial churn. */
    readonly semanticChangeRatioThreshold: number;
    /** Shannon entropy below which an oversized file counts as low-entropy padding. */
    readonly lowEntropyShannonThreshold: number;
    /** Line count at which the low-entropy padding heuristic starts applying. */
    readonly lowEntropyMinLines: number;
}

/** Whole scoring parameter tree resolved once per scan. */
export interface ScoringSystemConfig {
    /** Floor applied to every axis before a geometric mean, in index units. */
    readonly compositeIndexFloor: number;
    readonly autonomy: AutonomyScoringConfig;
    readonly quality: QualityScoringConfig;
    readonly antiGaming: AntiGamingScoringConfig;
}

/** Recursive optional view of a configuration tree, used for caller overrides. */
export type PartialScoringConfig = {
    readonly [K in keyof ScoringSystemConfig]?: ScoringSystemConfig[K] extends object
        ? {
              readonly [
                  P in keyof ScoringSystemConfig[K]
              ]?: ScoringSystemConfig[K][P] extends object
                  ? {
                        readonly [
                            Q in keyof ScoringSystemConfig[K][P]
                        ]?: ScoringSystemConfig[K][P][Q];
                    }
                  : ScoringSystemConfig[K][P];
          }
        : ScoringSystemConfig[K];
};

/** Dimension weights previously hardcoded inside the autonomy scorer. */
export const DEFAULT_AUTONOMY_WEIGHTS: AutonomyScoringWeights = Object.freeze({
    effectiveLoc: 0.3,
    symbolCall: 0.2,
    domainKernel: 0.15,
    codeOriginality: 0.15,
    supplyChainResilience: 0.1,
    criticalPathAutonomy: 0.1,
});

/**
 * Frozen defaults for the whole scoring system.
 *
 * `aggregationMode` is geometric because an arithmetic CAI let five healthy axes outvote a
 * collapsed critical path, mirroring the arithmetic-mean defect the quality model already
 * rejected. `cloneHalfPoint` is a density (findings per thousand ELOC) rather than an absolute
 * count, so a large repository is no longer pinned to the originality floor by ordinary
 * duplicated string literals.
 */
export const DEFAULT_SCORING_CONFIG: ScoringSystemConfig = Object.freeze({
    compositeIndexFloor: 15,
    autonomy: Object.freeze({
        weights: DEFAULT_AUTONOMY_WEIGHTS,
        aggregationMode: 'geometric',
        cloneHalfPoint: 5.0,
        cloneDensityElocUnit: 1000,
        minSymbolCallScore: 10,
        externalPackagePenalty: 15,
        epistemicReserve: 0.25,
        epistemicSampleHalfPointEloc: 4000,
        supplyChain: Object.freeze({
            directWeight: 0.5,
            transitiveWeight: 0.8,
            depthWeight: 2.0,
            minResilience: 15.0,
        }),
    }),
    quality: Object.freeze({
        saturationHalfpoint: 30,
        macroFileKneeScale: 10.0,
        macroFileLogWeight: 2.0,
        microFileFloorScale: 0.2,
        securityCeiling: Object.freeze({
            exportWeight: 0.6,
            locWeight: 0.4,
            exportLimit: 30,
            locLimit: 500,
            maxDiscount: 0.5,
            baselineLines: 100,
            epistemicBaseReserve: 0.25,
        }),
        epistemicCeiling: Object.freeze({
            baseReserve: 0.25,
            maxSurfaceDiscount: 0.55,
            volumeHalfPointLines: 2500,
            exportSurfaceHalfPoint: 80,
            volumeWeight: 0.7,
            exportWeight: 0.3,
            baselineLines: 100,
        }),
    }),
    antiGaming: Object.freeze({
        semanticChangeRatioThreshold: 0.15,
        lowEntropyShannonThreshold: 2.5,
        lowEntropyMinLines: 300,
    }),
});

const WEIGHT_KEYS: readonly (keyof AutonomyScoringWeights)[] = Object.freeze([
    'effectiveLoc',
    'symbolCall',
    'domainKernel',
    'codeOriginality',
    'supplyChainResilience',
    'criticalPathAutonomy',
] as const);

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function mergeWeightOverrides(
    base: AutonomyScoringWeights,
    override?: Partial<AutonomyScoringWeights>,
): AutonomyScoringWeights {
    if (!override) return base;
    const merged = { ...base } as Record<string, number>;
    for (const key of WEIGHT_KEYS) {
        const candidate = override[key];
        if (candidate !== undefined) merged[key] = candidate;
    }
    return Object.freeze(merged as unknown as AutonomyScoringWeights);
}

/**
 * Resolve the autonomy parameters, falling back to the frozen defaults per field.
 *
 * @param defaults - Baseline autonomy configuration.
 * @param override - Caller supplied partial override.
 * @returns A frozen merged autonomy configuration.
 */
export function resolveAutonomyConfig(
    defaults: AutonomyScoringConfig,
    override?: PartialScoringConfig['autonomy'],
): AutonomyScoringConfig {
    if (!override) return defaults;
    return Object.freeze({
        ...defaults,
        ...override,
        weights: mergeWeightOverrides(defaults.weights, override.weights),
        supplyChain: Object.freeze({ ...defaults.supplyChain, ...(override.supplyChain ?? {}) }),
    });
}

/**
 * Resolve the quality curve parameters, falling back to the frozen defaults per field.
 *
 * @param defaults - Baseline quality configuration.
 * @param override - Caller supplied partial override.
 * @returns A frozen merged quality configuration.
 */
export function resolveQualityConfig(
    defaults: QualityScoringConfig,
    override?: PartialScoringConfig['quality'],
): QualityScoringConfig {
    if (!override) return defaults;
    return Object.freeze({
        ...defaults,
        ...override,
        securityCeiling: Object.freeze({
            ...defaults.securityCeiling,
            ...(override.securityCeiling ?? {}),
        }),
        epistemicCeiling: Object.freeze({
            ...defaults.epistemicCeiling,
            ...(override.epistemicCeiling ?? {}),
        }),
    });
}

/**
 * Resolve the anti-gaming parameters, falling back to the frozen defaults per field.
 *
 * @param defaults - Baseline anti-gaming configuration.
 * @param override - Caller supplied partial override.
 * @returns A frozen merged anti-gaming configuration.
 */
export function resolveAntiGamingConfig(
    defaults: AntiGamingScoringConfig,
    override?: PartialScoringConfig['antiGaming'],
): AntiGamingScoringConfig {
    if (!override) return defaults;
    return Object.freeze({
        semanticChangeRatioThreshold:
            override.semanticChangeRatioThreshold ?? defaults.semanticChangeRatioThreshold,
        lowEntropyShannonThreshold:
            override.lowEntropyShannonThreshold ?? defaults.lowEntropyShannonThreshold,
        lowEntropyMinLines: override.lowEntropyMinLines ?? defaults.lowEntropyMinLines,
    });
}

/**
 * Merge a partial scoring override onto the frozen defaults.
 *
 * @param override - Optional partial configuration supplied by a caller or config file.
 * @param defaults - Baseline configuration, normally `DEFAULT_SCORING_CONFIG`.
 * @returns A validated, frozen configuration tree.
 */
export function resolveScoringConfig(
    override?: PartialScoringConfig,
    defaults: ScoringSystemConfig = DEFAULT_SCORING_CONFIG,
): ScoringSystemConfig {
    if (!override) return defaults;
    return Object.freeze({
        compositeIndexFloor: override.compositeIndexFloor ?? defaults.compositeIndexFloor,
        autonomy: resolveAutonomyConfig(defaults.autonomy, override.autonomy),
        quality: resolveQualityConfig(defaults.quality, override.quality),
        antiGaming: resolveAntiGamingConfig(defaults.antiGaming, override.antiGaming),
    });
}

function assertWeightMass(weights: AutonomyScoringWeights): void {
    let mass = 0;
    for (const key of WEIGHT_KEYS) {
        const value = weights[key];
        if (!isFiniteNumber(value) || value < 0) {
            throw new RangeError(`autonomy weight "${key}" must be finite and non-negative`);
        }
        mass += value;
    }
    if (mass <= 0) {
        throw new RangeError('autonomy weights must carry a positive total mass');
    }
}

function assertPositive(value: number, name: string): void {
    if (!isFiniteNumber(value) || value <= 0) {
        throw new RangeError(`${name} must be a finite positive number, got ${String(value)}`);
    }
}

function assertRatio(value: number, name: string): void {
    if (!isFiniteNumber(value) || value <= 0 || value > 1) {
        throw new RangeError(`${name} must be a finite ratio in (0, 1], got ${String(value)}`);
    }
}

/**
 * Validate a resolved configuration, rejecting parameters that cannot define a curve.
 *
 * @param config - Resolved configuration tree.
 * @returns The same configuration, enabling fluent use.
 */
export function assertValidScoringConfig(config: ScoringSystemConfig): ScoringSystemConfig {
    assertWeightMass(config.autonomy.weights);
    assertPositive(config.compositeIndexFloor, 'compositeIndexFloor');
    assertPositive(config.autonomy.cloneHalfPoint, 'cloneHalfPoint');
    assertPositive(config.autonomy.cloneDensityElocUnit, 'cloneDensityElocUnit');
    assertPositive(config.autonomy.supplyChain.minResilience, 'supplyChain.minResilience');
    assertPositive(config.autonomy.epistemicReserve, 'autonomy.epistemicReserve');
    assertPositive(
        config.autonomy.epistemicSampleHalfPointEloc,
        'autonomy.epistemicSampleHalfPointEloc',
    );
    assertPositive(config.quality.saturationHalfpoint, 'saturationHalfpoint');
    assertPositive(config.quality.macroFileKneeScale, 'macroFileKneeScale');
    assertPositive(config.quality.macroFileLogWeight, 'macroFileLogWeight');
    assertPositive(config.quality.securityCeiling.exportLimit, 'securityCeiling.exportLimit');
    assertPositive(config.quality.securityCeiling.locLimit, 'securityCeiling.locLimit');
    assertPositive(
        config.quality.securityCeiling.epistemicBaseReserve,
        'securityCeiling.epistemicBaseReserve',
    );
    assertPositive(config.quality.epistemicCeiling.baseReserve, 'epistemicCeiling.baseReserve');
    assertPositive(
        config.quality.epistemicCeiling.volumeHalfPointLines,
        'epistemicCeiling.volumeHalfPointLines',
    );
    assertPositive(
        config.quality.epistemicCeiling.exportSurfaceHalfPoint,
        'epistemicCeiling.exportSurfaceHalfPoint',
    );
    assertRatio(config.antiGaming.semanticChangeRatioThreshold, 'semanticChangeRatioThreshold');
    const microFloor = config.quality.microFileFloorScale;
    if (!isFiniteNumber(microFloor) || microFloor < 0 || microFloor >= 1) {
        throw new RangeError('microFileFloorScale must be a finite number in [0, 1)');
    }
    return config;
}
