/**
 * Module: Core Engine — Agent Constraint Guidance
 * File Path: src/core/guidance/agentConstraintGenerator.ts
 * Architecture Role: Guidance-layer generator that converts review memory and change
 *                    trajectory facts into a localized agent constraint prompt; it is a
 *                    deterministic, non-persistent producer at the API/pipeline boundary.
 * Dependencies & Triggers: Imports ReviewMemoryRecord and CodeDomainFingerprint from
 *                          ../memory/types, FileChangeTrajectory from ../trajectory/types,
 *                          and GuidanceMessages from ../messages; triggered by the
 *                          queryAgentConstraints API and the FastTrack pipeline stage.
 * Responsibilities: Resolve the target domain by explicit name or line span, emit
 *                   layer-specific hard constraints, extract per-domain violations or up
 *                   to five memory rule hits, collect matching trajectory anomalies, always
 *                   add three recommended patterns, and render the prompt plus Markdown.
 * Exit Semantics & Design Rationale: Always returns an AgentConstraintPrompt; absent memory,
 *                   trajectory, domain, or layer degrades to narrower guidance rather than
 *                   throwing, so advisory generation cannot break an agent's edit path.
 */
import type { ReviewMemoryRecord, CodeDomainFingerprint } from '../memory/types';
import type { FileChangeTrajectory } from '../trajectory/types';
import type { Issue, AgentActionablePayload } from '../types';
import { GuidanceMessages } from '../messages';
import type {
    AgentTopologyLayer,
    AgentImmutableConstraints,
    AgentVerificationDirective,
    AgentClarificationRequest,
} from '../reporters/agent-directives-types';

/** Maximum number of memory rule hits rendered as frequent violations in the guidance prompt. */
const MAX_MEMORY_RULE_HITS = 5;

/**
 * Caller-supplied target selector for AgentConstraintGenerator.generate.
 *
 * `filePath` is required; the optional fields narrow the guidance to a named domain, a
 * line inside a remembered domain, a specific agent UID, or an explicit architectural
 * layer. Omitted fields fall back to the memory record's layer and whole-file scope.
 */
export interface AgentConstraintOptions {
    filePath: string;
    domainName?: string;
    line?: number;
    agentUid?: string;
    layer?: string;
}

/**
 * Localized, non-persistent guidance payload returned by the generator.
 *
 * Every array is a rendered, human-readable list (possibly empty); `targetDomain` and
 * `layer` stay undefined when the inputs did not identify them; `renderedMarkdown` carries
 * the same content formatted for direct injection into an agent prompt.
 */
export interface AgentConstraintPrompt {
    filePath: string;
    targetDomain?: string;
    layer?: string;
    hardConstraints: string[];
    historicalPitfalls: string[];
    frequentViolations: string[];
    recommendedPatterns: string[];
    renderedMarkdown: string;
}

/**
 * Resolve target code domain fingerprint from options and review memory.
 *
 * @param options - Target file and domain/line selector.
 * @param memory - Review memory record with remembered domains.
 * @returns Matching CodeDomainFingerprint or undefined.
 */
function resolveTargetDomain(
    options: AgentConstraintOptions,
    memory?: ReviewMemoryRecord,
): CodeDomainFingerprint | undefined {
    if (!memory?.codeDomains) return undefined;
    const { domainName, line } = options;

    if (domainName) {
        return memory.codeDomains.find(
            (d) => d.name === domainName || d.name.endsWith('.' + domainName),
        );
    }
    if (line !== undefined) {
        return memory.codeDomains.find((d) => line >= d.span.startLine && line <= d.span.endLine);
    }
    return undefined;
}

/**
 * Resolve architecture layer hard constraints based on layer keyword.
 *
 * @param effectiveLayer - Optional detected architectural layer.
 * @returns Array of localized hard constraint messages.
 */
