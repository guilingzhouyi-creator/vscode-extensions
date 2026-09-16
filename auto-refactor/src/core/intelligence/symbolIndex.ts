/**
 * Module: Core Engine — Cross-file Symbol Index (Repository Intelligence foundation)
 * File Path: src/core/intelligence/symbolIndex.ts
 * Architecture Role: The first shared repository-intelligence store: every scan collects the
 *     declarations and call sites its single traversal already visits, and reviewers query this
 *     index instead of re-reading or re-parsing files to answer "where is X defined / used"
 * Dependencies & Triggers: `NormalizedNode`/`NodeKind` from ../../multilang; filled by
 *     `collectSymbols()` inside `Scanner.runAnalyzers` (one pass per file), read by
 *     `api.querySymbols`, the dependency-graph unused-export pass and future reviewers
 * Responsibilities: Aggregate per-file declarations (function/method/class/struct/interface/
 *     trait/impl/variable/constant/field) and call references into by-name maps; answer
 *     `resolve()`, `crossFileReferencesTo()` and `stats()`; keep the maps copy-free for readers
 * Exit Semantics & Design Rationale: Pure in-memory aggregation — no I/O, no throwing. The index
 *     is only as complete as the tree the adapter materialized, so `stats().builtFrom` records
 *     which path produced it (a lazy-projection scan reports `projection` and a reduced index
 *     instead of pretending to be complete). Declarations without a position keep `line: null`
 *     rather than inventing one, because callers use the line to jump into source.
 */
import type { NormalizedNode } from '../multilang';
import { NodeKind } from '../multilang';

/** Kinds of declarations the index records, derived from the language-neutral node kinds. */
export type SymbolKind =
    | 'function'
    | 'method'
    | 'class'
    | 'struct'
    | 'interface'
    | 'trait'
    | 'impl'
    | 'variable'
    | 'constant'
    | 'field';

/** One declaration site. */
export interface SymbolDefinition {
    /** Declared name as written in source. */
    name: string;
    /** Declaration kind, normalized across languages. */
    kind: SymbolKind;
    /** Repository-relative file path (POSIX separators). */
    file: string;
    /** 1-based declaration line, or null when the adapter did not materialize a position. */
    line: number | null;
}

/** One call site referencing a name. */
export interface SymbolReference {
    /** Referenced (callee) name, reduced to its final segment (`a.b.c()` → `c`). */
    name: string;
    /** Repository-relative file path (POSIX separators). */
    file: string;
    /** 1-based call line, or null when the adapter did not materialize a position. */
    line: number | null;
    /** Reference flavour; only direct calls are collected today. */
    kind: 'call';

    /** Enclosing declaration of the call site, or null when it could not be attributed. */
    caller?: string | null;

    /** 1-based call column, or null when no position was materialized. */
    column?: number | null;
}

/** Aggregate counters used by the report summary and by callers that assert coverage. */
export interface SymbolIndexStats {
    /** Files whose tree contributed symbols. */
    files: number;
    /** Recorded declaration sites. */
    definitions: number;
    /** Distinct declared names. */
    definitionNames: number;
    /** Recorded call sites. */
    references: number;
    /** Call sites whose name resolves to a declaration in a DIFFERENT file. */
    crossFileReferences: number;
    /** How the underlying tree was produced: materialized tree, or a reduced projection. */
    builtFrom: 'materialized' | 'projection';
}

/** Map a language-neutral node kind to a declaration kind, or null when it declares nothing. */
function declarationKindOf(kind: NodeKind): SymbolKind | null {
    switch (kind) {
        case NodeKind.Function:
            return 'function';
        case NodeKind.Method:
            return 'method';
        case NodeKind.Class:
            return 'class';
        case NodeKind.Struct:
            return 'struct';
        case NodeKind.Interface:
            return 'interface';
        case NodeKind.Trait:
            return 'trait';
        case NodeKind.Impl:
            return 'impl';
        case NodeKind.Variable:
            return 'variable';
        case NodeKind.Constant:
            return 'constant';
        case NodeKind.Field:
            return 'field';
        default:
            return null;
    }
}

/**
 * Collect the declarations and call sites of one file's normalized tree.
 *
 * The walk is iterative (explicit stack) because normalized trees reach tens of thousands of
 * nodes; recursion would trade a stack overflow risk for nothing. A declaration is recorded when
 * the node carries a name (or a `bindingName` for bindings), and a reference when a call node
 * carries a callee name — the two facts the adapters already materialize for their own analyzers.
 *
 * @param root - Normalized AST root for one file.
 * @param filePath - Repository-relative path, normalized to POSIX separators.
 * @param caller - Enclosing declaration name for the first frame, or null at file level.
 * @returns Declarations and call references found in this file.
 */
