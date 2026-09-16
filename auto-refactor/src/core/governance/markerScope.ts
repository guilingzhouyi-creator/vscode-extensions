/**
 * Module: Core Governance - Marker Scope Helpers
 * File Path: src/core/governance/markerScope.ts
 * Architecture Role: One definition of "this marker occurrence is a vocabulary listing rather
 *     than an applied tag", shared by every checker that hunts transient jargon (GOV-SAN-001 in
 *     the governance rules, HYG-STB-002 in the hygiene analyzer).
 * Dependencies & Triggers: Pure string and regex work; imported by the governance sanitization
 *     rule and by the hygiene analyzer.
 * Responsibilities: Decide whether a matched marker is delimited by a slash, which is what a
 *     list of the vocabulary itself looks like in prose.
 * Exit Semantics & Design Rationale: Pure and total; never throws. The slash test tolerates
 *     surrounding spaces so that a spaced listing is recognized as well, but it refuses to treat
 *     a comment opener as the delimiter; otherwise a marker placed directly after the opener
 *     would be exempted, and the check would silence itself on the text it exists to catch. A
 *     documentation line that quotes such an example verbatim is therefore still reported, which
 *     is the known and bounded cost of keeping the rule honest.
 */

/** Matches a slice that ends in a slash, allowing spaces, where the slash is not a `//` opener. */
const SLASH_BEFORE_RE = /(?:^|[^/])\/\s*$/;

/** Matches a slice that begins with a slash, allowing leading spaces. */
const SLASH_AFTER_RE = /^\s*\//;

/**
 * True when a matched marker sits next to a slash, marking it as a vocabulary listing.
 *
 * A comment that enumerates the vocabulary (`pN/stN/phase N/wip`, or `jargon / WIP marker`) is
 * documentation ABOUT the check rather than a task USING the marker. Without this predicate a
 * rule reports its own description, which is how HYG-STB-002 came to flag the message text of
 * GOV-SAN-001.
 *
 * @param line - Line being examined, in any language.
 * @param index - Index of the matched marker within the line.
 * @param marker - Matched marker text.
 * @returns True when the marker is delimited by a slash and is therefore a list entry.
 */
export function isVocabularyEnumeration(line: string, index: number, marker: string): boolean {
    if (index < 0) return false;
    const before = line.slice(0, index);
    const after = line.slice(index + marker.length);
    return SLASH_BEFORE_RE.test(before) || SLASH_AFTER_RE.test(after);
}
