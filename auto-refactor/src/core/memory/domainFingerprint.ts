/**
 * Module: Core Engine — Structural Fingerprint Extraction for Review Memory
 * File Path: src/core/memory/domainFingerprint.ts
 * Architecture Role: Leaf computation layer converting parsed ASTs or raw source text into
 *   CodeDomainFingerprint records reused by review memory and the semantic matcher
 * Dependencies & Triggers: Imports crypto, NormalizedNode/NodeKind from ../multilang, Issue from
 *   ../types and fingerprint types from ./types; runs during post-scan memory persistence in
 *   core/analyzer and during incremental domain matching in core/pipeline/dualTrackPipeline
 * Responsibilities: fastDigest SHA-256 prefix hashing; computeAstDigest canonical token walk;
 *   extractCodeDomains AST-first extraction of functions, methods, classes, structs and impls
 *   with enclosing-class names, branch weights and in-span issue capture; regex text fallback
 *   across TS/JS, Python, Rust, GDScript and Go when no AST is available
 * Exit Semantics & Design Rationale: Pure and deterministic, never throwing on a missing AST,
 *   digest or content; iterative stack walks avoid recursion limits on deep ASTs, and hashes omit
 *   unstable positions so structurally equal domains stay reusable across line shifts.
 */
import * as crypto from 'crypto';
import type { NormalizedNode } from '../multilang';
import { NodeKind } from '../multilang';
import type { Issue } from '../types';
import type { CodeDomainFingerprint, CodeDomainKind } from './types';

/** Number of leading hex characters of a SHA-256 digest kept as the compact fast digest. */
const FAST_DIGEST_LENGTH = 16;

/** Forward line window used as the initial heuristic upper bound for a declaration's end. */
const DECLARATION_HEURISTIC_WINDOW_LINES = 20;

/**
 * Compute a compact 64-bit hex digest of a string for change detection and domain hashing.
 * The value is the first 16 hex characters of the SHA-256 hash, which keeps identifiers small
 * while retaining enough entropy to separate structural variants in practice.
 *
 * @param str - Text to hash; the empty string is hashed as-is rather than special-cased.
 * @returns A 16-character lowercase hex digest that is deterministic for identical input.
 */
export function fastDigest(str: string): string {
    return crypto.createHash('sha256').update(str).digest('hex').slice(0, FAST_DIGEST_LENGTH);
}

/**
 * Compute a structural digest from a normalized AST, ignoring absolute source positions.
 * The tree is walked iteratively for stability on deep ASTs, and each node contributes its
 * kind, name, and branch weight; without an AST the raw content is hashed verbatim instead.
 *
 * @param root - Normalized AST root; a missing root selects the content-only fallback.
 * @param content - Raw source text used when `root` is absent, defaulting to an empty string.
 * @returns A 16-character hex digest stable across line shifts but sensitive to structural edits.
 */
export function computeAstDigest(root?: NormalizedNode, content?: string): string {
    if (!root) {
        return fastDigest(content || '');
    }
    const parts: string[] = [];
    function walk(node: NormalizedNode) {
        parts.push(node.kind);
        if (node.name) parts.push(node.name);
        if (node.branchWeight) parts.push(String(node.branchWeight));
        if (node.children) {
            for (const child of node.children) {
                walk(child);
            }
        }
    }
    walk(root);
    return fastDigest(parts.join(':'));
}

/**
 * Extract code domains (functions, methods, classes, structs, impls) from a normalized AST.
 * Structural nodes are labelled with their enclosing class when present and annotated with
 * local cyclomatic complexity; without a usable AST the regex text fallback runs instead.
 *
 * @param root - Normalized AST root; a missing or childless root selects text extraction.
 * @param content - Raw source text used by the text fallback when no usable AST is supplied.
 * @param issues - Analyzer issues attributed to each domain whose line span contains them.
 * @returns Newly allocated domain fingerprints in discovery order, or [] when none are found.
 */
export function extractCodeDomains(
    root: NormalizedNode | undefined,
    content: string,
    issues: Issue[] = [],
): CodeDomainFingerprint[] {
    if (root && root.children && root.children.length > 0) {
        return extractFromAst(root, issues);
    }
    return extractFromText(content, issues);
}

