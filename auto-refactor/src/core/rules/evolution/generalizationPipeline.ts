/**
 * Module: Core Rules — Evolution: Rule Generalization Pipeline
 * File Path: src/core/rules/evolution/generalizationPipeline.ts
 * Architecture Role: Orchestrates the rule candidate lifecycle, executes 4-tier generalization
 *   scrutiny, verifies cross-language fixtures (TypeScript, Python, Rust), and manages candidate
 *   promotion to canonical production status.
 * Dependencies & Triggers: Consumes types from ./types; called during CI validation and test
 *   modernity runs.
 * Responsibilities: Manage candidates, evaluate 4-tier scrutiny criteria, run multi-language
 *   fixtures, and emit PromotionResult descriptors.
 * Exit Semantics & Design Rationale: Pure, deterministic evaluation without disk or external I/O.
 */

import type {
    GeneralizationLevel,
    MultiLangFixture,
    PromotionResult,
    RuleCandidate,
    ScrutinyEvaluationResult,
} from './types';
import type { AnalyzerContext, AnalyzerId } from '../../types';
import type { RuleFamily } from '../types';
import { auditVacuousWrappers, HYG_WRAP_RULE_ID } from './wrapperRule';
import {
    checkJsTsSilentExceptions,
    checkPythonSilentExceptions,
    GOV_EXC_SILENT_RULE_ID,
} from './silentExceptionRule';
import { ARCH_DISP_RULE_ID, auditDispatchComplexity } from './dispatchComplexityRule';

// ── Language and Extension Literals ──────────────────────────────────────────
const LANG_TS: MultiLangFixture['language'] = 'typescript';
const LANG_PY: MultiLangFixture['language'] = 'python';
const LANG_RS: MultiLangFixture['language'] = 'rust';
const LANG_GO: MultiLangFixture['language'] = 'go';
const LANG_JS: MultiLangFixture['language'] = 'javascript';
const LANG_GD: MultiLangFixture['language'] = 'gdscript';

const EXT_TS = '.ts';
const EXT_PY = '.py';
const EXT_RS = '.rs';
const EXT_GO = '.go';
const FIXTURE_PATH_BASE = 'test/fixture';

// ── Foundational Candidate Identifiers ───────────────────────────────────────
const ID_WRAP = 'cand-hyg-wrap';
const ID_EXC = 'cand-gov-exc';
const ID_DISP = 'cand-arch-disp';

const TITLE_WRAP = 'Vacuous Forwarding Wrapper Detection';
const TITLE_EXC = 'Pseudo-Catch Silent Exception Swallowing Detection';
const TITLE_DISP = 'Monolithic Dispatcher Branch Complexity Detection';

const FAMILY_HYG: RuleFamily = 'HYG';
const FAMILY_GOV: RuleFamily = 'GOV';
const FAMILY_ARCH: RuleFamily = 'ARCH';

const TARGET_HYG: AnalyzerId = 'hygiene';
const TARGET_GOV: AnalyzerId = 'governance';
const TARGET_ARCH: AnalyzerId = 'architecture';

const LEVEL_UNIV: GeneralizationLevel = 'universal';
const LEVEL_FAM: GeneralizationLevel = 'language_family';
const LEVEL_PROJ: GeneralizationLevel = 'project_specific';
const STATUS_PROMOTED = 'promoted' as const;

const ORIGIN_SELF = 'Generalization Self-Refactor';

const BAD_WRAP = 'Transparent 1:1 parameter passthrough wrapper with zero added semantics.';
const GOOD_WRAP = 'Direct callee invocation, decorator pattern, or validation in wrapper.';
const BAD_EXC = 'Catch block containing only dummy statements (void 0, dummy assignment).';
const GOOD_EXC = 'Structured logging, re-throw, or explicit rationale comment.';
const BAD_DISP = 'Large monolithic switch dispatcher with > 8 procedural branches.';
const GOOD_DISP = 'Table-driven lookup or Strategy Pattern.';

const RISK_LOW = 'low' as const;
const PERF_NEGLIGIBLE = 'negligible' as const;
const REVIEW_DATE = '2026-09-19';