function resolveHardConstraints(effectiveLayer?: string): string[] {
    const hardConstraints: string[] = [];
    if (!effectiveLayer) return hardConstraints;

    if (effectiveLayer === 'domain') {
        hardConstraints.push(GuidanceMessages.DOMAIN_LAYER_HARD);
        hardConstraints.push(GuidanceMessages.DOMAIN_PURITY_HARD);
    } else if (effectiveLayer === 'infrastructure') {
        hardConstraints.push(GuidanceMessages.INFRA_RESPONSIBILITY_HARD);
    } else if (effectiveLayer === 'interface' || effectiveLayer === 'frontend') {
        hardConstraints.push(GuidanceMessages.INTERFACE_BOUNDARY_HARD);
    }
    return hardConstraints;
}

/**
 * Extract frequent violations from domain fingerprint or review memory.
 *
 * @param targetDomainObj - Optional identified domain fingerprint.
 * @param memory - Optional review memory record.
 * @returns Formatted violation descriptions.
 */
function extractMemoryViolations(
    targetDomainObj?: CodeDomainFingerprint,
    memory?: ReviewMemoryRecord,
): string[] {
    const frequentViolations: string[] = [];

    if (targetDomainObj) {
        for (const v of targetDomainObj.ruleViolations) {
            frequentViolations.push(
                GuidanceMessages.FORMAT_VIOLATION_WITH_SEVERITY(v.rule, v.severity, v.message),
            );
        }
    } else if (memory) {
        for (const h of memory.ruleHits.slice(0, MAX_MEMORY_RULE_HITS)) {
            frequentViolations.push(GuidanceMessages.FORMAT_VIOLATION(h.rule, h.line, h.message));
        }
    }

    return frequentViolations;
}

/**
 * Extract historical pitfalls from change trajectory anomalies.
 *
 * @param trajectory - Optional file change trajectory.
 * @param targetDomainObj - Optional identified domain fingerprint.
 * @returns Formatted pitfall messages.
 */
function extractTrajectoryPitfalls(
    trajectory?: FileChangeTrajectory,
    targetDomainObj?: CodeDomainFingerprint,
): string[] {
    const historicalPitfalls: string[] = [];
    if (!trajectory) return historicalPitfalls;

    for (const a of trajectory.activeAnomalies) {
        if (!targetDomainObj || !a.domainId || a.domainId === targetDomainObj.domainId) {
            historicalPitfalls.push(GuidanceMessages.FORMAT_PITFALL(a.kind, a.message));
        }
    }

    return historicalPitfalls;
}

/**
 * Render complete guidance prompt into formatted Markdown lines.
 *
 * @param filePath - Path to the audited target file.
 * @param domainTitle - Formatted domain scope title.
 * @param effectiveLayer - Effective architectural layer.
 * @param hardConstraints - Array of hard constraints.
 * @param historicalPitfalls - Array of historical pitfalls.
 * @param frequentViolations - Array of frequent violations.
 * @param recommendedPatterns - Array of recommended patterns.
 * @returns Joined Markdown string.
 */
function renderGuidanceMarkdown(
    filePath: string,
    domainTitle: string,
    effectiveLayer: string | undefined,
    hardConstraints: string[],
    historicalPitfalls: string[],
    frequentViolations: string[],
    recommendedPatterns: string[],
): string {
    const lines: string[] = [
        GuidanceMessages.TITLE_LOCAL_GUARDRAILS(filePath),
        GuidanceMessages.TARGET_SCOPE_LABEL(domainTitle, effectiveLayer),
        '',
    ];

    if (hardConstraints.length > 0) {
        lines.push(GuidanceMessages.SECTION_HARD_CONSTRAINTS);
        for (const c of hardConstraints) lines.push(`- ⚠️ ${c}`);
        lines.push('');
    }

    if (historicalPitfalls.length > 0) {
        lines.push(GuidanceMessages.SECTION_HISTORICAL_PITFALLS);
        for (const p of historicalPitfalls) lines.push(`- ❌ ${p}`);
        lines.push('');
    }

    if (frequentViolations.length > 0) {
        lines.push(GuidanceMessages.SECTION_FREQUENT_VIOLATIONS);
        for (const v of frequentViolations) lines.push(`- 🔍 ${v}`);
        lines.push('');
    }

    lines.push(GuidanceMessages.SECTION_RECOMMENDED_PATTERNS);
    for (const r of recommendedPatterns) lines.push(`- ✨ ${r}`);
    lines.push('');

    return lines.join('\n');
}

