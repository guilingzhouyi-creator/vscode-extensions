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
import type { Issue } from '../types';
import { GuidanceMessages } from '../messages';

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
const BASELINE_CHARS_PER_DIRECTIVE = 350;
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
    renderedDirective: string;
}

/**
 * Compact Agent Prompt Protocol (CAPP) verdict payload.
 *
 * Delivers >80% token compression compared to human-oriented Markdown,
 * focusing exclusively on actionable directives within active edit scopes.
 */
export interface CompactAgentPrompt {
    protocolVersion: '1.0';
    target: string;
    verdict: typeof VERDICT_PASS | typeof VERDICT_WARN | typeof VERDICT_BLOCK;
    directives: CompactGuardDirective[];
    renderedDirectives: string[];
    compactPromptText: string;
    estimatedTokens: number;
    tokenSavingsRatio: number;
}

/**
 * Format a single finding into an ultra-compact CAPP single-line directive.
 *
 * @param issue - Static analysis finding.
 * @returns Structured and rendered CompactGuardDirective.
 */
export function formatCompactGuardDirective(issue: Issue): CompactGuardDirective {
    const sev: CompactDirectiveSeverity =
        issue.severity === SEVERITY_ERROR
            ? VERDICT_BLOCK
            : issue.severity === SEVERITY_WARNING
              ? VERDICT_WARN
              : VERDICT_INFO;
    const filePath = issue.location?.file || 'unknown';
    const file =
        filePath.includes('/') || filePath.includes('\\')
            ? filePath.split(/[/\\]/).pop() || filePath
            : filePath;
    const line = issue.location?.start?.line ?? 1;
    const ruleId = issue.rule;
    const summary = (issue.message || '').replace(/\s+/g, ' ').trim();
    const fixHint = issue.suggestion ? issue.suggestion.replace(/\s+/g, ' ').trim() : undefined;
    const fixPart = fixHint ? ` Fix: ${fixHint}` : '';
    const renderedDirective = `[GUARD|${sev}|${ruleId}] ${file}:${line} -> ${summary}.${fixPart}`;

    return {
        severity: sev,
        ruleId,
        file,
        line,
        summary,
        fixHint,
        renderedDirective,
    };
}

/**
 * Synthesize multiple findings into a complete CAPP payload.
 *
 * @param target - Active file or symbol scope identifier.
 * @param issues - Filtered findings for the target slice.
 * @returns CompactAgentPrompt ready for agent prompt injection.
 */
export function formatCompactAgentPrompt(target: string, issues: Issue[]): CompactAgentPrompt {
    const directives = issues.map(formatCompactGuardDirective);
    const hasBlock = directives.some((d) => d.severity === VERDICT_BLOCK);
    const hasWarn = directives.some((d) => d.severity === VERDICT_WARN);
    const verdict = hasBlock ? VERDICT_BLOCK : hasWarn ? VERDICT_WARN : VERDICT_PASS;

    const renderedDirectives = directives.map((d) => d.renderedDirective);
    const count = directives.length;
    const header = `[CAPP:v1.0] ${target} -> ${verdict} (${count} directive${count === 1 ? '' : 's'})`;
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
        protocolVersion: '1.0',
        target,
        verdict,
        directives,
        renderedDirectives,
        compactPromptText,
        estimatedTokens,
        tokenSavingsRatio,
    };
}