const JUSTIFY_WRAP =
    'Redundant forwarding functions artificially inflate codebase volume ' +
    'and reduce effective code density across all languages.';
const JUSTIFY_EXC =
    'Dummy statements inside catch blocks bypass empty-catch linting ' +
    'while still silently hiding critical failures.';
const JUSTIFY_DISP =
    'Oversized branching dispatchers violate Open-Closed Principle ' +
    'and cause tight procedural coupling across multiple domains.';

const REJECT_PROJECT_SPECIFIC =
    'Pattern is project-specific; cannot be promoted to global rule library';
const REJECT_FIXTURES_FAILED = 'Cross-language test fixtures failed validation';

const LAYER_UNIV = 'layer1_universal';
const LAYER_FAM = 'layer2_family';

// ── Fixture Descriptions ─────────────────────────────────────────────────────
const DESC_WRAP_TS = 'TypeScript transparent 1:1 parameter forwarding without validation.';
const DESC_WRAP_PY = 'Python transparent parameter forwarding without transformation.';
const DESC_WRAP_RS = 'Rust transparent delegation without documentation exemption.';
const DESC_WRAP_GO = 'Go transparent parameter forwarding without exemption rationale.';
const DESC_EXC_TS = 'TypeScript pseudo-catch with void 0 and no rationale marker.';
const DESC_EXC_PY = 'Python except clause with dummy assignment and no comment.';
const DESC_DISP_TS = 'Monolithic switch statement with 9 separate procedural branches.';

// ── Fixture Code Samples (Single-line escaped to prevent false positive scans) ─
const RAW_WRAP_TS_NEG =
    '\nfunction forwardQuery(id: string, count: number): Result {\n    return this.target.fetchData(id, count);\n}\n';
const RAW_WRAP_TS_POS =
    '\nfunction forwardQuery(id: string, count: number): Result {\n    if (count <= 0) throw new Error("Invalid count");\n    return this.target.fetchData(id, count);\n}\n';
const RAW_WRAP_PY_NEG =
    '\ndef _fetch_user(user_id, mode):\n    return self.client.get_user(user_id, mode)\n';
const RAW_WRAP_PY_POS =
    '\ndef _fetch_user(user_id, mode):\n    # Logging added\n    logger.info("Fetching user %s", user_id)\n    return self.client.get_user(user_id, mode)\n';
const RAW_WRAP_RS_NEG =
    '\nfn dispatch_event(id: u64, code: u32) -> Result {\n    self.inner.dispatch(id, code)\n}\n';
const RAW_WRAP_RS_POS =
    '\n/// @override inner.dispatch delegation\nfn dispatch_event(id: u64, code: u32) -> Result {\n    self.inner.dispatch(id, code)\n}\n';
const RAW_WRAP_GO_NEG =
    '\nfunc forwardQuery(id string, count int) Result {\n    return target.fetchData(id, count)\n}\n';
const RAW_WRAP_GO_POS =
    '\n// interface implementation proxy\nfunc forwardQuery(id string, count int) Result {\n    return target.fetchData(id, count)\n}\n';

const RAW_EXC_TS_NEG = '\ntry {\n    performTask();\n} catch (err) {\n    void 0;\n}\n';
const RAW_EXC_TS_POS =
    '\ntry {\n    performTask();\n} catch (err) {\n    // best-effort cleanup\n}\n';
const RAW_EXC_PY_NEG = '\ntry:\n    do_something()\nexcept Exception as err:\n    _ = err\n';
const RAW_EXC_PY_POS =
    '\ntry:\n    do_something()\nexcept Exception as err:\n    # expected during shutdown\n    pass\n';

const RAW_DISP_TS_NEG =
    "\nfunction handleEvent(type: string, data: any) {\n    switch (type) {\n        case 'A': performActionA(data); break;\n        case 'B': performActionB(data); break;\n        case 'C': performActionC(data); break;\n        case 'D': performActionD(data); break;\n        case 'E': performActionE(data); break;\n        case 'F': performActionF(data); break;\n        case 'G': performActionG(data); break;\n        case 'H': performActionH(data); break;\n        case 'I': performActionI(data); break;\n        default: break;\n    }\n}\n";