/**
 * Stateless generator that turns review memory and change trajectory into agent guardrails.
 *
 * `generate` reads only its arguments and returns a fresh prompt; missing memory, trajectory,
 * domain, or layer degrades to narrower guidance instead of throwing. The class holds no
 * mutable fields, so independent calls are deterministic and safe to repeat.
 */
export class AgentConstraintGenerator {
    /**
     * Dynamically generate high-purity, localized constraints for an Agent before modifying
     * code.
     *
     * @param options - Target file plus optional domain, line, agent UID, and layer hints.
     * @param memory - Review memory whose domains and rule hits seed the guidance.
     * @param trajectory - Optional change trajectory supplying historical anomalies.
     * @returns A prompt with hard constraints, pitfalls, violations, patterns, and Markdown.
     */
    generate(
        options: AgentConstraintOptions,
        memory?: ReviewMemoryRecord,
        trajectory?: FileChangeTrajectory,
    ): AgentConstraintPrompt {
        const { filePath, layer } = options;

        const targetDomainObj = resolveTargetDomain(options, memory);
        const effectiveLayer = layer || memory?.contextWindows?.layer;

        const hardConstraints = resolveHardConstraints(effectiveLayer);
        const frequentViolations = extractMemoryViolations(targetDomainObj, memory);
        const historicalPitfalls = extractTrajectoryPitfalls(trajectory, targetDomainObj);
        const recommendedPatterns = [
            GuidanceMessages.RECOMMEND_MODERN_TYPES,
            GuidanceMessages.RECOMMEND_ZERO_LOOP_ALLOC,
            GuidanceMessages.RECOMMEND_DOC_INTENT,
        ];

        const domainTitle = targetDomainObj
            ? `\`${targetDomainObj.name}\` (${targetDomainObj.kind})`
            : 'Whole File Scope';

        const renderedMarkdown = renderGuidanceMarkdown(
            filePath,
            domainTitle,
            effectiveLayer,
            hardConstraints,
            historicalPitfalls,
            frequentViolations,
            recommendedPatterns,
        );

        return {
            filePath,
            targetDomain: targetDomainObj?.name,
            layer: effectiveLayer,
            hardConstraints,
            historicalPitfalls,
            frequentViolations,
            recommendedPatterns,
            renderedMarkdown,
        };
    }
}

const VERDICT_BLOCK = 'BLOCK' as const;
const VERDICT_WARN = 'WARN' as const;
const VERDICT_INFO = 'INFO' as const;
const VERDICT_PASS = 'PASS' as const;
const SEVERITY_ERROR = 'error' as const;
const SEVERITY_WARNING = 'warning' as const;
const CHARS_PER_TOKEN = 4;
const BASELINE_CHARS_PER_DIRECTIVE = 600;
const BASELINE_HEADER_CHARS = 200;
const ZERO_DIRECTIVE_SAVINGS_RATIO = 0.95;

/** Directive level in Compact Agent Prompt Protocol (CAPP). */
export type CompactDirectiveSeverity =
    typeof VERDICT_BLOCK | typeof VERDICT_WARN | typeof VERDICT_INFO;

/**
 * Single actionable guard directive tailored for Agent context windows.
 */
export interface CompactGuardDirective {
    severity: CompactDirectiveSeverity;
    ruleId: string;
    file: string;
    line: number;
    summary: string;
    fixHint?: string;
    actionable?: AgentActionablePayload;
    directiveType?: 'GUARD' | 'CLARIFY';
    clarificationRequest?: AgentClarificationRequest;
    renderedDirective: string;
}

/**
 * Compact Agent Prompt Protocol (CAPP) verdict payload.
 *
 * Delivers >80% token compression compared to human-oriented Markdown,
 * focusing exclusively on actionable directives within active edit scopes.
 */
export interface CompactAgentPrompt {
    protocolVersion: '1.0' | '2.0';
    target: string;
    verdict: typeof VERDICT_PASS | typeof VERDICT_WARN | typeof VERDICT_BLOCK;
    directives: CompactGuardDirective[];
    renderedDirectives: string[];
    compactPromptText: string;
    estimatedTokens: number;
    tokenSavingsRatio: number;
}

/**
 * Safely extracts clarification request from an Issue if present.
 *
 * @param issue - Static analysis finding.
 * @returns AgentClarificationRequest or undefined.
 */
