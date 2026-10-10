/**
 * Module: Core Engine — Incremental Review Memory Domain Matching
 * File Path: src/core/memory/semanticMatcher.ts
 * Architecture Role: Pure decision layer between cached review memory and re-audit; classifies
 *   which domains can be reused verbatim and which changed enough to need selective re-audit
 * Dependencies & Triggers: Imports sha256Hex from ../cacheKey, fingerprint and match-result types
 *   from ./types and computeAstDigest from ./domainFingerprint; called by dualTrackPipeline for
 *   incremental scans and re-exported through the public api module
 * Responsibilities: Hash incoming content; short-circuit exact byte equality; treat equal AST
 *   digests with equal domain counts as line-shift-only and report the start-line delta; index old
 *   domains by kind and name; carry forward old complexity and line-remapped historical
 *   violations for semantic-hash matches; label added, modified and deleted domains; average the
 *   shift across matched domains
 * Exit Semantics & Design Rationale: Pure and side-effect free; domains absent from history are
 *   reported as impacted rather than silently reused so stale findings cannot skip a re-audit,
 *   while byte and AST fast paths avoid re-analysis when only layout moved in the CI edit loop.
 */
import { sha256Hex } from '../cache-key';
import type { CodeDomainFingerprint, DomainMatchResult, ReviewMemoryRecord } from './types';
import { computeAstDigest } from './domainFingerprint';

/**
 * Fast-path check for exact byte equality between old record and new content hash.
 *
 * @param oldRecord - Cached review memory record.
 * @param newContentHash - SHA-256 hex digest of current file content.
 * @returns Verbatim domain match result if bytes match, null otherwise.
 */
function checkFastPathByteMatch(
    oldRecord: ReviewMemoryRecord,
    newContentHash: string,
): DomainMatchResult | null {
    if (oldRecord.fileHash !== newContentHash) {
        return null;
    }
    return {
        unaffectedDomains: oldRecord.codeDomains,
        impactedDomains: [],
        isByteEqual: true,
        isSemanticEqual: true,
        isLineShiftOnly: false,
        lineShiftDelta: 0,
    };
}

/**
 * Fast-path check for structural AST digest equality with unchanged domain counts.
 *
 * @param oldRecord - Cached review memory record.
 * @param newDomains - Domains extracted from current text.
 * @param currentAstDigest - AST digest for current text.
 * @returns Line-shifted match result if AST digests match, null otherwise.
 */
function checkFastPathAstMatch(
    oldRecord: ReviewMemoryRecord,
    newDomains: CodeDomainFingerprint[],
    currentAstDigest: string,
): DomainMatchResult | null {
    if (
        oldRecord.astDigest !== currentAstDigest ||
        oldRecord.codeDomains.length !== newDomains.length
    ) {
        return null;
    }
    const delta =
        (newDomains[0]?.span.startLine ?? 1) - (oldRecord.codeDomains[0]?.span.startLine ?? 1);
    return {
        unaffectedDomains: newDomains,
        impactedDomains: [],
        isByteEqual: false,
        isSemanticEqual: true,
        isLineShiftOnly: true,
        lineShiftDelta: delta,
    };
}

/**
 * Remap line numbers of historical rule violations when a domain shifts position.
 *
 * @param oldDomain - Historical domain fingerprint.
 * @param newDomain - Current domain fingerprint.
 * @param lineDelta - Vertical line offset between revisions.
 * @returns Cloned domain fingerprint with remapped line violations.
 */
function remapDomainViolations(
    oldDomain: CodeDomainFingerprint,
    newDomain: CodeDomainFingerprint,
    lineDelta: number,
): CodeDomainFingerprint {
    const remappedViolations = oldDomain.ruleViolations.map((v) => ({
        ...v,
        line: v.line + lineDelta,
    }));
    return {
        ...newDomain,
        cyclomaticComplexity: oldDomain.cyclomaticComplexity,
        ruleViolations: remappedViolations,
    };
}

/**
 * Fine-grained per-domain matching between historical and newly extracted domains.
 *
 * @param oldDomains - Historical domain list from review memory record.
 * @param newDomains - Newly extracted domain list.
 * @returns Granular domain match result classifying added, modified, and deleted domains.
 */
