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
    AgentDensityConstraintSpec,
    AgentVerificationDirective,
    AgentClarificationRequest,
} from '../reporters/agent-directives-types';
export type { AgentTopologyLayer } from '../reporters/agent-directives-types';
import { inferFineGrainedFileRole } from '../intelligence/file-role-inference';
import { getRoleBudget } from '../intelligence/elastic-budget-matrix';
import { compressDiagnosticSentence, cleanSuggestion } from '../reporting/aas-remediation';
import { estimateNarrowTokens, estimateTokens, measureJsonBaseline } from './token-estimate';

/** Maximum number of memory rule hits rendered as frequent violations in the guidance prompt. */
const MAX_MEMORY_RULE_HITS = 5;
const VERBOSE_DIRECTIVE_THRESHOLD = 55;

const LAYER_DOMAIN = 'domain';
const LAYER_INFRASTRUCTURE = 'infrastructure';
const LAYER_INTERFACE = 'interface';
const LAYER_FRONTEND = 'frontend';

const DIRECTIVE_TYPE_GUARD = 'GUARD' as const;
const DIRECTIVE_TYPE_CLARIFY = 'CLARIFY' as const;
const PROTOCOL_VERSION_1_0 = '1.0' as const;
const PROTOCOL_VERSION_2_0 = '2.0' as const;
const DEFAULT_FALLBACK_OPTION_KEY = 'default';
const DEFAULT_UNKNOWN_BASENAME = 'unknown';
const METHOD_NAME_GENERATE = 'generate';

const LAYER_L1_CONTRACT: AgentTopologyLayer = 'L1_CONTRACT';
const LAYER_L2_OPERATOR: AgentTopologyLayer = 'L2_OPERATOR';
const LAYER_L3_CONFIG: AgentTopologyLayer = 'L3_CONFIG';
const LAYER_L4_PRESENTATION: AgentTopologyLayer = 'L4_PRESENTATION';
const LAYER_L5_GOVERNANCE: AgentTopologyLayer = 'L5_GOVERNANCE';