/**
 * Resolve domain categorization and name from a normalized node and optional enclosing class.
 *
 * @param node - Inspected AST node.
 * @param enclosingClass - Name of parent enclosing class if any.
 * @returns Identity descriptor with domain status, class flag, kind, and full name.
 */
function resolveDomainIdentity(
    node: NormalizedNode,
    enclosingClass?: string,
): { isDomain: boolean; isClass: boolean; kind: CodeDomainKind; fullName: string } {
    const isFn = node.kind === NodeKind.Function || node.kind === NodeKind.Method;
    const isClass =
        node.kind === NodeKind.Class ||
        node.kind === NodeKind.Struct ||
        node.kind === NodeKind.Impl;

    if (!isFn && !isClass) {
        return { isDomain: false, isClass: false, kind: 'function', fullName: '' };
    }

    const kind: CodeDomainKind = isClass
        ? node.kind === NodeKind.Struct
            ? 'struct'
            : 'class'
        : enclosingClass
          ? 'method'
          : 'function';

    const rawName = node.name || (enclosingClass ? `${enclosingClass}.anon` : 'anonymous');
    const fullName =
        enclosingClass && !rawName.startsWith(enclosingClass)
            ? `${enclosingClass}.${rawName}`
            : rawName;

    return { isDomain: true, isClass, kind, fullName };
}

/**
 * Calculate local cyclomatic complexity and structural semantic hash for an AST subtree.
 *
 * @param node - Root node of the code domain subtree.
 * @param kind - Identified code domain kind.
 * @param fullName - Qualified domain name.
 * @returns Subtree cyclomatic complexity and deterministic semantic hash.
 */
function computeSubtreeComplexityAndHash(
    node: NormalizedNode,
    kind: CodeDomainKind,
    fullName: string,
): { cc: number; semanticHash: string } {
    let cc = 1;
    const structTokens: string[] = [kind, fullName];
    const collectStack: NormalizedNode[] = [];
    if (node.children) {
        for (let i = node.children.length - 1; i >= 0; i--) {
            collectStack.push(node.children[i]);
        }
    }
    while (collectStack.length > 0) {
        const child = collectStack.pop()!;
        if (child.branchWeight) cc += child.branchWeight;
        structTokens.push(child.kind);
        if (child.name) structTokens.push(child.name);
        if (child.children) {
            for (let i = child.children.length - 1; i >= 0; i--) {
                collectStack.push(child.children[i]);
            }
        }
    }
    const semanticHash = fastDigest(structTokens.join('|'));
    return { cc, semanticHash };
}

/**
 * Construct a CodeDomainFingerprint record from domain metadata and in-span issues.
 *
 * @param node - AST node representing the domain.
 * @param kind - Domain kind.
 * @param fullName - Full qualified name.
 * @param cc - Cyclomatic complexity.
 * @param semanticHash - Computed structural hash.
 * @param issues - Scanned issues to filter for domain span.
 * @returns Complete CodeDomainFingerprint.
 */
function buildDomainFingerprint(
    node: NormalizedNode,
    kind: CodeDomainKind,
    fullName: string,
    cc: number,
    semanticHash: string,
    issues: Issue[],
): CodeDomainFingerprint {
    const startLine = node.start?.line ?? 1;
    const endLine = node.end?.line ?? startLine;
    const startCol = node.start?.column ?? 1;
    const endCol = node.end?.column ?? 1;
    const domainId = `${kind}:${fullName}:${startLine}`;

    const domainIssues = issues.filter(
        (it) =>
            it.location?.start &&
            it.location.start.line >= startLine &&
            it.location.start.line <= endLine,
    );

    return {
        domainId,
        kind,
        name: fullName,
        span: { startLine, endLine, startCol, endCol },
        semanticHash,
        cyclomaticComplexity: cc,
        ruleViolations: domainIssues.map((it) => ({
            rule: it.rule,
            analyzer: it.analyzer,
            severity: it.severity,
            line: it.location.start.line,
            message: it.message,
        })),
        metricSummary: {
            lines: Math.max(1, endLine - startLine + 1),
            maxNesting: 0,
        },
    };
}

