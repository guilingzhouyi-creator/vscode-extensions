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
        const { filePath, domainName, line, layer } = options;

        let targetDomainObj: CodeDomainFingerprint | undefined;
        if (memory && memory.codeDomains) {
            if (domainName) {
                targetDomainObj = memory.codeDomains.find(
                    (d) => d.name === domainName || d.name.endsWith('.' + domainName),
                );
            } else if (line) {
                targetDomainObj = memory.codeDomains.find(
                    (d) => line >= d.span.startLine && line <= d.span.endLine,
                );
            }
        }

        const hardConstraints: string[] = [];
        const historicalPitfalls: string[] = [];
        const frequentViolations: string[] = [];
        const recommendedPatterns: string[] = [];

        // 1. Layer & Architecture Constraints
        const effectiveLayer = layer || memory?.contextWindows?.layer;
        if (effectiveLayer) {
            if (effectiveLayer === 'domain') {
                hardConstraints.push(GuidanceMessages.DOMAIN_LAYER_HARD);
                hardConstraints.push(GuidanceMessages.DOMAIN_PURITY_HARD);
            } else if (effectiveLayer === 'infrastructure') {
                hardConstraints.push(GuidanceMessages.INFRA_RESPONSIBILITY_HARD);
            } else if (effectiveLayer === 'interface' || effectiveLayer === 'frontend') {
                hardConstraints.push(GuidanceMessages.INTERFACE_BOUNDARY_HARD);
            }
        }

        // 2. Extract Violations & Pitfalls from Memory
        if (targetDomainObj) {
            for (const v of targetDomainObj.ruleViolations) {
                frequentViolations.push(`规则 [${v.rule}] (严重度: ${v.severity}): ${v.message}`);
            }
        } else if (memory) {
            for (const h of memory.ruleHits.slice(0, MAX_MEMORY_RULE_HITS)) {
                frequentViolations.push(`规则 [${h.rule}] (第 ${h.line} 行): ${h.message}`);
            }
        }

        // 3. Extract Anomalies & Regressions from Trajectory
        if (trajectory) {
            for (const a of trajectory.activeAnomalies) {
                if (!targetDomainObj || !a.domainId || a.domainId === targetDomainObj.domainId) {
                    historicalPitfalls.push(`历史教训 (${a.kind}): ${a.message}`);
                }
            }
        }

        // 4. Recommended Implementation Patterns
        recommendedPatterns.push(GuidanceMessages.RECOMMEND_MODERN_TYPES);
        recommendedPatterns.push(GuidanceMessages.RECOMMEND_ZERO_LOOP_ALLOC);
        recommendedPatterns.push(GuidanceMessages.RECOMMEND_DOC_INTENT);

        // 5. Render High-Purity Markdown
        const domainTitle = targetDomainObj
            ? `\`${targetDomainObj.name}\` (${targetDomainObj.kind})`
            : 'Whole File Scope';
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

        return {
            filePath,
            targetDomain: targetDomainObj?.name,
            layer: effectiveLayer,
            hardConstraints,
            historicalPitfalls,
            frequentViolations,
            recommendedPatterns,
            renderedMarkdown: lines.join('\n'),
        };
    }
}
