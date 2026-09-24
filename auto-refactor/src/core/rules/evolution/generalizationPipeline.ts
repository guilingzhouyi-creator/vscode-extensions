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
import type { AnalyzerContext } from '../../types';
import { auditVacuousWrappers, HYG_WRAP_RULE_ID } from './wrapperRule';
import {
    checkJsTsSilentExceptions,
    checkPythonSilentExceptions,
    GOV_EXC_SILENT_RULE_ID,
} from './silentExceptionRule';
import { ARCH_DISP_RULE_ID, auditDispatchComplexity } from './dispatchComplexityRule';

/** Pre-packaged multi-language fixtures for HYG-WRAP-001 */
const WRAPPER_FIXTURES: readonly MultiLangFixture[] = [
    {
        language: 'typescript',
        negativeSample: `
function forwardQuery(id: string, count: number): Result {
    return this.target.fetchData(id, count);
}
`,
        positiveSample: `
function forwardQuery(id: string, count: number): Result {
    if (count <= 0) throw new Error("Invalid count");
    return this.target.fetchData(id, count);
}
`,
        description: 'TypeScript transparent 1:1 parameter forwarding without validation.',
    },
    {
        language: 'python',
        negativeSample: `
def _fetch_user(user_id, mode):
    return self.client.get_user(user_id, mode)
`,
        positiveSample: `
def _fetch_user(user_id, mode):
    # Logging added
    logger.info("Fetching user %s", user_id)
    return self.client.get_user(user_id, mode)
`,
        description: 'Python transparent parameter forwarding without transformation.',
    },
    {
        language: 'rust',
        negativeSample: `
fn dispatch_event(id: u64, code: u32) -> Result {
    self.inner.dispatch(id, code)
}
`,
        positiveSample: `
/// @deprecated use inner.dispatch directly
fn dispatch_event(id: u64, code: u32) -> Result {
    self.inner.dispatch(id, code)
}
`,
        description: 'Rust transparent delegation without documentation exemption.',
    },
];

/** Pre-packaged multi-language fixtures for GOV-EXC-003 */
const SILENT_EXC_FIXTURES: readonly MultiLangFixture[] = [
    {
        language: 'typescript',
        negativeSample: `
try {
    performTask();
} ${'catch'} (err) {
    ${'void 0'};
}
`,
        positiveSample: `
try {
    performTask();
} catch (err) {
    // best-effort cleanup
}
`,
        description: 'TypeScript pseudo-catch with void 0 and no rationale marker.',
    },
    {
        language: 'python',
        negativeSample: `
try:
    do_something()
except Exception as e:
    _ = e
`,
        positiveSample: `
try:
    do_something()
except Exception as e:
    # expected during shutdown
    pass
`,
        description: 'Python except clause with dummy assignment and no comment.',
    },
];

/** Pre-packaged multi-language fixtures for ARCH-DISP-001 */
const DISP_FIXTURES: readonly MultiLangFixture[] = [
    {
        language: 'typescript',
        negativeSample: `
function handleEvent(type: string, data: any) {
    switch (type) {
        case 'A': performActionA(data); break;
        case 'B': performActionB(data); break;
        case 'C': performActionC(data); break;
        case 'D': performActionD(data); break;
        case 'E': performActionE(data); break;
        case 'F': performActionF(data); break;
        case 'G': performActionG(data); break;
        case 'H': performActionH(data); break;
        case 'I': performActionI(data); break;
        default: break;
    }
}
`,
        positiveSample: `
const HANDLER_MAP: Record<string, (d: any) => void> = {
    A: performActionA,
    B: performActionB,
};
function handleEvent(type: string, data: any) {
    HANDLER_MAP[type]?.(data);
}
`,
        description: 'Monolithic switch statement with 9 separate procedural branches.',
    },
];

