/**
 * Module: Core Naming — Name Integrity Against the Literal It Describes
 * File Path: src/core/naming/name-integrity.ts
 * Architecture Role: Leaf adjudicator deciding whether a generated identifier is explainable
 *   by its literal; analyzers separate renames from welds while reporters filter agent patches.
 * Dependencies & Triggers: The shared morpheme tokenizer only; called once per suggested name and
 *   once per emitted patch.
 * Responsibilities: Derive a literal's ordered word sequence, split an identifier back into words,
 *   and decide whether every identifier word appears, in order, among the literal's words.
 * Exit Semantics & Design Rationale: Pure and total; never throws. Ordered containment detects
 *   welds: `INVALIDNAME` merges two words unexplainably while `UNCONDITIONAL` stays explainable.
 */

import { splitIdentifierTokens } from './case-converter';

/** Separator between the words of a generated identifier. */
const WORD_JOINER = '_';
/** Suffix the analyzer appends to every string-derived name. */
export const STRING_NAME_SUFFIX = '_TEXT';
/** Minimum word length; one-letter fragments came from punctuation splits (`'\\n'` → `N`). */
export const NAME_WORD_MIN_LENGTH = 2;
/** Maximum number of words in a generated identifier. */
export const NAME_WORD_MAX_COUNT = 4;

/** Derives the bounded, ordered word sequence that becomes an identifier. */
export function deriveLiteralWords(literal: string): string[] {
    const segments = literal
        .replace(/^['"`]|['"`]$/g, '')
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean);

    const words: string[] = [];
    for (const segment of segments) {
        for (const token of splitIdentifierTokens(segment)) {
            const upper = token.toUpperCase();
            if (upper.length < NAME_WORD_MIN_LENGTH) continue;
            if (words[words.length - 1] === upper) continue;
            words.push(upper);
            if (words.length >= NAME_WORD_MAX_COUNT) return words;
        }
    }
    return words;
}

/** Splits an identifier into its constituent words. */
export function splitNameWords(name: string): string[] {
    const core = name.endsWith(STRING_NAME_SUFFIX)
        ? name.slice(0, -STRING_NAME_SUFFIX.length)
        : name;
    return core.split(WORD_JOINER).flatMap((part) => splitNamePart(part));
}

/** Splits one underscore-delimited part on its register transitions. */
function splitNamePart(part: string): string[] {
    // A part without lowercase (`I18N`, `L3A`) has no transition to split; splitting it would cut a
    // token the literal never contained.
    if (!/[a-z]/.test(part)) return part.length > 0 ? [part.toUpperCase()] : [];
    return part
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.toUpperCase());
}

/** True when every identifier word is accounted for by the literal, in order. */
export function isNameExplainableByLiteral(name: string, literal: string): boolean {
    if (!name || !literal) return false;
    const sourceWords = deriveLiteralWords(literal);
    if (sourceWords.length === 0) return false;

    let cursor = 0;
    for (const word of splitNameWords(name)) {
        let found = -1;
        for (let index = cursor; index < sourceWords.length; index++) {
            if (sourceWords[index] === word) {
                found = index;
                break;
            }
        }
        // A welded identifier hides two or more literal words inside one of its own, so that word
        // matches nothing and the ordered scan fails here.
        if (found === -1) return false;
        cursor = found + 1;
    }
    return true;
}
