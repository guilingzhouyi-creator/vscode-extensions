/**
 * Module: Core Data Structures — Bidirectional Symbol/Entity ID Interner
 * File Path: src/core/data-structures/id-interner.ts
 * Architecture Role: High-performance bidirectional interning structure that maps arbitrary items
 *   (strings, symbols, paths) to compact contiguous integers (0..N-1) for cache efficiency and SoA
 *   arrays.
 * Dependencies & Triggers: Zero external runtime dependencies.
 * Responsibilities:
 *   1. Intern items into unique, monotonically increasing zero-based 32-bit integer indices;
 *   2. Support O(1) reverse lookup by index via direct array indexing;
 *   3. Eliminate duplicated per-module fileToId/idToFile maps across the codebase.
 * Exit Semantics & Design Rationale: CC <= 4; pure data structure;
 *   non-throwing fail-safe semantics.
 */

/**
 * Bidirectional index mapping container.
 */
export class IdInterner<T> {
    private readonly itemToId = new Map<T, number>();
    private readonly idToItem: T[] = [];

    /**
     * Total number of uniquely interned elements.
     */
    public get size(): number {
        return this.idToItem.length;
    }

    /**
     * Interns an item, returning its existing or newly assigned unique integer ID.
     *
     * @param item - Value to intern.
     * @returns Contiguous 0-based integer identifier.
     */
    public intern(item: T): number {
        let id = this.itemToId.get(item);
        if (id === undefined) {
            id = this.idToItem.length;
            this.itemToId.set(item, id);
            this.idToItem.push(item);
        }
        return id;
    }

    /**
     * Retrieves the assigned integer ID for an item if already interned.
     *
     * @param item - Target item.
     * @returns Assigned integer ID, or undefined if not interned.
     */
    public getId(item: T): number | undefined {
        return this.itemToId.get(item);
    }

    /**
     * Retrieves the original item associated with an integer ID in O(1).
     *
     * @param id - Assigned integer identifier.
     * @returns Original item, or undefined if ID is out of bounds.
     */
    public getItem(id: number): T | undefined {
        if (id < 0 || id >= this.idToItem.length) {
            return undefined;
        }
        return this.idToItem[id];
    }

    /**
     * Checks whether an item has been interned.
     *
     * @param item - Target item.
     * @returns True if already interned.
     */
    public has(item: T): boolean {
        return this.itemToId.has(item);
    }

    /**
     * Materializes all interned items as a read-only array indexed by ID.
     */
    public toArray(): readonly T[] {
        return this.idToItem;
    }

    /**
     * Clears all interned items and resets index sequence to 0.
     */
    public clear(): void {
        this.itemToId.clear();
        this.idToItem.length = 0;
    }
}