export function extractClarificationRequest(issue: Issue): AgentClarificationRequest | undefined {
    const raw =
        (issue as unknown as Record<string, unknown>).clarificationRequest ??
        issue.detail?.clarificationRequest ??
        (issue.actionable as unknown as Record<string, unknown> | undefined)?.clarificationRequest;
    if (raw && typeof raw === 'object' && 'promptQuestion' in (raw as Record<string, unknown>)) {
        return raw as AgentClarificationRequest;
    }
    return undefined;
}

/**
 * Table-driven mapping from Issue severity to compact directive severity verdict.
 */
const DIRECTIVE_SEVERITY_MAP: Record<string, CompactDirectiveSeverity> = {
    [SEVERITY_ERROR]: VERDICT_BLOCK,
    [SEVERITY_WARNING]: VERDICT_WARN,
    info: VERDICT_INFO,
};

function resolveDirectiveSeverity(severity: string | undefined): CompactDirectiveSeverity {
    if (severity && severity in DIRECTIVE_SEVERITY_MAP) {
        return DIRECTIVE_SEVERITY_MAP[severity];
    }
    return VERDICT_INFO;
}

function resolveFileBasename(filePath: string | undefined): string {
    const raw = filePath || 'unknown';
    if (!raw.includes('/') && !raw.includes('\\')) {
        return raw;
    }
    return raw.split(/[/\\]/).pop() || raw;
}

function renderClarifyDirective(
    issue: Issue,
    clarify: AgentClarificationRequest,
    sev: CompactDirectiveSeverity,
    file: string,
    line: number,
): CompactGuardDirective {
    const ruleId = issue.rule;
    const question = (clarify.promptQuestion || issue.message || '').replace(/\s+/g, ' ').trim();
    const optKeys = (clarify.candidateOptions || [])
        .map((o) => (typeof o === 'string' ? o : o.key))
        .join(',');
    const firstOpt = clarify.candidateOptions?.[0];
    const fallbackKey = firstOpt
        ? typeof firstOpt === 'string'
            ? firstOpt
            : firstOpt.key
        : 'default';
    const defKey = clarify.defaultChoiceKey || fallbackKey;
    const renderedDirective = `[CLARIFY|${sev}|${ruleId}] ${file}:${line} -> ${question} ?opts=[${optKeys}] def=${defKey}`;

    return {
        severity: sev,
        ruleId,
        file,
        line,
        summary: question,
        actionable: issue.actionable,
        directiveType: 'CLARIFY',
        clarificationRequest: clarify,
        renderedDirective,
    };
}

function renderGuardDirective(
    issue: Issue,
    sev: CompactDirectiveSeverity,
    file: string,
    line: number,
): CompactGuardDirective {
    const ruleId = issue.rule;
    const summary = (issue.message || '').replace(/\s+/g, ' ').trim();
    const fixHint = issue.suggestion ? issue.suggestion.replace(/\s+/g, ' ').trim() : undefined;
    const fixPart = fixHint ? ` Fix: ${fixHint}` : '';
    const actionable = issue.actionable;
    const actionPart = actionable
        ? ` -> action:${actionable.action} [safe=${actionable.safeToAutomate}]`
        : '';
    const renderedDirective = `[GUARD|${sev}|${ruleId}] ${file}:${line} -> ${summary}.${fixPart}${actionPart}`;

    return {
        severity: sev,
        ruleId,
        file,
        line,
        summary,
        fixHint,
        actionable,
        directiveType: 'GUARD',
        renderedDirective,
    };
}

/**
 * Format a single finding into an ultra-compact CAPP single-line directive.
 *
 * @param issue - Static analysis finding.
 * @returns Structured and rendered CompactGuardDirective.
 */
export function formatCompactGuardDirective(issue: Issue): CompactGuardDirective {
    const sev = resolveDirectiveSeverity(issue.severity);
    const file = resolveFileBasename(issue.location?.file);
    const line = issue.location?.start?.line ?? 1;

    const clarify = extractClarificationRequest(issue);
    if (clarify) {
        return renderClarifyDirective(issue, clarify, sev, file, line);
    }
    return renderGuardDirective(issue, sev, file, line);
}

