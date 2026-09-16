/**
 * Module: Core Engine - Cross-file Literal Index (Repository Intelligence foundation)
 * File Path: src/core/intelligence/literalIndex.ts
 * Architecture Role: The second shared repository-intelligence store: it turns the literal sites
 *     the single traversal already visits into cross-file frequency plus an explicit meaning
 *     split, so a reviewer asks the store whether a value is shared and whether it means one
 *     thing, instead of re-reading or re-parsing files
 * Dependencies & Triggers: `NodeKind` from ../../multilang; filled by `LiteralIndex.addTree()`
 *     from the scanner (projection path via the `onNode` observer, materialized path via the
 *     file tree), read by the constants reviewer and published as `summary.literalIndex`
 * Responsibilities: Record every literal occurrence once (position-keyed), attribute it to the
 *     enclosing declaration, infer a usage role from structural evidence only, and aggregate
 *     values into cross-file clusters with the same-value-different-meaning split
 * Exit Semantics & Design Rationale: Pure in-memory aggregation - no I/O, no throwing. Roles are
 *     inferred, never guessed: anything the evidence cannot attribute stays `unknown`, and the
 *     meaning split keeps same-value-different-meaning sites as separate obligations. Overlapping
 *     observation (a projected parent plus its materialized children) is idempotent by design, so
 *     both traversal paths can feed one store.
 */
import { NodeKind } from '../multilang';

/** Usage roles a literal can play. Inferred from path, declaration name and value evidence. */
export const LITERAL_ROLE = {
    FIXTURE: 'fixture',
    GENERATED: 'generated',
    PROTOCOL: 'protocol',
    ALGORITHM: 'algorithm',
    UNKNOWN: 'unknown',
} as const;

/** Union of the supported literal usage roles. */
export type LiteralRole = (typeof LITERAL_ROLE)[keyof typeof LITERAL_ROLE];

/** Minimal structural view of a node, so this module never depends on a concrete adapter. */
export interface LiteralNodeView {
    /** Normalized node kind. */
    kind: NodeKind;
    /** Source text of the node, when the projection kept it. */
    text?: string;
    /** Declared name of the node, when it has one. */
    name?: string | null;
    /** Source position of the node. */
    start?: { line: number; column: number };
    /** Child nodes, when the node was materialized. */
    children?: readonly LiteralNodeView[];
}

/** One observed literal usage site. */
export interface LiteralOccurrence {
    /** Repository-relative file the literal appears in. */
    file: string;
    /** One-based source line. */
    line: number;
    /** One-based source column. */
    column: number;
    /** Kind of the literal node. */
    kind: NodeKind;
    /** Inferred usage role. */
    role: LiteralRole;
    /** Enclosing declaration name, when it could be attributed. */
    symbol: string | null;
}

/** One distinct meaning of a value: a usage role together with the declaration using it. */
export interface LiteralMeaning {
    /** Inferred usage role. */
    role: LiteralRole;
    /** Enclosing declaration name, or null when unattributed. */
    symbol: string | null;
    /** Files this specific meaning was observed in. */
    files: string[];
    /** Occurrence count of this meaning. */
    occurrences: number;
}

/** Aggregated view of one literal value across all scanned files. */
export interface LiteralEntry {
    /** Raw literal spelling, as written in the source. */
    value: string;
    /** Kind of the first observed occurrence. */
    kind: NodeKind;
    /** Total occurrence count. */
    occurrences: number;
    /** Files the value was observed in. */
    files: string[];
    /** Distinct meanings, i.e. the same-value-different-meaning split. */
    meanings: LiteralMeaning[];
    /** True when the value appears in more than one file. */
    crossFile: boolean;
    /** True when the value carries more than one meaning and must not be merged blindly. */
    multiMeaning: boolean;

    /** Representative occurrence, used for issue locations. */
    firstSite: LiteralOccurrence;
}