function diffFineGrainedDomains(
    oldDomains: CodeDomainFingerprint[],
    newDomains: CodeDomainFingerprint[],
): DomainMatchResult {
    const oldDomainMap = new Map<string, CodeDomainFingerprint>();
    for (const d of oldDomains) {
        oldDomainMap.set(`${d.kind}:${d.name}`, d);
    }

    const unaffectedDomains: CodeDomainFingerprint[] = [];
    const impactedDomains: DomainMatchResult['impactedDomains'] = [];

    let totalShiftDelta = 0;
    let shiftCount = 0;
    let allSemanticMatched = true;

    const seenOldKeys = new Set<string>();

    for (const newDomain of newDomains) {
        const key = `${newDomain.kind}:${newDomain.name}`;
        const oldDomain = oldDomainMap.get(key);

        if (!oldDomain) {
            // New domain added
            impactedDomains.push({
                domainId: newDomain.domainId,
                name: newDomain.name,
                span: newDomain.span,
                reason: 'added',
            });
            allSemanticMatched = false;
            continue;
        }

        seenOldKeys.add(key);

        if (oldDomain.semanticHash === newDomain.semanticHash) {
            // Domain content is structurally identical! Reusable.
            const lineDelta = newDomain.span.startLine - oldDomain.span.startLine;
            totalShiftDelta += lineDelta;
            shiftCount++;
            unaffectedDomains.push(remapDomainViolations(oldDomain, newDomain, lineDelta));
        } else {
            // Domain content was modified
            impactedDomains.push({
                domainId: newDomain.domainId,
                name: newDomain.name,
                span: newDomain.span,
                reason: 'modified',
            });
            allSemanticMatched = false;
        }
    }

    // Detect deleted domains
    for (const [key, oldDomain] of oldDomainMap.entries()) {
        if (!seenOldKeys.has(key)) {
            impactedDomains.push({
                domainId: oldDomain.domainId,
                name: oldDomain.name,
                span: oldDomain.span,
                reason: 'deleted',
            });
            allSemanticMatched = false;
        }
    }

    const avgShift = shiftCount > 0 ? Math.round(totalShiftDelta / shiftCount) : 0;
    const isLineShiftOnly = allSemanticMatched && impactedDomains.length === 0;

    return {
        unaffectedDomains,
        impactedDomains,
        isByteEqual: false,
        isSemanticEqual: isLineShiftOnly,
        isLineShiftOnly,
        lineShiftDelta: avgShift,
    };
}

/**
 * Match a file's newly extracted domains against its historical review memory.
 * Decides which domains can be reused without re-analysis and which must be re-audited.
 *
 * Resolution order is deterministic: byte equality of `newContent` first, then AST-digest
 * equality with an unchanged domain count (line shift only), then per-domain key matching by
 * kind and name. Added and deleted domains are always reported as impacted, so stale findings
 * can never skip an audit when history does not explain the current shape.
 *
 * @param oldRecord - Cached record of the previous revision; supplies the byte hash, AST
 *   digest, domain fingerprints and historical violations that may be reused or line-remapped.
 * @param newContent - Current file text; hashed with SHA-256 for the byte-equality fast path.
 * @param newDomains - Domains extracted from the current text, in source order; that order
 *   defines the reported line-shift delta when the AST fast path applies.
 * @param newAstDigest - Optional pre-computed structural digest; when omitted it is derived
 *   from `newContent`, which costs an extra normalization pass.
 * @returns Which domains may be reused verbatim, which need re-audit and why, plus byte,
 *   semantic and line-shift equality flags with the averaged line delta.
 */
export function matchDomains(
    oldRecord: ReviewMemoryRecord,
    newContent: string,
    newDomains: CodeDomainFingerprint[],
    newAstDigest?: string,
): DomainMatchResult {
    const newContentHash = sha256Hex(Buffer.from(newContent, 'utf8'));

    // 1. Exact byte equality
    const byteMatch = checkFastPathByteMatch(oldRecord, newContentHash);
    if (byteMatch) {
        return byteMatch;
    }

    // 2. Structural AST digest equality
    const currentAstDigest = newAstDigest ?? computeAstDigest(undefined, newContent);
    const astMatch = checkFastPathAstMatch(oldRecord, newDomains, currentAstDigest);
    if (astMatch) {
        return astMatch;
    }

    // 3. Domain-level fine-grained matching
    return diffFineGrainedDomains(oldRecord.codeDomains, newDomains);
}
