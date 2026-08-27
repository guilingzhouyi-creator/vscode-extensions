/**
 * Old↔New line/byte mapping (ts-free pure logic).
 *
 * Part of the line-level incremental infrastructure (docs/system-design.md §3.2).
 * Given the OLD and NEW contents plus their byte-level `EditRange[]`, a `LineMap`
 * answers the position-translation questions an incremental projector needs:
 *   - `mapLine(oldLine)`   → the new 1-based line an old line moved to (or -1 if deleted)
 *   - `mapByte(oldByte)`   → the new byte offset an old byte moved to (or -1 if deleted)
 *   - `lineDeltaAt(line)`  → cumulative (new-old) line shift applied up to a line
 *   - `isUnchangedRange()` → whether a NEW-content byte range overlaps no edit
 *
 * INC-Mode-1 (this milestone) does NOT rely on line translation for positions — it reuses
 * a subtree only when its byte range is untouched — but `isUnchangedRange` is exactly the
 * byte-level form of that reuse condition and is exposed here for callers/validation.
 * This module NEVER imports `typescript`.
 */

import { EditRange, computeLineStarts } from './editDiff';

export class LineMap {
  private readonly oldStarts: number[];
  private readonly newStarts: number[];
  private readonly edits: EditRange[];

  constructor(oldContent: string, newContent: string, edits: EditRange[]) {
    this.oldStarts = computeLineStarts(oldContent);
    this.newStarts = computeLineStarts(newContent);
    this.edits = [...edits].sort((a, b) => a.startByte - b.startByte);
  }

  /** Map a 1-based OLD line to its 1-based NEW line, or -1 when the line was deleted. */
  mapLine(oldLine: number): number {
    let delta = 0;
    for (const e of this.edits) {
      if (oldLine < e.startLine) break; // this line sits before every remaining edit
      if (oldLine <= e.oldEndLine) return -1; // inside a deleted span
      delta += (e.newEndLine - e.startLine + 1) - (e.oldEndLine - e.startLine + 1);
    }
    return oldLine + delta;
  }

  /** Map an OLD byte offset to its NEW byte offset, or -1 when it falls in a deleted span. */
  mapByte(oldByte: number): number {
    let delta = 0;
    for (const e of this.edits) {
      if (oldByte < e.startByte) break;
      if (oldByte < e.oldEndByte) return -1;
      delta += (e.newEndByte - e.startByte) - (e.oldEndByte - e.startByte);
    }
    return oldByte + delta;
  }

  /** Cumulative new-line minus old-line shift contributed by edits at or above `line`. */
  lineDeltaAt(line: number): number {
    let delta = 0;
    for (const e of this.edits) {
      if (e.startLine > line) break;
      delta += (e.newEndLine - e.startLine + 1) - (e.oldEndLine - e.startLine + 1);
    }
    return delta;
  }

  /**
   * True when the NEW-content byte range `[startByte, endByte)` overlaps no edit span.
   * This is the INC-Mode-1 reuse condition expressed at byte granularity: an untouched
   * range has identical bytes and identical positions in old and new content.
   */
  isUnchangedRange(startByte: number, endByte: number): boolean {
    for (const e of this.edits) {
      if (e.newEndByte <= startByte) continue; // edit entirely before the range
      if (e.startByte >= endByte) break; // edits are sorted; the rest are after the range
      return false; // overlap
    }
    return true;
  }
}