/** Published counters and provenance of the cross-file literal store. */
export interface LiteralIndexStats {
    /** Files that contributed at least one literal. */
    files: number;
    /** Distinct literal values observed. */
    values: number;
    /** Total literal occurrences observed. */
    occurrences: number;
    /** Values seen in two or more files. */
    crossFileValues: number;
    /** Values carrying more than one meaning. */
    multiMeaningValues: number;
    /** Occurrences per inferred role. */
    byRole: Record<string, number>;
    /** Traversal that fed the store. */
    builtFrom: string;
}

const ROLE_OF = LITERAL_ROLE;

const FIXTURE_PATH = /(^|\/)(tests?|specs?|fixtures?|__tests__|samples?|mocks?)(\/|$)/i;
const GENERATED_PATH = /(^|\/)(generated|vendor|dist|third_party)(\/|$)|\.(min|gen|g)\./i;
const GENERATED_VALUE =
    /^[0-9a-f]{16,}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCREAMING_NAME = /^[A-Z][A-Z0-9_]{2,}$/;
const ALGORITHM_NAME =
    /hash|crc|prime|stride|offset|mask|seed|threshold|budget|factor|scale|window|batch|capacity|limit/i;

const LITERAL_KINDS: ReadonlySet<NodeKind> = new Set([
    NodeKind.NumericLiteral,
    NodeKind.StringLiteral,
    NodeKind.Literal,
]);

/**
 * Infer the usage role of one literal from structural evidence only.
 *
 * Evidence is ordered strongest first: the file's role (test fixture), then generated code,
 * then a protocol-style declaration or spelling, then algorithm-tuning spelling. Anything that
 * cannot be attributed from evidence stays `unknown` rather than being guessed.
 *
 * @param file - Repository-relative file path.
 * @param symbol - Enclosing declaration name, when known.
 * @param value - Raw literal spelling.
 * @param kind - Kind of the literal node.
 * @returns The inferred role.
 */
export function classifyLiteralRole(
    file: string,
    symbol: string | null,
    value: string,
    kind: NodeKind,
): LiteralRole {
    if (FIXTURE_PATH.test(file)) return ROLE_OF.FIXTURE;
    if (GENERATED_PATH.test(file) || GENERATED_VALUE.test(value)) return ROLE_OF.GENERATED;
    if (kind === NodeKind.StringLiteral && SCREAMING_NAME.test(value)) return ROLE_OF.PROTOCOL;
    if (symbol !== null && SCREAMING_NAME.test(symbol)) return ROLE_OF.PROTOCOL;
    if (symbol !== null && ALGORITHM_NAME.test(symbol)) return ROLE_OF.ALGORITHM;
    return ROLE_OF.UNKNOWN;
}

/**
 * Cross-file literal store filled by the shared traversal.
 *
 * The store is intentionally idempotent per site: callers may hand it overlapping subtrees
 * (the lazy projection path observes parents whose children were materialized too), and
 * occurrences are de-duplicated by file, position, kind and value so counts stay exact.
 */
export class LiteralIndex {
    private readonly byValue = new Map<string, LiteralOccurrence[]>();

    private readonly seen = new Set<string>();

    private readonly contributingFiles = new Set<string>();

    private builtFrom = 'unset';

    /**
     * Record every literal inside one subtree, carrying the enclosing declaration name down the
     * walk so each occurrence is attributed without a second traversal.
     *
     * @param file - Repository-relative file path.
     * @param root - Subtree root to walk.
     */
    addTree(file: string, root: LiteralNodeView): void {
        const stack: Array<{ node: LiteralNodeView; symbol: string | null }> = [
            { node: root, symbol: null },
        ];
        while (stack.length > 0) {
            const frame = stack.pop() as { node: LiteralNodeView; symbol: string | null };
            const node = frame.node;
            if (LITERAL_KINDS.has(node.kind)) {
                this.record(file, node, frame.symbol);
                continue;
            }
            const declared =
                typeof node.name === 'string' && node.name.length > 0 ? node.name : null;
            const symbol = frame.symbol ?? declared;
            const children = node.children;
            if (children === undefined) continue;
            for (let i = children.length - 1; i >= 0; i -= 1) {
                stack.push({ node: children[i], symbol });
            }
        }
    }