/**
 * Synthesize multiple findings into a complete CAPP payload.
 *
 * @param target - Active file or symbol scope identifier.
 * @param issues - Filtered findings for the target slice.
 * @param protocolVersion - Optional explicit CAPP protocol version.
 * @returns CompactAgentPrompt ready for agent prompt injection.
 */
export function formatCompactAgentPrompt(
    target: string,
    issues: Issue[],
    protocolVersion?: '1.0' | '2.0',
): CompactAgentPrompt {
    const directives = issues.map(formatCompactGuardDirective);
    const hasBlock = directives.some((d) => d.severity === VERDICT_BLOCK);
    const hasWarn = directives.some((d) => d.severity === VERDICT_WARN);
    const verdict = hasBlock ? VERDICT_BLOCK : hasWarn ? VERDICT_WARN : VERDICT_PASS;

    const hasClarify = directives.some((d) => d.directiveType === 'CLARIFY');
    const version: '1.0' | '2.0' = protocolVersion ?? (hasClarify ? '2.0' : '1.0');

    const renderedDirectives = directives.map((d) => d.renderedDirective);
    const count = directives.length;
    const header = `[CAPP:v${version}] ${target} -> ${verdict} (${count} directive${count === 1 ? '' : 's'})`;
    const compactPromptText =
        count > 0 ? `${header}\n${renderedDirectives.join('\n')}` : `${header} (all clear)`;

    const compactChars = compactPromptText.length;
    const estimatedTokens = Math.max(1, Math.ceil(compactChars / CHARS_PER_TOKEN));
    const baselineEquivalentChars = Math.max(
        compactChars,
        count * BASELINE_CHARS_PER_DIRECTIVE + BASELINE_HEADER_CHARS,
    );
    const tokenSavingsRatio =
        count === 0
            ? ZERO_DIRECTIVE_SAVINGS_RATIO
            : Number((1 - compactChars / baselineEquivalentChars).toFixed(2));

    return {
        protocolVersion: version,
        target,
        verdict,
        directives,
        renderedDirectives,
        compactPromptText,
        estimatedTokens,
        tokenSavingsRatio,
    };
}

/**
 * Safely format code lines into an anchor slice with surrounding context.
 *
 * @param content - Source file content string.
 * @param startLine - 1-indexed starting line.
 * @param endLine - 1-indexed ending line.
 * @param radius - Number of surrounding context lines.
 * @returns Formatted code anchor slice or undefined.
 */
export function formatAnchorSlice(
    content: string,
    startLine: number,
    endLine: number,
    radius = 2,
): string | undefined {
    if (!content) {
        return undefined;
    }
    const lines = content.split(/\r?\n/);
    const fromLine = Math.max(1, startLine - radius);
    const toLine = Math.min(lines.length, endLine + radius);
    if (fromLine > toLine) {
        return undefined;
    }
    const slice: string[] = [];
    for (let l = fromLine; l <= toLine; l++) {
        const isTarget = l >= startLine && l <= endLine;
        const prefix = isTarget ? '> ' : '  ';
        slice.push(`${prefix}${l} | ${lines[l - 1]}`);
    }
    return slice.join('\n');
}

/**
 * Extract anchor code slice with surrounding context lines.
 *
 * @param filePath - Repository-relative or absolute file path.
 * @param startLine - 1-indexed starting line.
 * @param endLine - 1-indexed ending line.
 * @param baseDir - Optional base directory to resolve relative paths.
 * @param radius - Number of surrounding context lines (defaults to 2).
 * @param sourceContent - Optional in-memory source content.
 * @returns Formatted code anchor slice or undefined if unreadable.
 */
export function extractAnchorCodeSlice(
    filePath: string,
    startLine: number,
    endLine: number,
    baseDir?: string,
    radius = 2,
    sourceContent?: string,
): string | undefined {
    if (!filePath || filePath === 'unknown' || !sourceContent) {
        return undefined;
    }
    return formatAnchorSlice(sourceContent, startLine, endLine, radius);
}

