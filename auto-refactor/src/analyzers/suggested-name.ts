/**
 * Module: Static Analysis Engine — Suggested Constant Name Derivation
 * File Path: src/analyzers/suggested-name.ts
 * Architecture Role: Pure naming leaf shared by the literal analyzer's three emitters (duplicate,
 *   magic-number, hardcoded-string) so one literal always yields one name whichever rule saw it.
 * Dependencies & Triggers: Word derivation from the naming SSOT; once per emitted literal finding.
 * Responsibilities: Join the literal's ordered words with underscores, append the `_TEXT` suffix
 *   unless the slug already ends in it, and keep small integers position-named.
 * Exit Semantics & Design Rationale: Total, no I/O, never throws; an unsplittable literal degrades
 *   to the `EXTRACTED_*` fallback. Underscore joining matters because a whitespace-only split welded
 *   camelCase literals into names like `ARCHITECTUREANALYZERSEGMENTCACHES_TEXT`, which the reporter
 *   then discarded as mechanical. `SUGGESTED_NAME_INTEGER_LIMIT` is the bound above which an
 *   integer's magnitude says nothing about its role.
 */
import { REGEX } from '../core/constants';
import { deriveLiteralWords, STRING_NAME_SUFFIX } from '../core/naming/name-integrity';
export const SUGGESTED_NAME_INTEGER_LIMIT = 1000;
/** Fallbacks emitted when the literal yields no domain term, and the literal kinds distinguished. */
export const PLACEHOLDER_NUMBER_NAME = 'EXTRACTED_NUMBER';
export const PLACEHOLDER_STRING_NAME = 'EXTRACTED_STRING';
export const NUM_KIND = 'number';
export const STR_KIND = 'string';
/** Suffix token marking a slug that already ends in `_TEXT`. */
const STRING_SUFFIX_TOKEN = 'TEXT';
/** Derives a valid SCREAMING_SNAKE_CASE identifier for a literal finding. */
export function suggestConstantName(value: string, kind: string): string {
    if (kind === NUM_KIND) {
        const numericValue = Number(value);
        if (
            Number.isInteger(numericValue) &&
            Math.abs(numericValue) < SUGGESTED_NAME_INTEGER_LIMIT
        ) {
            return `CONST_${numericValue}`;
        }
        return PLACEHOLDER_NUMBER_NAME;
    }
    const words = deriveLiteralWords(value);
    if (words.length === 0) return PLACEHOLDER_STRING_NAME;
    const slug = words.join('_');
    const name = slug.endsWith(STRING_SUFFIX_TOKEN) ? slug : `${slug}${STRING_NAME_SUFFIX}`;
    return REGEX.NAMING.LEADING_DIGIT.test(name) ? `CONST_${name}` : name;
}
