/**
 * Module: Core Scanner — Retained Source Text for the Post-Scan Pass
 * File Path: src/core/scanner/retained-source.ts
 * Architecture Role: Bounded side store owned by the scanner and read by the post-scan scoring
 *   pipeline; the scanner has just read every file it analyzed and scoring needs the same text, so
 *   keeping it here turns a second full read of the working set into a map lookup.
 * Dependencies & Triggers: No imports; one instance per Scanner, read once per scan by
 *   `reportFinalizer` when it synthesizes native governance.
 * Responsibilities: Retain file text under a byte ceiling, seal once the ceiling is crossed, and
 *   report whether a file was kept so callers never assume retention that did not occur.
 * Exit Semantics & Design Rationale: Total and non-throwing. Sealing clears the map instead of
 *   evicting entries: a half-retained set would make the caller's hit rate depend on file order,
 *   which is harder to reason about than an all-or-nothing fallback. The default ceiling is 32 MB,
 *   which covers this project with headroom, and the getters below report the retained text (empty
 *   once sealed, the caller's signal to read from disk), the ceiling in force, and seal state.
 */
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;
/** Bounded store of source text keyed by repository-relative path. */
export class RetainedSourceStore {
    private readonly entries = new Map<string, string>();
    private retainedBytes = 0;
    private sealed = false;
    /** @param maxBytes - Byte ceiling; retention stops and the store clears once crossed. */
    constructor(private readonly maxBytes: number = DEFAULT_MAX_BYTES) {}
    /** Retains one file's text unless the ceiling was crossed; false means nothing was kept. */
    public retain(relPath: string, content: string): boolean {
        if (this.sealed) return false;
        const bytes = Buffer.byteLength(content);
        if (this.retainedBytes + bytes > this.maxBytes) {
            this.sealed = true;
            this.entries.clear();
            this.retainedBytes = 0;
            return false;
        }
        this.entries.set(relPath, content);
        this.retainedBytes += bytes;
        return true;
    }
    /** Retained source map (empty once sealed so callers fall back to disk reads). */
    public snapshot(): ReadonlyMap<string, string> {
        return this.entries;
    }
    public capacityBytes(): number {
        return this.maxBytes;
    }
    public isSealed(): boolean {
        return this.sealed;
    }
}