const L1_RULE_RE = /^(?:ARCH-(?:FAC|ABS)|NUM-PREC|TYPE-|CONTRACT-)/;
const L1_PATH_RE = /(?:types?(\.d)?\.ts$|\/types\/|\.schema\.json$)/;
const L2_RULE_RE =
    /^(?:ADV-(?:CMP|PRF)|CPX-|PRF-|HIGH-COMPLEXITY$|MAGIC-NUMBER$|DUPLICATE-LITERAL$|NESTED-LOOPS$)/;
const L2_PATH_RE = /(?:\/operators\/|\/ast\/)/;
const L3_RULE_RE = /^(?:ADV-CFG|CFG-|RCFG-)/;
const L3_PATH_RE = /(?:\/config\/|\.config\.json$)/;
const L4_RULE_RE = /^(?:UI-|PRES-|FE-)/;
const L4_PATH_RE = /(?:\/reporters\/|\/presentation\/|\/views\/)/;

/**
 * Resolve architectural topology layer for deterministic ordering of refactoring batches.
 *
 * @param rule - Diagnostic rule identifier.
 * @param filePath - Target file path.
 * @returns One of the five architectural layers (L1 to L5).
 */
export function resolveTopologyLayer(rule: string, filePath?: string): AgentTopologyLayer {
    const r = (rule || '').toUpperCase();
    const p = (filePath || '').replace(/\\/g, '/').toLowerCase();

    if (L1_RULE_RE.test(r) || L1_PATH_RE.test(p)) {
        return 'L1_CONTRACT';
    }
    if (L2_RULE_RE.test(r) || L2_PATH_RE.test(p)) {
        return 'L2_OPERATOR';
    }
    if (L3_RULE_RE.test(r) || L3_PATH_RE.test(p)) {
        return 'L3_CONFIG';
    }
    if (L4_RULE_RE.test(r) || L4_PATH_RE.test(p)) {
        return 'L4_PRESENTATION';
    }
    return 'L5_GOVERNANCE';
}

const PURITY_MSG_RE = /(?:pure|precision)/;
const ZERO_HEAP_RULE_RE = /(?:PRF-MEM|ADV-PRF|CPX-SPACE-001)/;
const ZERO_HEAP_MSG_RE = /(?:loop|allocation)/;
const IMMUTABLE_MSG_RE = /(?:immutable|freeze)/;

function isPurityRequired(layer: AgentTopologyLayer, msg: string): boolean {
    return layer === 'L1_CONTRACT' || layer === 'L2_OPERATOR' || PURITY_MSG_RE.test(msg);
}

function isZeroHeapRequired(rule: string, layer: AgentTopologyLayer, msg: string): boolean {
    return layer === 'L2_OPERATOR' || ZERO_HEAP_RULE_RE.test(rule) || ZERO_HEAP_MSG_RE.test(msg);
}

function isImmutableRequired(rule: string, layer: AgentTopologyLayer, msg: string): boolean {
    return (
        layer === 'L1_CONTRACT' ||
        layer === 'L3_CONFIG' ||
        rule === 'ARCH-FAC-001' ||
        IMMUTABLE_MSG_RE.test(msg)
    );
}

function buildContractRulesList(flags: {
    zeroHeapAllocationInLoop: boolean;
    preservesPurity: boolean;
    immutableStateSnapshot: boolean;
    noExternalSideEffects: boolean;
}): string[] {
    const rules: string[] = [
        'ELOC <= 900, LOC <= 1400 (GATE-AST-001 dual-track volume budget)',
        'CC <= 15, Depth <= 4 (AST localized control flow envelope)',
    ];
    if (flags.zeroHeapAllocationInLoop) {
        rules.push(
            'Zero transient heap allocation in hot loop bodies (PRF-MEM-002 / CPX-SPACE-001)',
        );
    }
    if (flags.preservesPurity) {
        rules.push('Preserve function purity and deterministic return values without side effects');
    }
    if (flags.immutableStateSnapshot) {
        rules.push(
            'Enforce immutable state snapshots via Object.freeze or deep freeze (ARCH-FAC-001)',
        );
    }
    if (flags.noExternalSideEffects) {
        rules.push(
            'Prohibit introduction of unsolicited external dependencies or global state mutation',
        );
    }
    return rules;
}