    /**
     * Record the traversal that fed this store.
     *
     * @param source - Traversal provenance, e.g. `materialized` or `projection`.
     */
    markBuiltFrom(source: string): void {
        this.builtFrom = source;
    }

    /**
     * Aggregate every value observed so far.
     *
     * @returns One entry per distinct literal value, richest first.
     */
    entries(): LiteralEntry[] {
        const entries: LiteralEntry[] = [];
        for (const [value, occurrences] of this.byValue) {
            entries.push(this.entryOf(value, occurrences));
        }
        entries.sort((a, b) => b.occurrences - a.occurrences || (a.value < b.value ? -1 : 1));
        return entries;
    }

    /**
     * Values that appear in at least `minFiles` files.
     *
     * @param minFiles - Cross-file threshold; defaults to two files.
     * @returns Clustered entries, most frequent first.
     */
    clusters(minFiles = 2): LiteralEntry[] {
        return this.entries().filter((entry) => entry.files.length >= minFiles);
    }

    /**
     * All observed sites of one literal value.
     *
     * @param value - Literal spelling to look up.
     * @returns The occurrences list, or an empty array when unseen.
     */
    sitesOf(value: string): LiteralOccurrence[] {
        return this.byValue.get(value) ?? [];
    }

    /**
     * Published counters for the scan summary.
     *
     * @returns The aggregate statistics.
     */
    stats(): LiteralIndexStats {
        const byRole: Record<string, number> = {};
        let occurrences = 0;
        for (const sites of this.byValue.values()) {
            for (const site of sites) {
                occurrences += 1;
                byRole[site.role] = (byRole[site.role] ?? 0) + 1;
            }
        }
        const entries = this.entries();
        return {
            files: this.contributingFiles.size,
            values: entries.length,
            occurrences,
            crossFileValues: entries.filter((entry) => entry.crossFile).length,
            multiMeaningValues: entries.filter((entry) => entry.multiMeaning).length,
            byRole,
            builtFrom: this.builtFrom,
        };
    }

    private record(file: string, node: LiteralNodeView, symbol: string | null): void {
        const value = node.text ?? '';
        if (value.length === 0) return;
        const line = node.start?.line ?? 0;
        const column = node.start?.column ?? 0;
        const key = `${file}|${line}|${column}|${node.kind}|${value}`;
        if (this.seen.has(key)) return;
        this.seen.add(key);
        const site: LiteralOccurrence = {
            file,
            line,
            column,
            kind: node.kind,
            role: classifyLiteralRole(file, symbol, value, node.kind),
            symbol,
        };
        this.contributingFiles.add(file);
        const existing = this.byValue.get(value);
        if (existing === undefined) this.byValue.set(value, [site]);
        else existing.push(site);
    }

    private entryOf(value: string, occurrences: LiteralOccurrence[]): LiteralEntry {
        const files = new Set<string>();
        const meanings = new Map<string, LiteralMeaning>();
        for (const site of occurrences) {
            files.add(site.file);
            const key = `${site.role}|${site.symbol ?? ''}`;
            const meaning = meanings.get(key);
            if (meaning === undefined) {
                meanings.set(key, {
                    role: site.role,
                    symbol: site.symbol,
                    files: [site.file],
                    occurrences: 1,
                });
            } else {
                meaning.occurrences += 1;
                if (!meaning.files.includes(site.file)) meaning.files.push(site.file);
            }
        }
        const meaningList = [...meanings.values()];
        return {
            value,
            kind: occurrences[0].kind,
            occurrences: occurrences.length,
            files: [...files],
            meanings: meaningList,
            crossFile: files.size > 1,
            multiMeaning: meaningList.length > 1,
            firstSite: occurrences[0],
        };
    }
}