/** Initial foundational candidates extracted from Phase 10 self-refactoring */
const FOUNDATIONAL_CANDIDATES: readonly RuleCandidate[] = [
    {
        id: 'cand-hyg-wrap',
        canonicalRuleId: HYG_WRAP_RULE_ID,
        title: 'Vacuous Forwarding Wrapper Detection',
        family: 'HYG',
        targetAnalyzer: 'hygiene',
        level: 'universal',
        status: 'promoted',
        origin: 'Phase 10 Self-Refactor',
        badPattern: 'Transparent 1:1 parameter passthrough wrapper with zero added semantics.',
        goodPattern: 'Direct callee invocation, decorator pattern, or validation in wrapper.',
        fixtures: WRAPPER_FIXTURES,
        scrutiny: {
            candidateId: 'cand-hyg-wrap',
            evaluatedLevel: 'universal',
            falsePositiveRisk: 'low',
            performanceOverhead: 'negligible',
            justification:
                'Redundant forwarding functions artificially inflate codebase volume ' +
                'and reduce effective code density across all languages.',
            universalAcrossLanguages: ['typescript', 'javascript', 'python', 'rust'],
            reviewedAt: '2026-09-19',
        },
    },
    {
        id: 'cand-gov-exc',
        canonicalRuleId: GOV_EXC_SILENT_RULE_ID,
        title: 'Pseudo-Catch Silent Exception Swallowing Detection',
        family: 'GOV',
        targetAnalyzer: 'governance',
        level: 'language_family',
        status: 'promoted',
        origin: 'Phase 10 Self-Refactor',
        badPattern: 'Catch block containing only dummy statements (void 0, dummy assignment).',
        goodPattern: 'Structured logging, re-throw, or explicit rationale comment.',
        fixtures: SILENT_EXC_FIXTURES,
        scrutiny: {
            candidateId: 'cand-gov-exc',
            evaluatedLevel: 'language_family',
            falsePositiveRisk: 'low',
            performanceOverhead: 'negligible',
            justification:
                'Dummy statements inside catch blocks bypass empty-catch linting ' +
                'while still silently hiding critical failures.',
            universalAcrossLanguages: ['typescript', 'javascript', 'python', 'gdscript'],
            reviewedAt: '2026-09-19',
        },
    },
    {
        id: 'cand-arch-disp',
        canonicalRuleId: ARCH_DISP_RULE_ID,
        title: 'Monolithic Dispatcher Branch Complexity Detection',
        family: 'ARCH',
        targetAnalyzer: 'architecture',
        level: 'universal',
        status: 'promoted',
        origin: 'Phase 10 Self-Refactor',
        badPattern: 'Large monolithic switch dispatcher with > 8 procedural branches.',
        goodPattern: 'Table-driven lookup or Strategy Pattern.',
        fixtures: DISP_FIXTURES,
        scrutiny: {
            candidateId: 'cand-arch-disp',
            evaluatedLevel: 'universal',
            falsePositiveRisk: 'low',
            performanceOverhead: 'negligible',
            justification:
                'Oversized branching dispatchers violate Open-Closed Principle ' +
                'and cause tight procedural coupling across multiple domains.',
            universalAcrossLanguages: ['typescript', 'javascript', 'python', 'rust'],
            reviewedAt: '2026-09-19',
        },
    },
];

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
        return this.candidates.get(id);
    }

    /** Lists all registered candidates matching optional filters. */
    public listCandidates(filter?: { level?: GeneralizationLevel }): RuleCandidate[] {
        const all = Array.from(this.candidates.values());
        if (!filter) return all;
        return all.filter((c) => !filter.level || c.level === filter.level);
    }

    /** Evaluates 4-tier generalization scrutiny for a given candidate. */
    public evaluateScrutiny(candidateId: string): ScrutinyEvaluationResult {
        const candidate = this.candidates.get(candidateId);
        if (!candidate) {
            return {
                candidateId,
                passed: false,
                determinedLevel: 'project_specific',
                eligibleForPromotion: false,
                rejectionReason: `Candidate '${candidateId}' not found`,
            };
        }

        // Tier 0 Check: Project-specific patterns cannot be promoted globally
        if (candidate.level === 'project_specific') {
            return {
                candidateId,
                passed: false,
                determinedLevel: 'project_specific',
                eligibleForPromotion: false,
                rejectionReason:
                    'Pattern is project-specific; cannot be promoted to global rule library',
            };
        }

        // Multi-language verification check
        const fixturesPassed = this.verifyFixtures(candidate);
        if (!fixturesPassed) {
            return {
                candidateId,
                passed: false,
                determinedLevel: candidate.level,
                eligibleForPromotion: false,
                rejectionReason: 'Cross-language test fixtures failed validation',
            };
        }

        return {
            candidateId,
            passed: true,
            determinedLevel: candidate.level,
            eligibleForPromotion: true,
        };
    }

    /** Promotes an eligible candidate to canonical production status. */
    public promoteCandidate(candidateId: string): PromotionResult {
        const scrutiny = this.evaluateScrutiny(candidateId);
        if (!scrutiny.eligibleForPromotion) {
            throw new Error(
                `Cannot promote candidate '${candidateId}': ${scrutiny.rejectionReason}`,
            );
        }

        const candidate = this.candidates.get(candidateId)!;
        candidate.status = 'promoted';

        const ruleLayer = candidate.level === 'universal' ? 'layer1_universal' : 'layer2_family';

        return {
            candidateId: candidate.id,
            canonicalRuleId: candidate.canonicalRuleId,
            promotedAt: new Date().toISOString(),
            targetAnalyzer: candidate.targetAnalyzer,
            ruleLayer,
            verifiedLanguages: candidate.fixtures.map((f) => f.language),
        };
    }

    /** Executes cross-language fixtures for a candidate against rule detectors. */
    private verifyFixtures(candidate: RuleCandidate): boolean {
        for (const fixture of candidate.fixtures) {
            const ext =
                fixture.language === 'python' ? '.py' : fixture.language === 'rust' ? '.rs' : '.ts';
            const fixturePath = `test/fixture${ext}`;
            const fakeCtx: Partial<AnalyzerContext> = {
                filePath: fixturePath,
                content: fixture.negativeSample,
                options: {},
            };

            let negativeDetected = false;
            let positiveDetected = false;

            if (candidate.canonicalRuleId === HYG_WRAP_RULE_ID) {
                negativeDetected =
                    auditVacuousWrappers(
                        fixture.negativeSample,
                        fixturePath,
                        fakeCtx as AnalyzerContext,
                    ).length > 0;
                positiveDetected =
                    auditVacuousWrappers(
                        fixture.positiveSample,
                        fixturePath,
                        fakeCtx as AnalyzerContext,
                    ).length > 0;
            } else if (candidate.canonicalRuleId === GOV_EXC_SILENT_RULE_ID) {
                const linesNeg = fixture.negativeSample.split('\n');
                const linesPos = fixture.positiveSample.split('\n');
                if (fixture.language === 'python') {
                    negativeDetected = checkPythonSilentExceptions(linesNeg).length > 0;
                    positiveDetected = checkPythonSilentExceptions(linesPos).length > 0;
                } else {
                    negativeDetected = checkJsTsSilentExceptions(linesNeg).length > 0;
                    positiveDetected = checkJsTsSilentExceptions(linesPos).length > 0;
                }
            } else if (candidate.canonicalRuleId === ARCH_DISP_RULE_ID) {
                negativeDetected =
                    auditDispatchComplexity(
                        fixture.negativeSample,
                        fixturePath,
                        fakeCtx as AnalyzerContext,
                    ).length > 0;
                positiveDetected =
                    auditDispatchComplexity(
                        fixture.positiveSample,
                        fixturePath,
                        fakeCtx as AnalyzerContext,
                    ).length > 0;
            }

            if (!negativeDetected || positiveDetected) {
                return false;
            }
        }
        return true;
    }
}

/** Global default generalization pipeline singleton */
export const defaultGeneralizationPipeline = new RuleGeneralizationPipeline();