/**
 * Generate immutable engineering constraints for a diagnostic finding.
 *
 * @param issue - Diagnostic finding.
 * @param layer - Architectural topology layer.
 * @returns Structured AgentImmutableConstraints contract.
 */
export function generateImmutableConstraints(
    issue: Issue,
    layer: AgentTopologyLayer,
): AgentImmutableConstraints {
    const rule = (issue.rule || '').toUpperCase();
    const msg = (issue.message || '').toLowerCase();

    const preservesPurity = isPurityRequired(layer, msg);
    const zeroHeapAllocationInLoop = isZeroHeapRequired(rule, layer, msg);
    const immutableStateSnapshot = isImmutableRequired(rule, layer, msg);
    const elocBudgetConstraint = true;
    const noExternalSideEffects =
        layer === 'L1_CONTRACT' || layer === 'L2_OPERATOR' || layer === 'L5_GOVERNANCE';

    const contractRules = buildContractRulesList({
        zeroHeapAllocationInLoop,
        preservesPurity,
        immutableStateSnapshot,
        noExternalSideEffects,
    });

    return {
        preservesPurity,
        zeroHeapAllocationInLoop,
        immutableStateSnapshot,
        elocBudgetConstraint,
        noExternalSideEffects,
        contractRules,
    };
}

/**
 * Generate targeted verification directive recommending exact qualitative test or gate commands.
 *
 * @param issue - Diagnostic finding.
 * @param _layer - Architectural topology layer.
 * @param _targetRoot - Workspace or repository root path.
 * @returns Precise AgentVerificationDirective.
 */
export function generateVerificationDirective(
    issue: Issue,
    _layer: AgentTopologyLayer,
    _targetRoot?: string,
): AgentVerificationDirective {
    const file = (issue.location?.file || '').replace(/\\/g, '/');
    const rule = (issue.rule || '').toUpperCase();

    if (file.endsWith('.gd')) {
        return {
            command: 'pwsh scripts/ps1/check-gdscript.ps1',
            description: 'Static GDScript syntax, typing, and architectural rule verification.',
            assertionCriteria: [
                'Ensure strict typing on all function arguments and return types',
                'Verify zero transient heap allocation in hot processing loops',
            ],
        };
    }

    if (rule === 'ARCH-FAC-001' || rule === 'ARCH-ABS-001') {
        return {
            command: 'node scripts/validate-facade-governance.js',
            description:
                'Facade discipline validation checking ELOC budget and trampoline elimination.',
            assertionCriteria: [
                'Ensure facade entry satisfies ELOC >= 15 or immutable freeze guarantee',
                'Verify elimination of single-target pass-through trampolines',
            ],
        };
    }

    if (rule === 'NUM-PREC-001' || rule === 'TST-FLT-001') {
        return {
            command: 'node scripts/validate-dual-faced-presentation.js',
            description: 'Dual-faced presentation and numeric precision governance verification.',
            assertionCriteria: [
                'Verify floating point tolerance assertion matches expected epsilon',
                'Confirm numeric rounding produces non-lossy 0.01 precision',
            ],
        };
    }

    if (rule === 'HIGH-COMPLEXITY' || rule.startsWith('CPX-') || rule.startsWith('ADV-CMP')) {
        return {
            command: 'node scripts/common/evaluate-eloc-budget.js',
            description: 'AST slice budget and cyclomatic complexity verification.',
            assertionCriteria: [
                'Confirm function cyclomatic complexity CC <= 15',
                'Ensure control flow nesting depth Depth <= 4 with guard returns',
            ],
        };
    }

    if (rule.startsWith('GOV-SAN') || rule.startsWith('CMG-')) {
        return {
            command: 'node scripts/validate-governance-exemptions.js',
            description:
                'Technical prose hygiene validation checking promotional or hyperbolic phrases.',
            assertionCriteria: [
                'Confirm removal of non-objective or promotional phrases',
                'Ensure purely technical, verifiable factual statements',
            ],
        };
    }

    return {
        command: 'npm test',
        description: `Execute test verification ensuring rule invariant satisfaction for ${issue.rule}.`,
        assertionCriteria: [
            `Verify static analysis invariant satisfaction for rule ${issue.rule}`,
            'Ensure zero functional regression across existing test suites',
        ],
    };
}
