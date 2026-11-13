/**
 * Module: Core Reporting — AAS Defect Record Builder & Anchor Cache
 * File Path: src/core/reporting/aas-defect-records.ts
 * Architecture Role: Manages ephemeral source anchor caching and constructs concise,
 *   token-frugal AAS defect records with optional adjudication and fix metadata.
 * Dependencies & Triggers: types, aas-types, aas-remediation, agentConstraintGenerator,
 *   memory-governor; invoked by aas-reporter during per-file defect emission.
 * Responsibilities:
 *   1. Cache source file payloads in-memory via memory-governor registration without sync I/O.
 *   2. Map finding severities and truncate/compress diagnostic messages.
 *   3. Project adjudication tiers, confidence scores, correlated rules, and anchor slices.
 * Exit Semantics & Design Rationale: Pure record projection; caller must call
 *   `AnchorCache.dispose()` in a `finally` block to release governor registration.
 */

import type { Issue, Severity } from '../types';
import {
    formatAnchorSlice,
    generateVerificationDirective,
    type AgentTopologyLayer,
} from '../guidance/agentConstraintGenerator';
import type { AasDefectRecord, AasReportOptions, AasSeverity } from './aas-types';
import { buildFixRecipe, compressDiagnosticSentence } from './aas-remediation';
import { CacheEvictionTier, sharedMemoryGovernor } from '../memory/memory-governor';

const DEFAULT_CONTEXT_RADIUS = 1;
const DEFAULT_MAX_MESSAGE_CHARS = 160;
const ELLIPSIS = '…';

const SEVERITY_ERROR: Severity = 'error';
const SEVERITY_WARNING: Severity = 'warning';

const AAS_SEV_BLOCK: AasSeverity = 'BLOCK';
const AAS_SEV_WARN: AasSeverity = 'WARN';
const AAS_SEV_INFO: AasSeverity = 'INFO';

function mapSeverity(rawSeverity?: string): AasSeverity {
    if (rawSeverity === SEVERITY_ERROR) return AAS_SEV_BLOCK;
    return rawSeverity === SEVERITY_WARNING ? AAS_SEV_WARN : AAS_SEV_INFO;
}

function trimMessage(text: string, maxChars: number = DEFAULT_MAX_MESSAGE_CHARS): string {
    const cleanedText = (text || '').replace(/\s+/g, ' ').trim();
    if (cleanedText.length <= maxChars) return cleanedText;
    return cleanedText.slice(0, Math.max(1, maxChars - 1)) + ELLIPSIS;
}

/**
 * In-memory anchor extractor avoiding direct synchronous filesystem operations.
 */
export class AnchorCache {
    private static sequence = 0;
    private readonly cache = new Map<string, string | null>();
    private readonly customReader?: (relPath: string) => string | undefined;
    private readonly unregister?: () => void;

    constructor(customReader?: (relPath: string) => string | undefined) {
        this.customReader = customReader;
        const instanceId = ++AnchorCache.sequence;
        const evictionTier = CacheEvictionTier.Ephemeral;
        this.unregister = sharedMemoryGovernor.register({
            name: `aas-reporter:anchor-cache:${instanceId}`,
            tier: evictionTier,
            clear: () => this.cache.clear(),
            getSize: () => this.cache.size,
        });
    }

    public dispose(): void {
        this.cache.clear();
        this.unregister?.();
    }

    public getAnchor(
        file: string,
        startLine: number,
        endLine: number,
        radius: number,
    ): string | undefined {
        if (!this.customReader) return undefined;
        let content = this.cache.get(file);
        if (content === undefined) {
            const rawContent = this.customReader(file);
            content = rawContent !== undefined ? rawContent : null;
            this.cache.set(file, content);
        }
        if (!content) return undefined;
        return formatAnchorSlice(content, startLine, endLine, radius);
    }
}

/** Parameter object for single defect record construction. */
export interface DefectRecordParams {
    readonly issue: Issue;
    readonly file: string;
    readonly layer: AgentTopologyLayer;
    readonly anchorCache: AnchorCache;
    readonly options: AasReportOptions;
    readonly defaultVerify: string;
    readonly skipAnchor?: boolean;
    readonly tier?: 'T1' | 'T2' | 'T3';
}

function projectAdjudicationFields(
    issue: Issue,
    tier: 'T1' | 'T2' | 'T3' | undefined,
): { tier?: 'T1' | 'T2' | 'T3'; conf?: number; also?: readonly string[] } {
    const fields: { tier?: 'T1' | 'T2' | 'T3'; conf?: number; also?: readonly string[] } = {};
    const resolvedTier = issue.adjudicatedTier ?? tier;
    if (resolvedTier) fields.tier = resolvedTier;
    const confidence = issue.adjudicatedConfidence ?? issue.evidence?.confidence;
    if (typeof confidence === 'number' && Number.isFinite(confidence)) {
        fields.conf = Number(confidence.toFixed(2));
    }
    if (issue.correlatedRules && issue.correlatedRules.length > 0) {
        fields.also = issue.correlatedRules;
    }
    return fields;
}

function resolveDefectAnchor(
    params: DefectRecordParams,
    severityTier: AasSeverity,
    startLine: number,
    endLine: number,
): string | undefined {
    if (params.skipAnchor === true) return undefined;
    const effectiveTier = params.issue.adjudicatedTier ?? params.tier;
    const shouldEmit =
        severityTier === AAS_SEV_BLOCK ||
        effectiveTier === 'T1' ||
        params.options.includeWarningAnchors === true;
    if (!shouldEmit) return undefined;
    const radius = params.options.contextRadius ?? DEFAULT_CONTEXT_RADIUS;
    const boundedEndLine = Math.min(endLine, startLine + 1);
    return params.anchorCache.getAnchor(params.file, startLine, boundedEndLine, radius);
}

/**
 * Converts a single Issue into a concise AasDefectRecord.
 *
 * @param params - Defect record construction parameters and anchor cache handle.
 * @returns Token-frugal AAS defect record.
 */
export function buildDefectRecord(params: DefectRecordParams): AasDefectRecord {
    const issue = params.issue;
    const startLine = issue.location?.start?.line ?? 1;
    const endLine = issue.location?.end?.line ?? startLine;
    const startColumn = issue.location?.start?.column;
    const severityTier = mapSeverity(issue.severity);
    const rawMessage = trimMessage(issue.message);
    const compressedMessage =
        params.options.compressSentences !== false
            ? compressDiagnosticSentence(rawMessage)
            : rawMessage;

    const anchor = resolveDefectAnchor(params, severityTier, startLine, endLine);
    const fixRecipe = buildFixRecipe(issue);
    const verifyCmd = generateVerificationDirective(
        issue,
        params.layer,
        params.options.baseDir || process.cwd(),
    ).command;

    const isNonDefaultVerify = Boolean(verifyCmd && verifyCmd !== params.defaultVerify);

    return {
        line: startLine,
        ...(startColumn !== undefined && startColumn > 1 ? { col: startColumn } : {}),
        rule: issue.rule,
        sev: severityTier,
        msg: compressedMessage,
        ...(anchor ? { anchor } : {}),
        ...(fixRecipe ? { fix: fixRecipe } : {}),
        ...(isNonDefaultVerify ? { verify: verifyCmd } : {}),
        ...(params.options.includeAnalyzer && issue.analyzer ? { analyzer: issue.analyzer } : {}),
        ...(issue.isNew ? { isNew: true } : {}),
        ...projectAdjudicationFields(issue, params.tier),
    };
}