const PROP_PROMPT_QUESTION = 'promptQuestion';

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
            (domain) => domain.name === domainName || domain.name.endsWith('.' + domainName),
        );
    }
    if (line !== undefined) {
        return memory.codeDomains.find(
            (domain) => line >= domain.span.startLine && line <= domain.span.endLine,
        );
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

    if (effectiveLayer === LAYER_DOMAIN) {
        hardConstraints.push(GuidanceMessages.DOMAIN_LAYER_HARD);
        hardConstraints.push(GuidanceMessages.DOMAIN_PURITY_HARD);
    } else if (effectiveLayer === LAYER_INFRASTRUCTURE) {
        hardConstraints.push(GuidanceMessages.INFRA_RESPONSIBILITY_HARD);
    } else if (effectiveLayer === LAYER_INTERFACE || effectiveLayer === LAYER_FRONTEND) {
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
        for (const violation of targetDomainObj.ruleViolations) {
            frequentViolations.push(
                GuidanceMessages.FORMAT_VIOLATION_WITH_SEVERITY(
                    violation.rule,
                    violation.severity,
                    violation.message,
                ),
            );
        }
    } else if (memory) {
        for (const memoryHit of memory.ruleHits.slice(0, MAX_MEMORY_RULE_HITS)) {
            frequentViolations.push(
                GuidanceMessages.FORMAT_VIOLATION(
                    memoryHit.rule,
                    memoryHit.line,
                    memoryHit.message,
                ),
            );
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

    for (const anomaly of trajectory.activeAnomalies) {
        if (
            !targetDomainObj ||
            !anomaly.domainId ||
            anomaly.domainId === targetDomainObj.domainId
        ) {
            historicalPitfalls.push(GuidanceMessages.FORMAT_PITFALL(anomaly.kind, anomaly.message));
        }
    }

    return historicalPitfalls;
}

interface GuidanceMarkdownParams {
    filePath: string;
    domainTitle: string;
    effectiveLayer?: string;
    hardConstraints: string[];
    historicalPitfalls: string[];
    frequentViolations: string[];
    recommendedPatterns: string[];
}

/**
 * Render complete guidance prompt into formatted Markdown lines.
 *
 * @param params - Guidance markdown generation context.
 * @returns Joined Markdown string.
 */
function renderGuidanceMarkdown(params: GuidanceMarkdownParams): string {
    const {
        filePath,
        domainTitle,
        effectiveLayer,
        hardConstraints,
        historicalPitfalls,
        frequentViolations,
        recommendedPatterns,
    } = params;
    const lines: string[] = [
        GuidanceMessages.TITLE_LOCAL_GUARDRAILS(filePath),
        GuidanceMessages.TARGET_SCOPE_LABEL(domainTitle, effectiveLayer),
        '',
    ];

    if (hardConstraints.length > 0) {
        lines.push(GuidanceMessages.SECTION_HARD_CONSTRAINTS);
        lines.push(
            ...hardConstraints.map((constraint) => `${GuidanceMessages.BULLET}${constraint}`),
        );
        lines.push('');
    }

    if (historicalPitfalls.length > 0) {
        lines.push(GuidanceMessages.SECTION_HISTORICAL_PITFALLS);
        lines.push(...historicalPitfalls.map((pitfall) => `${GuidanceMessages.BULLET}${pitfall}`));
        lines.push('');
    }

    if (frequentViolations.length > 0) {
        lines.push(GuidanceMessages.SECTION_FREQUENT_VIOLATIONS);
        lines.push(
            ...frequentViolations.map((violation) => `${GuidanceMessages.BULLET}${violation}`),
        );
        lines.push('');
    }

    lines.push(GuidanceMessages.SECTION_RECOMMENDED_PATTERNS);
    lines.push(...recommendedPatterns.map((pattern) => `${GuidanceMessages.BULLET}${pattern}`));
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
    generateConstraints(
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

        const promptData: Omit<AgentConstraintPrompt, 'renderedMarkdown'> = {
            filePath,
            targetDomain: targetDomainObj?.name,
            layer: effectiveLayer,
            hardConstraints,
            historicalPitfalls,
            frequentViolations,
            recommendedPatterns,
        };

        const renderedMarkdown = renderGuidanceMarkdown({
            domainTitle,
            ...promptData,
        });

        return {
            ...promptData,
            renderedMarkdown,
        };
    }

    /**
     * Backward-compatible delegation to generateConstraints.
     */
    [METHOD_NAME_GENERATE](
        options: AgentConstraintOptions,
        memory?: ReviewMemoryRecord,
        trajectory?: FileChangeTrajectory,
    ): AgentConstraintPrompt {
        return this.generateConstraints(options, memory, trajectory);
    }
}

const VERDICT_BLOCK = 'BLOCK' as const;
const VERDICT_WARN = 'WARN' as const;
const VERDICT_INFO = 'INFO' as const;
const VERDICT_PASS = 'PASS' as const;
const SEVERITY_ERROR = 'error' as const;
const SEVERITY_WARNING = 'warning' as const;
/** Ratio reported when the compact prompt replaces an identical-size baseline (no net gain). */
const NO_SAVINGS_RATIO = 0;

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
    const rawClarification =
        (issue as unknown as Record<string, unknown>).clarificationRequest ??
        issue.detail?.clarificationRequest ??
        (issue.actionable as unknown as Record<string, unknown> | undefined)?.clarificationRequest;
    if (
        rawClarification &&
        typeof rawClarification === 'object' &&
        PROP_PROMPT_QUESTION in (rawClarification as Record<string, unknown>)
    ) {
        return rawClarification as AgentClarificationRequest;
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
    const rawFilePath = filePath || DEFAULT_UNKNOWN_BASENAME;
    if (!rawFilePath.includes('/') && !rawFilePath.includes('\\')) {
        return rawFilePath;
    }
    return rawFilePath.split(/[/\\]/).pop() || rawFilePath;
}

interface DirectiveRenderParams {
    issue: Issue;
    directiveSeverity: CompactDirectiveSeverity;
    targetFile: string;
    lineNumber: number;
    clarify?: AgentClarificationRequest;
}

function renderClarifyDirective(params: DirectiveRenderParams): CompactGuardDirective {
    const { issue, clarify, directiveSeverity, targetFile, lineNumber } = params;
    const ruleId = issue.rule;
    const clarifyReq = clarify!;
    const question = (clarifyReq.promptQuestion || issue.message || '').replace(/\s+/g, ' ').trim();
    const optKeys = (clarifyReq.candidateOptions || [])
        .map((opt) => (typeof opt === 'string' ? opt : opt.key))
        .join(',');
    const firstOpt = clarifyReq.candidateOptions?.[0];
    const fallbackKey = firstOpt
        ? typeof firstOpt === 'string'
            ? firstOpt
            : firstOpt.key
        : DEFAULT_FALLBACK_OPTION_KEY;
    const defKey = clarifyReq.defaultChoiceKey || fallbackKey;
    const renderedDirective = `[CLARIFY|${directiveSeverity}|${ruleId}] ${targetFile}:${lineNumber} -> ${question} ?opts=[${optKeys}] def=${defKey}`;

    return {
        severity: directiveSeverity,
        ruleId,
        file: targetFile,
        line: lineNumber,
        summary: question,
        actionable: issue.actionable,
        directiveType: DIRECTIVE_TYPE_CLARIFY,
        clarificationRequest: clarifyReq,
        renderedDirective,
    };
}

function renderGuardDirective(params: DirectiveRenderParams): CompactGuardDirective {
    const { issue, directiveSeverity, targetFile, lineNumber } = params;
    const ruleId = issue.rule;
    const rawMessage = (issue.message || '').replace(/\s+/g, ' ').trim();
    const summary = normalizeDirectiveSummary(
        rawMessage.length >= VERBOSE_DIRECTIVE_THRESHOLD
            ? compressDiagnosticSentence(rawMessage)
            : rawMessage,
    );
    const rawSuggestion = issue.suggestion
        ? issue.suggestion.replace(/\s+/g, ' ').trim()
        : undefined;
    const fixHint =
        rawSuggestion && rawSuggestion.length >= VERBOSE_DIRECTIVE_THRESHOLD
            ? cleanSuggestion(rawSuggestion)
            : rawSuggestion;
    const fixPart = fixHint ? ` Fix: ${normalizeDirectiveSummary(fixHint)}.` : '';
    const actionable = issue.actionable;
    const actionPart = actionable
        ? ` -> action:${actionable.action} [safe=${actionable.safeToAutomate}]`
        : '';
    const renderedDirective = `[GUARD|${directiveSeverity}|${ruleId}] ${targetFile}:${lineNumber} -> ${summary}.${fixPart}${actionPart}`;

    return {
        severity: directiveSeverity,
        ruleId,
        file: targetFile,
        line: lineNumber,
        summary,
        fixHint,
        actionable,
        directiveType: DIRECTIVE_TYPE_GUARD,
        renderedDirective,
    };
}

/**
 * Strips trailing sentence punctuation so the renderer owns the delimiter.
 *
 * The directive template inserts its own `.`, so a summary that already ends with `.` renders `..`.
 * Removing the source punctuation keeps one delimiter regardless of whether the upstream analyzer
 * emitted prose (period-terminated) or a compressed fragment (unterminated).
 *
 * @param text - Summary or fix hint fragment.
 * @returns Fragment without trailing `.` / `。` or surrounding whitespace.
 */
function normalizeDirectiveSummary(text: string): string {
    return text.replace(/[.。]+\s*$/, '').trim();
}

/**
 * Format a single finding into an ultra-compact CAPP single-line directive.
 *
 * @param issue - Static analysis finding.
 * @returns Structured and rendered CompactGuardDirective.
 */
export function formatCompactGuardDirective(issue: Issue): CompactGuardDirective {
    const directiveSeverity = resolveDirectiveSeverity(issue.severity);
    const targetFile = resolveFileBasename(issue.location?.file);
    const lineNumber = issue.location?.start?.line ?? 1;

    const clarify = extractClarificationRequest(issue);
    const renderParams: DirectiveRenderParams = {
        issue,
        directiveSeverity,
        targetFile,
        lineNumber,
        clarify,
    };
    if (clarify) {
        return renderClarifyDirective(renderParams);
    }
    return renderGuardDirective(renderParams);
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
    const primaryIssues = issues.filter((issueItem) => !issueItem.clusteredInto);
    const effectiveIssues = primaryIssues.length > 0 ? primaryIssues : issues;
    const directives = effectiveIssues.map(formatCompactGuardDirective);
    const hasBlock = directives.some((directive) => directive.severity === VERDICT_BLOCK);
    const hasWarn = directives.some((directive) => directive.severity === VERDICT_WARN);
    const verdict = hasBlock ? VERDICT_BLOCK : hasWarn ? VERDICT_WARN : VERDICT_PASS;

    const hasClarify = directives.some(
        (directive) => directive.directiveType === DIRECTIVE_TYPE_CLARIFY,
    );
    const version: '1.0' | '2.0' =
        protocolVersion ?? (hasClarify ? PROTOCOL_VERSION_2_0 : PROTOCOL_VERSION_1_0);

    const renderedDirectives = directives.map((directive) => directive.renderedDirective);
    const count = directives.length;
    const header = `[CAPP:v${version}] ${target} -> ${verdict} (${count} directive${count === 1 ? '' : 's'})`;
    const compactPromptText =
        count > 0 ? `${header}\n${renderedDirectives.join('\n')}` : `${header} (all clear)`;

    const compactChars = compactPromptText.length;
    const baselineChars = Math.max(compactChars, measureJsonBaseline(effectiveIssues));
    const estimatedTokens = estimateTokens(compactPromptText);
    const baselineTokens = estimateNarrowTokens(baselineChars);
    const tokenSavingsRatio =
        count === 0
            ? NO_SAVINGS_RATIO
            : Number((1 - estimatedTokens / Math.max(1, baselineTokens)).toFixed(2));

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
 * Trims trailing carriage return if present before newline.
 */
function stripTrailingCr(content: string, startOffset: number, endOffset: number): number {
    if (endOffset > startOffset && content.charCodeAt(endOffset - 1) === 13) {
        return endOffset - 1;
    }
    return endOffset;
}

/**
 * Formats a single anchor line with gutter line number and target marker.
 */
function renderAnchorLine(
    content: string,
    lineStartOffset: number,
    rawEndOffset: number,
    currentLine: number,
    targetStartLine: number,
    targetEndLine: number,
): string {
    const endOffset = stripTrailingCr(content, lineStartOffset, rawEndOffset);
    const lineText = content.slice(lineStartOffset, endOffset);
    const isTarget = currentLine >= targetStartLine && currentLine <= targetEndLine;
    const prefix = isTarget ? '> ' : '  ';
    return `${prefix}${currentLine} | ${lineText}`;
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
    const fromLine = Math.max(1, startLine - radius);
    const toLine = endLine + radius;
    if (fromLine > toLine) {
        return undefined;
    }

    const slice: string[] = [];
    let currentLine = 1;
    let lineStartOffset = 0;
    const contentLength = content.length;

    for (let charIndex = 0; charIndex <= contentLength; charIndex++) {
        const isEof = charIndex === contentLength;
        const isNewline = !isEof && content.charCodeAt(charIndex) === 10;
        if (!isNewline && !isEof) {
            continue;
        }

        if (currentLine >= fromLine && currentLine <= toLine) {
            slice.push(
                renderAnchorLine(
                    content,
                    lineStartOffset,
                    charIndex,
                    currentLine,
                    startLine,
                    endLine,
                ),
            );
        }

        if (currentLine >= toLine || isEof) {
            break;
        }

        currentLine++;
        lineStartOffset = charIndex + 1;
    }

    return slice.length > 0 ? slice.join('\n') : undefined;
}

/**
 * Options for extracting contextual anchor code slices.
 */
export interface AnchorSliceExtractionParams {
    filePath: string;
    startLine: number;
    endLine: number;
    baseDir?: string;
    radius?: number;
    sourceContent?: string;
}

/**
 * Extract anchor code slice with surrounding context lines.
 *
 * @param params - Contextual extraction parameters.
 * @returns Formatted code anchor slice or undefined if unreadable.
 */
export function extractAnchorCodeSlice(params: AnchorSliceExtractionParams): string | undefined {
    const { filePath, startLine, endLine, sourceContent, radius = 2 } = params;
    if (!filePath || filePath === DEFAULT_UNKNOWN_BASENAME || !sourceContent) {
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
    const ruleUpper = (rule || '').toUpperCase();
    const pathNormalized = (filePath || '').replace(/\\/g, '/').toLowerCase();

    if (L1_RULE_RE.test(ruleUpper) || L1_PATH_RE.test(pathNormalized)) {
        return LAYER_L1_CONTRACT;
    }
    if (L2_RULE_RE.test(ruleUpper) || L2_PATH_RE.test(pathNormalized)) {
        return LAYER_L2_OPERATOR;
    }
    if (L3_RULE_RE.test(ruleUpper) || L3_PATH_RE.test(pathNormalized)) {
        return LAYER_L3_CONFIG;
    }
    if (L4_RULE_RE.test(ruleUpper) || L4_PATH_RE.test(pathNormalized)) {
        return LAYER_L4_PRESENTATION;
    }
    return LAYER_L5_GOVERNANCE;
}

const PURITY_MSG_RE = /(?:pure|precision)/;
const ZERO_HEAP_RULE_RE = /(?:PRF-MEM|ADV-PRF|CPX-SPACE-001)/;
const ZERO_HEAP_MSG_RE = /(?:loop|allocation)/;
const IMMUTABLE_MSG_RE = /(?:immutable|freeze)/;

function isPurityRequired(layer: AgentTopologyLayer, diagnosticMessage: string): boolean {
    return (
        layer === LAYER_L1_CONTRACT ||
        layer === LAYER_L2_OPERATOR ||
        PURITY_MSG_RE.test(diagnosticMessage)
    );
}

function isZeroHeapRequired(
    rule: string,
    layer: AgentTopologyLayer,
    diagnosticMessage: string,
): boolean {
    return (
        layer === LAYER_L2_OPERATOR ||
        ZERO_HEAP_RULE_RE.test(rule) ||
        ZERO_HEAP_MSG_RE.test(diagnosticMessage)
    );
}

function isImmutableRequired(
    rule: string,
    layer: AgentTopologyLayer,
    diagnosticMessage: string,
): boolean {
    return (
        layer === LAYER_L1_CONTRACT ||
        layer === LAYER_L3_CONFIG ||
        rule === 'ARCH-FAC-001' ||
        IMMUTABLE_MSG_RE.test(diagnosticMessage)
    );
}

function buildContractRulesList(flags: {
    zeroHeapAllocationInLoop: boolean;
    preservesPurity: boolean;
    immutableStateSnapshot: boolean;
    noExternalSideEffects: boolean;
    densitySpec?: AgentDensityConstraintSpec;
}): string[] {
    const density = flags.densitySpec;
    const elocLimit = density ? density.maxEloc : 900;
    const locLimit = density ? density.maxLoc : 1400;
    const roleSuffix = density?.role ? ` [Role: ${density.role}]` : '';

    const rules: string[] = [
        `ELOC <= ${elocLimit}, LOC <= ${locLimit} (VOL-ELOC-001 / VOL-LOC-001 dual-track volume budget)${roleSuffix}`,
        'Token density tau in [2.5, 22.0] (VOL-DIL-001 / GUARD-AST-001)',
        'Plumbing overhead ratio POR <= 0.60, TSPR >= 0.40 (ARCH-FAC-001)',
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
    const ruleUpper = (issue.rule || '').toUpperCase();
    const normalizedMessage = (issue.message || '').toLowerCase();
    const filePath = issue.location?.file;

    const preservesPurity = isPurityRequired(layer, normalizedMessage);
    const zeroHeapAllocationInLoop = isZeroHeapRequired(ruleUpper, layer, normalizedMessage);
    const immutableStateSnapshot = isImmutableRequired(ruleUpper, layer, normalizedMessage);
    const elocBudgetConstraint = true;
    const noExternalSideEffects =
        layer === LAYER_L1_CONTRACT || layer === LAYER_L2_OPERATOR || layer === LAYER_L5_GOVERNANCE;

    let densitySpec: AgentDensityConstraintSpec | undefined = undefined;
    if (filePath && filePath !== DEFAULT_UNKNOWN_BASENAME) {
        const roleResult = inferFineGrainedFileRole(filePath);
        const roleBudget = getRoleBudget(roleResult.role);
        densitySpec = {
            role: roleResult.role,
            maxEloc: roleBudget.effectiveLocFail,
            maxLoc: roleBudget.physicalLinesFail,
            minTau: 2.5,
            maxTau: 22.0,
            maxPor: 0.6,
        };
    }

    const contractRules = buildContractRulesList({
        zeroHeapAllocationInLoop,
        preservesPurity,
        immutableStateSnapshot,
        noExternalSideEffects,
        densitySpec,
    });

    return {
        preservesPurity,
        zeroHeapAllocationInLoop,
        immutableStateSnapshot,
        elocBudgetConstraint,
        densitySpec,
        noExternalSideEffects,
        contractRules,
    };
}

interface VerificationDirectiveRuleStrategy {
    matcher: (file: string, rule: string) => boolean;
    factory: (issue: Issue) => AgentVerificationDirective;
}

const RULE_PREFIX_CPX = 'CPX-';
const RULE_PREFIX_ADV_CMP = 'ADV-CMP';
const RULE_PREFIX_GOV_SAN = 'GOV-SAN';
const RULE_PREFIX_CMG = 'CMG-';
const RULE_NAME_HIGH_COMPLEXITY = 'HIGH-COMPLEXITY';
const RULE_NAME_ARCH_FAC = 'ARCH-FAC-001';
const RULE_NAME_ARCH_ABS = 'ARCH-ABS-001';
const RULE_NAME_NUM_PREC = 'NUM-PREC-001';
const RULE_NAME_TST_FLT = 'TST-FLT-001';

function createVerificationDirective(
    command: string,
    description: string,
    assertionCriteria: string[],
): AgentVerificationDirective {
    return { command, description, assertionCriteria };
}

const VERIFICATION_DIRECTIVE_STRATEGIES: readonly VerificationDirectiveRuleStrategy[] = [
    {
        matcher: (file) => file.endsWith('.gd'),
        factory: () =>
            createVerificationDirective(
                'pwsh scripts/ps1/check-gdscript.ps1',
                'Static GDScript syntax, typing, and architectural rule verification.',
                [
                    'Ensure strict typing on all function arguments and return types',
                    'Verify zero transient heap allocation in hot processing loops',
                ],
            ),
    },
    {
        matcher: (_file, rule) => rule === RULE_NAME_ARCH_FAC || rule === RULE_NAME_ARCH_ABS,
        factory: () =>
            createVerificationDirective(
                'node scripts/validate-facade-governance.js',
                'Facade discipline validation checking ELOC budget and trampoline elimination.',
                [
                    'Ensure facade entry satisfies ELOC >= 15 or immutable freeze guarantee',
                    'Verify elimination of single-target pass-through trampolines',
                ],
            ),
    },
    {
        matcher: (_file, rule) => rule === RULE_NAME_NUM_PREC || rule === RULE_NAME_TST_FLT,
        factory: () =>
            createVerificationDirective(
                'node scripts/validate-dual-faced-presentation.js',
                'Dual-faced presentation and numeric precision governance verification.',
                [
                    'Verify floating point tolerance assertion matches expected epsilon',
                    'Confirm numeric rounding produces non-lossy 0.01 precision',
                ],
            ),
    },
    {
        matcher: (_file, rule) =>
            rule === RULE_NAME_HIGH_COMPLEXITY ||
            rule.startsWith(RULE_PREFIX_CPX) ||
            rule.startsWith(RULE_PREFIX_ADV_CMP),
        factory: () =>
            createVerificationDirective(
                'node scripts/common/evaluate-eloc-budget.js',
                'AST slice budget and cyclomatic complexity verification.',
                [
                    'Confirm function cyclomatic complexity CC <= 15',
                    'Ensure control flow nesting depth Depth <= 4 with guard returns',
                ],
            ),
    },
    {
        matcher: (_file, rule) =>
            rule.startsWith(RULE_PREFIX_GOV_SAN) || rule.startsWith(RULE_PREFIX_CMG),
        factory: () =>
            createVerificationDirective(
                'node scripts/validate-governance-exemptions.js',
                'Technical prose hygiene validation checking promotional or hyperbolic phrases.',
                [
                    'Confirm removal of non-objective or promotional phrases',
                    'Ensure purely technical, verifiable factual statements',
                ],
            ),
    },
];

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
    const normalizedFile = (issue.location?.file || '').replace(/\\/g, '/');
    const targetRule = (issue.rule || '').toUpperCase();

    for (const strategy of VERIFICATION_DIRECTIVE_STRATEGIES) {
        if (strategy.matcher(normalizedFile, targetRule)) {
            return strategy.factory(issue);
        }
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