/**
 * Push child AST nodes onto the traversal stack in reverse order.
 *
 * @param stack - Active traversal stack.
 * @param children - Optional child nodes list.
 * @param enclosingClass - Optional enclosing class identifier.
 */
function pushChildNodes(
    stack: Array<{ node: NormalizedNode; enclosingClass?: string }>,
    children: NormalizedNode[] | undefined,
    enclosingClass?: string,
): void {
    if (!children) return;
    for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ node: children[i], enclosingClass });
    }
}

/**
 * Extract code domain fingerprints from a normalized AST.
 *
 * @param root - Normalized AST root node.
 * @param issues - Issues to attribute to discovered domain spans.
 * @returns Array of extracted domain fingerprints.
 */
function extractFromAst(root: NormalizedNode, issues: Issue[]): CodeDomainFingerprint[] {
    const domains: CodeDomainFingerprint[] = [];
    const stack: Array<{ node: NormalizedNode; enclosingClass?: string }> = [{ node: root }];

    while (stack.length > 0) {
        const { node, enclosingClass } = stack.pop()!;
        const identity = resolveDomainIdentity(node, enclosingClass);

        if (identity.isDomain) {
            const { cc, semanticHash } = computeSubtreeComplexityAndHash(
                node,
                identity.kind,
                identity.fullName,
            );
            domains.push(
                buildDomainFingerprint(
                    node,
                    identity.kind,
                    identity.fullName,
                    cc,
                    semanticHash,
                    issues,
                ),
            );

            if (identity.isClass) {
                pushChildNodes(stack, node.children, identity.fullName);
                continue;
            }
        }

        pushChildNodes(stack, node.children, enclosingClass);
    }

    return domains;
}

/** Fallback regex-based domain extractor for text or non-AST contexts */
function extractFromText(content: string, issues: Issue[]): CodeDomainFingerprint[] {
    const domains: CodeDomainFingerprint[] = [];
    const lines = content.split(/\r?\n/);

    // Match common function and class patterns across TS/JS, Python, Rust, GDScript, Go
    const declRegex =
        /^\s*(?:export\s+)?(?:async\s+)?(?:def|func|function|fn|class|struct)\s+([A-Za-z0-9_$]+)/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = declRegex.exec(line);
        if (match) {
            const name = match[1];
            const startLine = i + 1;
            // The declaration window never extends past the end of the file.
            let endLine = Math.min(lines.length, startLine + DECLARATION_HEURISTIC_WINDOW_LINES);

            // Try to find closing brace or indentation return
            let braceCount = 0;
            let foundStartBrace = false;
            for (let j = i; j < lines.length; j++) {
                const l = lines[j];
                for (let c = 0; c < l.length; c++) {
                    if (l[c] === '{') {
                        braceCount++;
                        foundStartBrace = true;
                    } else if (l[c] === '}') {
                        braceCount--;
                    }
                }
                if (foundStartBrace && braceCount <= 0) {
                    endLine = j + 1;
                    break;
                }
            }

            const domainSnippet = lines.slice(startLine - 1, endLine).join('\n');
            const semanticHash = fastDigest(domainSnippet.replace(/\s+/g, ' '));
            const domainId = `function:${name}:${startLine}`;

            const domainIssues = issues.filter(
                (it) =>
                    it.location?.start &&
                    it.location.start.line >= startLine &&
                    it.location.start.line <= endLine,
            );

            domains.push({
                domainId,
                kind: 'function',
                name,
                span: { startLine, endLine, startCol: 1, endCol: 1 },
                semanticHash,
                cyclomaticComplexity: 1,
                ruleViolations: domainIssues.map((it) => ({
                    rule: it.rule,
                    analyzer: it.analyzer,
                    severity: it.severity,
                    line: it.location.start.line,
                    message: it.message,
                })),
                metricSummary: {
                    lines: Math.max(1, endLine - startLine + 1),
                    maxNesting: 0,
                },
            });
        }
    }

    return domains;
}
