/**
 * Module: Utils — Generated Constant Name Placeholder Detection
 * File Path: src/utils/placeholder-names.ts
 * Architecture Role: Leaf predicate shared by the constant analyzer (whether a generated name may be
 *   applied automatically) and the reporting layer (whether a patch may be shown to an agent).
 * Dependencies & Triggers: The name-integrity adjudicator; once per literal finding and once per
 *   emitted patch.
 * Responsibilities: `isContentlessName` recognizes names carrying no trace of their literal,
 *   `isWeldName` recognizes identifiers the literal cannot explain, and `isPlaceholderPatchText`
 *   combines both for patch-level adjudication. Contentless and positional patterns are anchored on
 *   identifier boundaries because `_` is a word character; `CONST_<digits>_TEXT` is positional
 *   because it says where a literal sat rather than what it means.
 * Exit Semantics & Design Rationale: Pure and total; never throws. Welding compares the identifier
 *   against its own literal rather than its length, because `UNCONDITIONAL` is one word of its
 *   literal and keeps its patch while `INVALIDNAME` hides two and loses it.
 */
import {
    deriveLiteralWords,
    isNameExplainableByLiteral,
    STRING_NAME_SUFFIX,
} from '../core/naming/name-integrity';
const CONTENTLESS_NAME_RE = /(?:^|[^A-Za-z0-9_])EXTRACTED_(?:STRING|NUMBER)(?:$|[^A-Za-z0-9_])/;
const POSITIONAL_NAME_RE = /(?:^|[^A-Za-z0-9_])CONST_\d+_TEXT(?:$|[^A-Za-z0-9_])/;
/** Longest identifier-like run inside a patch body that may be a generated name. */
const PATCH_IDENTIFIER_RE = /[A-Z][A-Z0-9_]{2,}/g;
/** True when a generated name carries no trace of the literal it describes. */
export function isContentlessName(name: string | undefined): boolean {
    if (!name) return false;
    return CONTENTLESS_NAME_RE.test(name);
}
/** True when the literal does not account for the identifier's words; positional names are exempt. */
export function isWeldName(name: string | undefined, literal: string | undefined): boolean {
    if (!name || !literal) return false;
    if (!name.endsWith(STRING_NAME_SUFFIX)) return false;
    if (POSITIONAL_NAME_RE.test(name)) return false;
    // A literal with no words leaves the question undecidable (`'2'`, `'/'`); guessing "weld"
    // stripped the patches of every numeric and punctuation finding.
    if (deriveLiteralWords(literal).length === 0) return false;
    return !isNameExplainableByLiteral(name, literal);
}
/** True when a patch body is too weak to hand to an agent. */
export function isPlaceholderPatchText(text: string | undefined, literal?: string): boolean {
    if (!text) return true;
    if (CONTENTLESS_NAME_RE.test(text) || POSITIONAL_NAME_RE.test(text)) return true;
    if (!literal) return false;
    const identifiers = text.match(PATCH_IDENTIFIER_RE);
    if (!identifiers) return false;
    return identifiers.some((identifier) => isWeldName(identifier, literal));
}