export function collectSymbols(
    root: NormalizedNode,
    filePath: string,
    caller: string | null = null,
): { definitions: SymbolDefinition[]; references: SymbolReference[] } {
    const file = filePath.replace(/\\/g, '/');
    const definitions: SymbolDefinition[] = [];
    const references: SymbolReference[] = [];
    // Frames carry the nearest enclosing declaration so a call site is attributed to the function
    // it lives in without a second traversal (the projection path passes the caller in directly).
    const stack: Array<{ node: NormalizedNode; caller: string | null }> = [{ node: root, caller }];
    while (stack.length > 0) {
        const frame = stack.pop() as { node: NormalizedNode; caller: string | null };
        const node = frame.node;
        const kind = declarationKindOf(node.kind);
        const name = node.name ?? node.bindingName ?? null;
        let childCaller = frame.caller;
        if (kind && typeof name === 'string' && name.length > 0) {
            definitions.push({ name, kind, file, line: node.start?.line ?? null });
            childCaller = name;
        } else if (node.kind === NodeKind.Call && typeof name === 'string' && name.length > 0) {
            references.push({
                name,
                file,
                line: node.start?.line ?? null,
                column: node.start?.column ?? null,
                kind: 'call',
                caller: frame.caller,
            });
        }
        const children = node.children;
        if (children) {
            for (let i = 0; i < children.length; i += 1) {
                stack.push({ node: children[i], caller: childCaller });
            }
        }
    }
    return { definitions, references };
}

/** Cross-file symbol store: by-name definitions plus by-name call references. */
export class SymbolIndex {
    private readonly definitions = new Map<string, SymbolDefinition[]>();
    private readonly references = new Map<string, SymbolReference[]>();
    private readonly files = new Set<string>();

    // Site keys make the index idempotent: the lazy path observes a projected parent and its
    // materialized children, so the same declaration or call can arrive twice. Without this the
    // published counters (and every cross-file question) would depend on the traversal used.
    private readonly seenDefinitions = new Set<string>();

    private readonly seenReferences = new Set<string>();
    private builtFrom: 'materialized' | 'projection' = 'materialized';

    /**
     * Record a batch of declarations (one file's worth from `collectSymbols`).
     *
     * @param definitions - Declaration sites to append; empty batches are ignored.
     */
    addDefinitions(definitions: SymbolDefinition[]): void {
        for (const definition of definitions) {
            const key = `${definition.name}|${definition.kind}|${definition.file}|${definition.line ?? ''}`;
            if (this.seenDefinitions.has(key)) continue;
            this.seenDefinitions.add(key);
            const list = this.definitions.get(definition.name);
            if (list) list.push(definition);
            else this.definitions.set(definition.name, [definition]);
            this.files.add(definition.file);
        }
    }

    /**
     * Record a batch of call references.
     *
     * @param references - Call sites to append; empty batches are ignored.
     */
    addReferences(references: SymbolReference[]): void {
        for (const reference of references) {
            const key = `${reference.name}|${reference.file}|${reference.line ?? ''}|${reference.column ?? ''}|${reference.caller ?? ''}`;
            if (this.seenReferences.has(key)) continue;
            this.seenReferences.add(key);
            const list = this.references.get(reference.name);
            if (list) list.push(reference);
            else this.references.set(reference.name, [reference]);
            this.files.add(reference.file);
        }
    }

    /**
     * Record how the underlying trees were produced, so callers can qualify completeness.
     *
     * @param source - `materialized` for a full tree, `projection` for a reduced lazy tree.
     */
    markBuiltFrom(source: 'materialized' | 'projection'): void {
        this.builtFrom = source;
    }

    /**
     * Resolve every declaration of a name together with its call sites.
     *
     * @param name - Declared or called name to look up.
     * @returns The recorded definitions and references (empty arrays when the name is unknown).
     */
    resolve(name: string): { definitions: SymbolDefinition[]; references: SymbolReference[] } {
        return {
            definitions: [...(this.definitions.get(name) ?? [])],
            references: [...(this.references.get(name) ?? [])],
        };
    }

    /**
     * List the call sites of a name that sit in a file other than a given declaration's file.
     *
     * This is the cross-file impact question every reviewer asks ("who else calls this?"); a call
     * in the declaration's own file is reported as same-file and filtered out by default.
     *
     * @param name - Declared name to inspect.
     * @param definitionFile - File that owns the declaration being changed.
     * @returns Cross-file call sites, in file/line order.
     */
    crossFileReferencesTo(name: string, definitionFile: string): SymbolReference[] {
        const home = definitionFile.replace(/\\/g, '/');
        return (this.references.get(name) ?? [])
            .filter((reference) => reference.file !== home)
            .sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
    }

    /**
     * List every declared name the index knows.
     *
     * @returns Sorted names; used by diagnostics and by the CLI overview.
     */
    names(): string[] {
        return [...this.definitions.keys()].sort();
    }

    /**
     * List every name that is called anywhere, including unresolved (external) calls.
     *
     * @returns Sorted callee names; the call graph needs these so unresolved calls are not dropped.
     */
    calledNames(): string[] {
        return [...this.references.keys()].sort();
    }

    /**
     * Report coverage counters for the report summary and for validators.
     *
     * @returns Aggregate stats; `crossFileReferences` counts call sites whose name resolves to a
     *   declaration owned by a different file.
     */
    stats(): SymbolIndexStats {
        let definitions = 0;
        for (const list of this.definitions.values()) definitions += list.length;
        let references = 0;
        let crossFileReferences = 0;
        for (const [name, list] of this.references) {
            references += list.length;
            const homes = new Set((this.definitions.get(name) ?? []).map((d) => d.file));
            if (homes.size === 0) continue;
            for (const reference of list) {
                if ([...homes].some((home) => home !== reference.file)) crossFileReferences += 1;
            }
        }
        return {
            files: this.files.size,
            definitions,
            definitionNames: this.definitions.size,
            references,
            crossFileReferences,
            builtFrom: this.builtFrom,
        };
    }
}