const RAW_DISP_TS_POS =
    '\nconst HANDLER_MAP: Record<string, (d: any) => void> = {\n    A: performActionA,\n    B: performActionB,\n};\nfunction handleEvent(type: string, data: any) {\n    HANDLER_MAP[type]?.(data);\n}\n';

function createMultiLangFixture(
    language: MultiLangFixture['language'],
    negativeSample: string,
    positiveSample: string,
    description: string,
): MultiLangFixture {
    return Object.freeze({
        language,
        negativeSample,
        positiveSample,
        description,
    });
}

/** Pre-packaged multi-language fixtures for HYG-WRAP-001 */
export const WRAPPER_FIXTURES: readonly MultiLangFixture[] = [
    createMultiLangFixture(LANG_TS, RAW_WRAP_TS_NEG, RAW_WRAP_TS_POS, DESC_WRAP_TS),
    createMultiLangFixture(LANG_PY, RAW_WRAP_PY_NEG, RAW_WRAP_PY_POS, DESC_WRAP_PY),
    createMultiLangFixture(LANG_RS, RAW_WRAP_RS_NEG, RAW_WRAP_RS_POS, DESC_WRAP_RS),
    createMultiLangFixture(LANG_GO, RAW_WRAP_GO_NEG, RAW_WRAP_GO_POS, DESC_WRAP_GO),
];

/** Pre-packaged multi-language fixtures for GOV-EXC-003 */
const SILENT_EXC_FIXTURES: readonly MultiLangFixture[] = [
    createMultiLangFixture(LANG_TS, RAW_EXC_TS_NEG, RAW_EXC_TS_POS, DESC_EXC_TS),
    createMultiLangFixture(LANG_PY, RAW_EXC_PY_NEG, RAW_EXC_PY_POS, DESC_EXC_PY),
];

/** Pre-packaged multi-language fixtures for ARCH-DISP-001 */
const DISP_FIXTURES: readonly MultiLangFixture[] = [
    createMultiLangFixture(LANG_TS, RAW_DISP_TS_NEG, RAW_DISP_TS_POS, DESC_DISP_TS),
];

const UNIV_LANGS_WRAP: readonly string[] = [LANG_TS, LANG_JS, LANG_PY, LANG_RS, LANG_GO];
const UNIV_LANGS_EXC: readonly string[] = [LANG_TS, LANG_JS, LANG_PY, LANG_GD];
const UNIV_LANGS_DISP: readonly string[] = [LANG_TS, LANG_JS, LANG_PY, LANG_RS];

interface CandidateDescriptorParams {
    readonly id: string;
    readonly ruleId: string;
    readonly title: string;
    readonly family: RuleFamily;
    readonly analyzer: AnalyzerId;
    readonly level: GeneralizationLevel;
    readonly badPattern: string;
    readonly goodPattern: string;
    readonly fixtures: readonly MultiLangFixture[];
    readonly justification: string;
    readonly languages: readonly string[];
}

function createCandidateDescriptor(params: CandidateDescriptorParams): RuleCandidate {
    return {
        id: params.id,
        canonicalRuleId: params.ruleId,
        title: params.title,
        family: params.family,
        targetAnalyzer: params.analyzer,
        level: params.level,
        status: STATUS_PROMOTED,
        origin: ORIGIN_SELF,
        badPattern: params.badPattern,
        goodPattern: params.goodPattern,
        fixtures: params.fixtures,
        scrutiny: {
            candidateId: params.id,
            evaluatedLevel: params.level,
            falsePositiveRisk: RISK_LOW,
            performanceOverhead: PERF_NEGLIGIBLE,
            justification: params.justification,
            universalAcrossLanguages: params.languages,
            reviewedAt: REVIEW_DATE,
        },
    };
}

