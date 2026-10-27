/**
 * Module: Core Engine — Sliding Symbol Stream (Bounded Symbol-Index View)
 * File Path: src/core/intelligence/sliding-symbol-stream.ts
 * Architecture Role: Bounded working-set view over the shared symbol index. The index itself keeps
 *   every declaration and call site of a scan, which is correct for a repository-sized corpus but
 *   unbounded for a monorepo. This stream admits files in scan order and evicts the least salient
 *   ones once the active set is full, so reference-graph memory stays flat while the compact
 *   definition map still answers "where is X declared".
 * Dependencies & Triggers: Consumes SymbolIndex/SymbolDefinition/SymbolReference from
 *   ./symbolIndex; offered through SymbolIndex.createSlidingView and used by callers that scan
 *   very large repositories in one process.
 * Responsibilities:
 *   1. Admit one file's declarations and references into the bounded active set.
 *   2. Score saliency from accumulated reference count with recency as the tie-break.
 *   3. Answer definition/reference queries against the surviving active set.
 *   4. Report eviction and occupancy telemetry so callers can prove the bound held.
 * Exit Semantics & Design Rationale: Synchronous, deterministic, never throws. Eviction removes the
 *   reference edges of a file but keeps its declarations in a compact name map, because "the symbol
 *   exists somewhere" is cheap to retain while call edges are what grow without bound. Eviction
 *   visits only the callee buckets the evicted file actually touched, so dropping one file never
 *   walks the whole reference map. Queries that touch an evicted file report the file as inactive
 *   rather than returning a silently empty list, so a caller can tell "no such call" from "this
 *   file was evicted".
 */

import type { SymbolDefinition, SymbolIndex, SymbolReference } from './symbolIndex';

/** Default active-file budget of one sliding stream. */
export const DEFAULT_MAX_ACTIVE_FILES = 512;

/** Per-file accumulator held while the file is active. */
interface ActiveFileRecord {
    /** Monotonic admission sequence number; larger means more recently touched. */
    sequence: number;
    /** Number of call references recorded for this file. */
    referenceCount: number;
}

/** Declarations and call edges grouped under one file while seeding a view. */
interface FileBucket {
    definitions: SymbolDefinition[];
    references: SymbolReference[];
}

/** Occupancy and eviction telemetry for one sliding stream. */
export interface SlidingSymbolStats {
    /** Files currently holding reference edges. */
    activeFiles: number;
    /** Files whose reference edges were dropped by eviction. */
    evictedFiles: number;
    /** Declarations retained in the compact name map. */
    retainedDefinitions: number;
    /** Reference edges currently retained. */
    retainedReferences: number;
    /** Configured active-file budget. */
    budget: number;
}

/**
 * Bounded, saliency-based view over a symbol index.
 */
export class SlidingSymbolStream {
    private readonly maxActiveFiles: number;

    private readonly active = new Map<string, ActiveFileRecord>();

    /** Compact name map: declarations survive eviction, call edges do not. */
    private readonly definitionsByName = new Map<string, SymbolDefinition[]>();

    /** Reference edges of the active files only, keyed by callee name. */
    private readonly referencesByName = new Map<string, SymbolReference[]>();

    /** Callee names touched by each active file, so eviction touches only those buckets. */
    private readonly referenceNamesByFile = new Map<string, Set<string>>();

    private sequenceCounter = 0;

    private evictedFiles = 0;

    private retainedDefinitions = 0;

    private retainedReferences = 0;

    public constructor(maxActiveFiles: number = DEFAULT_MAX_ACTIVE_FILES) {
        this.maxActiveFiles = Math.max(1, maxActiveFiles);
    }

    /**
     * Admit one file's declarations and references into the bounded working set.
     *
     * @param filePath - Repository-relative path normalized by the caller.
     * @param definitions - Declarations collected from this file.
     * @param references - Call sites collected from this file.
     */
    public admit(
        filePath: string,
        definitions: readonly SymbolDefinition[],
        references: readonly SymbolReference[],
    ): void {
        if (!filePath) return;
        if (!this.active.has(filePath)) {
            this.evictUntilRoom();
        }
        this.sequenceCounter += 1;
        const record = this.active.get(filePath) ?? { sequence: 0, referenceCount: 0 };
        record.sequence = this.sequenceCounter;
        record.referenceCount += references.length;
        this.active.set(filePath, record);
        this.addDefinitions(definitions);
        this.addReferences(filePath, references);
    }

    /**
     * Whether a file currently holds reference edges in this view.
     *
     * @param filePath - File to test.
     * @returns True when the file is active.
     */
    public isActive(filePath: string): boolean {
        return this.active.has(filePath);
    }

    /**
     * Declarations recorded for a name, including those of evicted files.
     *
     * @param name - Declared symbol name.
     * @returns Retained declarations; empty when unknown.
     */
    public definitionsOf(name: string): SymbolDefinition[] {
        return [...(this.definitionsByName.get(name) ?? [])];
    }

    /**
     * Reference edges recorded for a name among the active files.
     *
     * @param name - Called symbol name.
     * @returns Retained call sites; empty when unknown or evicted.
     */
    public referencesOf(name: string): SymbolReference[] {
        return [...(this.referencesByName.get(name) ?? [])];
    }

    /**
     * Resolve a name against the bounded view.
     *
     * @param name - Declared or called name.
     * @returns Retained declarations plus active call sites.
     */
    public resolve(name: string): {
        definitions: SymbolDefinition[];
        references: SymbolReference[];
    } {
        return { definitions: this.definitionsOf(name), references: this.referencesOf(name) };
    }