/** Initial foundational candidates extracted from self-refactoring generalization */
const FOUNDATIONAL_CANDIDATES: readonly RuleCandidate[] = [
    createCandidateDescriptor({
        id: ID_WRAP,
        ruleId: HYG_WRAP_RULE_ID,
        title: TITLE_WRAP,
        family: FAMILY_HYG,
        analyzer: TARGET_HYG,
        level: LEVEL_UNIV,
        badPattern: BAD_WRAP,
        goodPattern: GOOD_WRAP,
        fixtures: WRAPPER_FIXTURES,
        justification: JUSTIFY_WRAP,
        languages: UNIV_LANGS_WRAP,
    }),
    createCandidateDescriptor({
        id: ID_EXC,
        ruleId: GOV_EXC_SILENT_RULE_ID,
        title: TITLE_EXC,
        family: FAMILY_GOV,
        analyzer: TARGET_GOV,
        level: LEVEL_FAM,
        badPattern: BAD_EXC,
        goodPattern: GOOD_EXC,
        fixtures: SILENT_EXC_FIXTURES,
        justification: JUSTIFY_EXC,
        languages: UNIV_LANGS_EXC,
    }),
    createCandidateDescriptor({
        id: ID_DISP,
        ruleId: ARCH_DISP_RULE_ID,
        title: TITLE_DISP,
        family: FAMILY_ARCH,
        analyzer: TARGET_ARCH,
        level: LEVEL_UNIV,
        badPattern: BAD_DISP,
        goodPattern: GOOD_DISP,
        fixtures: DISP_FIXTURES,
        justification: JUSTIFY_DISP,
        languages: UNIV_LANGS_DISP,
    }),
];

function buildScrutinyOutcome(
    candidateId: string,
    passed: boolean,
    level: GeneralizationLevel,
    eligible: boolean,
    rejectionReason?: string,
): ScrutinyEvaluationResult {
    return Object.freeze({
        candidateId,
        passed,
        determinedLevel: level,
        eligibleForPromotion: eligible,
        rejectionReason,
    });
}

/**
 * Pipeline managing rule candidates, 4-tier scrutiny evaluation, and graduation.
 */
export class RuleGeneralizationPipeline {
    private readonly candidates = new Map<string, RuleCandidate>();

    constructor() {
        for (const cand of FOUNDATIONAL_CANDIDATES) {
            this.candidates.set(cand.id, cand);
        }
    }

    /** Registers a new candidate into the evolution repository. */
    public registerCandidate(candidate: RuleCandidate): void {
        this.candidates.set(candidate.id, candidate);
    }

    /** Retrieves a candidate by identifier. */
    public getCandidate(id: string): RuleCandidate | undefined {
        return !id ? undefined : this.candidates.get(id);
    }

    /** Lists all registered candidates matching optional filters. */
    public getCandidates(filter?: { level?: GeneralizationLevel }): RuleCandidate[] {
        const all = Array.from(this.candidates.values());
        return !filter?.level ? all : all.filter((c) => c.level === filter.level);
    }

    /** Backward-compatible alias for getCandidates. */
    public readonly listCandidates = (filter?: { level?: GeneralizationLevel }): RuleCandidate[] =>
        this.getCandidates(filter);

    /** Evaluates 4-tier generalization scrutiny for a given candidate. */
    public evaluateScrutiny(candidateId: string): ScrutinyEvaluationResult {
        const candidate = this.candidates.get(candidateId);
        if (!candidate) {
            return buildScrutinyOutcome(
                candidateId,
                false,
                LEVEL_PROJ,
                false,
                `Candidate '${candidateId}' not found`,
            );
        }

        // Tier 0 Check: Project-specific patterns cannot be promoted globally
        if (candidate.level === LEVEL_PROJ) {
            return buildScrutinyOutcome(
                candidateId,
                false,
                LEVEL_PROJ,
                false,
                REJECT_PROJECT_SPECIFIC,
            );
        }

        // Multi-language verification check
        if (!this.verifyFixtures(candidate)) {
            return buildScrutinyOutcome(
                candidateId,
                false,
                candidate.level,
                false,
                REJECT_FIXTURES_FAILED,
            );
        }

        return buildScrutinyOutcome(candidateId, true, candidate.level, true);
    }

    /** Promotes an eligible candidate to canonical production status. */
    public applyCandidatePromotion(candidateId: string): PromotionResult {
        const scrutiny = this.evaluateScrutiny(candidateId);
        if (!scrutiny.eligibleForPromotion) {
            throw new Error(
                `Cannot promote candidate '${candidateId}': ${scrutiny.rejectionReason}`,
            );
        }

        const candidate = this.candidates.get(candidateId)!;
        candidate.status = STATUS_PROMOTED;

        const ruleLayer = candidate.level === LEVEL_UNIV ? LAYER_UNIV : LAYER_FAM;

        return {
            candidateId: candidate.id,
            canonicalRuleId: candidate.canonicalRuleId,
            promotedAt: new Date().toISOString(),
            targetAnalyzer: candidate.targetAnalyzer,
            ruleLayer,
            verifiedLanguages: candidate.fixtures.map((f) => f.language),
        };
    }

    /** Backward-compatible alias for applyCandidatePromotion. */
    public readonly promoteCandidate = (candidateId: string): PromotionResult =>
        this.applyCandidatePromotion(candidateId);

    /** Executes cross-language fixtures for a candidate against rule detectors. */
    private verifyFixtures(candidate: RuleCandidate): boolean {
        for (const fixture of candidate.fixtures) {
            if (!this.verifySingleFixture(candidate.canonicalRuleId, fixture)) {
                return false;
            }
        }
        return true;
    }

    private resolveFixtureExtension(language: string): string {
        if (language === LANG_PY) return EXT_PY;
        if (language === LANG_RS) return EXT_RS;
        return language === LANG_GO ? EXT_GO : EXT_TS;
    }

    private verifySingleFixture(canonicalRuleId: string, fixture: MultiLangFixture): boolean {
        const ext = this.resolveFixtureExtension(fixture.language);
        const fixturePath = `${FIXTURE_PATH_BASE}${ext}`;
        const fakeCtx: Partial<AnalyzerContext> = {
            filePath: fixturePath,
            content: fixture.negativeSample,
            options: {},
        };
        const ctx = fakeCtx as AnalyzerContext;

        if (canonicalRuleId === HYG_WRAP_RULE_ID) {
            return this.verifyWrapperFixture(fixture, fixturePath, ctx);
        }
        if (canonicalRuleId === GOV_EXC_SILENT_RULE_ID) {
            return this.verifySilentExceptionFixture(fixture);
        }
        if (canonicalRuleId === ARCH_DISP_RULE_ID) {
            return this.verifyDispatchFixture(fixture, fixturePath, ctx);
        }
        return false;
    }

    private verifyWrapperFixture(
        fixture: MultiLangFixture,
        fixturePath: string,
        ctx: AnalyzerContext,
    ): boolean {
        const negDetected =
            auditVacuousWrappers(fixture.negativeSample, fixturePath, ctx).length > 0;
        const posDetected =
            auditVacuousWrappers(fixture.positiveSample, fixturePath, ctx).length > 0;
        return negDetected && !posDetected;
    }

    private verifySilentExceptionFixture(fixture: MultiLangFixture): boolean {
        const linesNeg = fixture.negativeSample.split('\n');
        const linesPos = fixture.positiveSample.split('\n');
        const isPython = fixture.language === LANG_PY;
        const negDetected = isPython
            ? checkPythonSilentExceptions(linesNeg).length > 0
            : checkJsTsSilentExceptions(linesNeg).length > 0;
        const posDetected = isPython
            ? checkPythonSilentExceptions(linesPos).length > 0
            : checkJsTsSilentExceptions(linesPos).length > 0;
        return negDetected && !posDetected;
    }

    private verifyDispatchFixture(
        fixture: MultiLangFixture,
        fixturePath: string,
        ctx: AnalyzerContext,
    ): boolean {
        const negDetected =
            auditDispatchComplexity(fixture.negativeSample, fixturePath, ctx).length > 0;
        const posDetected =
            auditDispatchComplexity(fixture.positiveSample, fixturePath, ctx).length > 0;
        return negDetected && !posDetected;
    }
}

/** Global default generalization pipeline singleton */
export const defaultGeneralizationPipeline = new RuleGeneralizationPipeline();