    /**
     * Occupancy and eviction counters.
     *
     * @returns Current stream telemetry.
     */
    public stats(): SlidingSymbolStats {
        return {
            activeFiles: this.active.size,
            evictedFiles: this.evictedFiles,
            retainedDefinitions: this.retainedDefinitions,
            retainedReferences: this.retainedReferences,
            budget: this.maxActiveFiles,
        };
    }

    /**
     * Build a bounded view from a fully materialized index.
     *
     * Admitting every file of an existing index in name order keeps the result deterministic: the
     * surviving set depends on saliency and admission order, not on map iteration order.
     *
     * @param index - Source index whose declarations and references seed the view.
     * @param maxActiveFiles - Active-file budget for the resulting view.
     * @returns A bounded view over the same facts.
     */
    public static fromIndex(
        index: SymbolIndex,
        maxActiveFiles: number = DEFAULT_MAX_ACTIVE_FILES,
    ): SlidingSymbolStream {
        const stream = new SlidingSymbolStream(maxActiveFiles);
        const byFile = new Map<string, FileBucket>();
        for (const name of index.names()) {
            for (const definition of index.resolve(name).definitions) {
                collectByFile(byFile, definition.file, definition, null);
            }
        }
        for (const name of index.calledNames()) {
            for (const reference of index.resolve(name).references) {
                collectByFile(byFile, reference.file, null, reference);
            }
        }
        for (const filePath of [...byFile.keys()].sort()) {
            const bucket = byFile.get(filePath);
            if (!bucket) continue;
            stream.admit(filePath, bucket.definitions, bucket.references);
        }
        return stream;
    }

    /** Append declarations to the compact name map and update the retained counter. */
    private addDefinitions(definitions: readonly SymbolDefinition[]): void {
        for (let i = 0; i < definitions.length; i++) {
            const definition = definitions[i];
            const list = this.definitionsByName.get(definition.name);
            if (list) list.push(definition);
            else this.definitionsByName.set(definition.name, [definition]);
            this.retainedDefinitions += 1;
        }
    }

    /** Append call edges to the active reference map and update the retained counter. */
    private addReferences(filePath: string, references: readonly SymbolReference[]): void {
        if (references.length === 0) return;
        const touched = this.referenceNamesByFile.get(filePath) ?? new Set<string>();
        this.referenceNamesByFile.set(filePath, touched);
        for (let i = 0; i < references.length; i++) {
            const reference = references[i];
            touched.add(reference.name);
            const list = this.referencesByName.get(reference.name);
            if (list) list.push(reference);
            else this.referencesByName.set(reference.name, [reference]);
            this.retainedReferences += 1;
        }
    }

    /** Evict the lowest-saliency active file until the budget has room for one more. */
    private evictUntilRoom(): void {
        while (this.active.size >= this.maxActiveFiles) {
            const victim = this.selectEvictionCandidate();
            if (!victim) return;
            this.evictFile(victim);
        }
    }

    /**
     * Pick the active file with the lowest saliency.
     *
     * Saliency is frequency-first with recency as the tie-break: a file that has accumulated many
     * call edges is the one a later query is most likely to need, so it outranks a fresher file
     * that was admitted once. Among equally-referenced files the oldest admission goes first, which
     * is what keeps a long tail of single-reference files from displacing the graph's hubs.
     *
     * @returns Path of the file to evict, or null when nothing is active.
     */
    private selectEvictionCandidate(): string | null {
        let victimPath: string | null = null;
        let victimReferences = Number.POSITIVE_INFINITY;
        let victimSequence = Number.POSITIVE_INFINITY;
        for (const [filePath, record] of this.active) {
            const isBetter =
                record.referenceCount < victimReferences ||
                (record.referenceCount === victimReferences && record.sequence < victimSequence);
            if (!isBetter) continue;
            victimPath = filePath;
            victimReferences = record.referenceCount;
            victimSequence = record.sequence;
        }
        return victimPath;
    }

    /** Drop a file's reference edges while keeping its declarations in the compact map. */
    private evictFile(filePath: string): void {
        this.active.delete(filePath);
        this.evictedFiles += 1;
        const touched = this.referenceNamesByFile.get(filePath);
        if (!touched) return;
        this.referenceNamesByFile.delete(filePath);
        for (const name of touched) {
            this.dropReferencesOfFile(name, filePath);
        }
    }

    /** Remove one file's edges for a single callee name, keeping the other files' edges. */
    private dropReferencesOfFile(name: string, evictedFile: string): void {
        const list = this.referencesByName.get(name);
        if (!list) return;
        const kept: SymbolReference[] = [];
        for (let i = 0; i < list.length; i++) {
            if (list[i].file !== evictedFile) kept.push(list[i]);
        }
        this.retainedReferences -= list.length - kept.length;
        if (kept.length === 0) this.referencesByName.delete(name);
        else this.referencesByName.set(name, kept);
    }
}

/** Bucket one declaration or reference under its file while grouping for admission. */
function collectByFile(
    byFile: Map<string, FileBucket>,
    filePath: string,
    definition: SymbolDefinition | null,
    reference: SymbolReference | null,
): void {
    const bucket = byFile.get(filePath) ?? { definitions: [], references: [] };
    if (definition) bucket.definitions.push(definition);
    if (reference) bucket.references.push(reference);
    byFile.set(filePath, bucket);
}
