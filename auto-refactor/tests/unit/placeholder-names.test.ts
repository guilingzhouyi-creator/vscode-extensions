/**
 * Module: Unit Tests — Generated Name Placeholder Predicates
 * File Path: tests/unit/placeholder-names.test.ts
 * Architecture Role: Contract test for the predicates that guard automated constant naming.
 *   `isContentlessName` decides whether the analyzer may advertise `safeToAutomate`; the stricter
 *   `isPlaceholderPatchText` decides whether the reporter may present a patch at all.
 * Dependencies & Triggers: Imports the predicates from `src/utils/placeholder-names`; runs in the
 *   vitest unit lane invoked by `npm test`.
 * Responsibilities:
 *   1. Pin the placeholder shapes that must always be rejected (`EXTRACTED_*`, `CONST_<n>_TEXT`).
 *   2. Pin weld detection against the literal, including cases that no length threshold can solve.
 *   3. Pin the domain names that must keep their patches (`DIALOG_TEXT`, `UNCONDITIONAL_TEXT`, …).
 * Exit Semantics & Design Rationale: Pure assertions with no I/O, so failures mean the naming
 *   contract drifted, never that the environment misbehaved. `UNCONDITIONAL` (13 characters) and
 *   `INVALIDNAME` (11 characters) are pinned here precisely because an earlier length-based guard
 *   could not separate them and silently dropped 120 legitimate patches.
 */
import { describe, it, expect } from 'vitest';
import {
    isContentlessName,
    isWeldName,
    isPlaceholderPatchText,
} from '../../src/utils/placeholder-names';
import {
    deriveLiteralWords,
    isNameExplainableByLiteral,
    splitNameWords,
} from '../../src/core/naming/name-integrity';

describe('isContentlessName — names that carry no trace of the literal', () => {
    it('recognizes the analyzer fallbacks', () => {
        expect(isContentlessName('EXTRACTED_STRING')).toBe(true);
        expect(isContentlessName('EXTRACTED_NUMBER')).toBe(true);
    });

    it('recognizes a fallback embedded in a declaration', () => {
        expect(isContentlessName("const EXTRACTED_STRING = 'x';")).toBe(true);
    });

    it('leaves welded but content-bearing names alone', () => {
        expect(isContentlessName('INVALIDNAME_TEXT')).toBe(false);
        expect(isContentlessName('CONST_008_TEXT')).toBe(false);
    });

    it('rejects empty input without throwing', () => {
        expect(isContentlessName(undefined)).toBe(false);
        expect(isContentlessName('')).toBe(false);
    });
});

describe('deriveLiteralWords — the analyzer naming policy', () => {
    it('re-segments camelCase and acronym runs', () => {
        expect(deriveLiteralWords("'architectureConsistency'")).toEqual([
            'ARCHITECTURE',
            'CONSISTENCY',
        ]);
        expect(deriveLiteralWords("'URLSearchParams'")).toEqual(['URL', 'SEARCH', 'PARAMS']);
    });

    it('collapses adjacent duplicate words', () => {
        expect(deriveLiteralWords("'context.Context'")).toEqual(['CONTEXT']);
    });

    it('drops one-letter fragments and keeps two-letter domain codes', () => {
        expect(deriveLiteralWords("'\\n'")).toEqual([]);
        expect(deriveLiteralWords("'CN'")).toEqual(['CN']);
    });

    it('bounds the word count', () => {
        expect(deriveLiteralWords("'aa bb cc dd ee ff gg hh'").length).toBe(4);
    });
});

describe('splitNameWords — identifier to words', () => {
    it('splits on underscores and register changes', () => {
        expect(splitNameWords('INVALID_NAME_TEXT')).toEqual(['INVALID', 'NAME']);
        expect(splitNameWords('invalidName')).toEqual(['INVALID', 'NAME']);
        expect(splitNameWords('DIALOG_TEXT')).toEqual(['DIALOG']);
    });

    it('never fragments a part that has no register transition', () => {
        expect(splitNameWords('I18N_TEXT')).toEqual(['I18N']);
        expect(splitNameWords('ESCALATE_L3A_TEXT')).toEqual(['ESCALATE', 'L3A']);
    });
});

describe('isWeldName — welding is decided against the literal, never by length', () => {
    it('rejects identifiers that weld two literal words into one', () => {
        expect(isWeldName('INVALIDNAME_TEXT', 'invalid name')).toBe(true);
        expect(isWeldName('HIGHCOMPLEXITY_TEXT', 'high complexity')).toBe(true);
        expect(
            isWeldName(
                'ARCHITECTUREANALYZERSEGMENTCACHES_TEXT',
                'architecture analyzer segment caches',
            ),
        ).toBe(true);
    });

    it('keeps long single words that the literal genuinely contains', () => {
        // 13 characters, longer than the welded `INVALIDNAME` (11): length cannot decide this.
        expect(isWeldName('UNCONDITIONAL_TEXT', 'unconditional')).toBe(false);
        expect(isWeldName('MAINTAINABILITY_TEXT', 'maintainability')).toBe(false);
        expect(isWeldName('STANDARDIZATION_TEXT', 'standardization')).toBe(false);
    });

    it('keeps multi-word names whose words all come from the literal, in order', () => {
        expect(isWeldName('DEFAULT_RETRY_BUDGET_TEXT', 'default retry budget')).toBe(false);
        expect(isWeldName('USER_NOT_FOUND_TEXT', 'user not found')).toBe(false);
    });

    it('treats positional names as non-welds because they are caught by their own rule', () => {
        expect(isWeldName('CONST_008_TEXT', "'008'")).toBe(false);
    });

    it('never judges numeric names, which are position-named rather than welded', () => {
        expect(isWeldName('CONST_47', '47')).toBe(false);
        expect(isWeldName('CONST_2', '2')).toBe(false);
    });

    it('stays undecidable rather than guessing when the literal yields no words', () => {
        expect(isWeldName('NOISE_TEXT', "'#'")).toBe(false);
        expect(isWeldName('NOISE_TEXT', "'/'")).toBe(false);
    });

    it('cannot decide without a literal, and says so', () => {
        expect(isWeldName('INVALIDNAME_TEXT', undefined)).toBe(false);
        expect(isWeldName(undefined, 'invalid name')).toBe(false);
    });
});

describe('isNameExplainableByLiteral — ordered containment', () => {
    it('requires the literal order, not merely membership', () => {
        expect(isNameExplainableByLiteral('BETA_ALPHA_TEXT', 'alpha beta')).toBe(false);
        expect(isNameExplainableByLiteral('ALPHA_BETA_TEXT', 'alpha beta')).toBe(true);
    });

    it('rejects names whose words the literal never contained', () => {
        expect(isNameExplainableByLiteral('WIDGET_LABEL_TEXT', 'dialog')).toBe(false);
    });
});

describe('isPlaceholderPatchText — names too weak to hand to an agent', () => {
    it('blocks both fallback families', () => {
        expect(isPlaceholderPatchText('EXTRACTED_STRING')).toBe(true);
        expect(isPlaceholderPatchText('EXTRACTED_NUMBER')).toBe(true);
    });

    it('blocks positional constant names', () => {
        expect(isPlaceholderPatchText('CONST_008_TEXT')).toBe(true);
        expect(isPlaceholderPatchText('CONST_021_TEXT')).toBe(true);
    });

    it('blocks welded slugs when the literal is known', () => {
        expect(isPlaceholderPatchText('INVALIDNAME_TEXT', 'invalid name')).toBe(true);
        expect(isPlaceholderPatchText("const HIGHCOMPLEXITY_TEXT = 'x';", 'high complexity')).toBe(
            true,
        );
    });

    it('keeps single-word domain names ending in _TEXT', () => {
        expect(isPlaceholderPatchText('DIALOG_TEXT', 'dialog')).toBe(false);
        expect(isPlaceholderPatchText('BUTTON_TEXT', 'button')).toBe(false);
        expect(isPlaceholderPatchText('USER_TEXT', 'user')).toBe(false);
    });

    it('keeps long vocabulary words that a length threshold would have dropped', () => {
        expect(isPlaceholderPatchText('TYPESCRIPT_TEXT', 'typescript')).toBe(false);
        expect(isPlaceholderPatchText('WORKSPACE_TEXT', 'workspace')).toBe(false);
        expect(isPlaceholderPatchText('UNCONDITIONAL_TEXT', 'unconditional')).toBe(false);
    });

    it('keeps genuinely domain-derived identifiers', () => {
        expect(isPlaceholderPatchText('DEFAULT_RETRY_BUDGET')).toBe(false);
        expect(isPlaceholderPatchText('const DEFAULT_TIMEOUT_MS = 30;')).toBe(false);
        expect(isPlaceholderPatchText('MAGIC_NUMBER_5')).toBe(false);
        expect(isPlaceholderPatchText('process.env.API_KEY')).toBe(false);
    });

    it('treats missing text as unusable', () => {
        expect(isPlaceholderPatchText(undefined)).toBe(true);
        expect(isPlaceholderPatchText('')).toBe(true);
    });
});

describe('predicate asymmetry — the reporter is stricter than the analyzer', () => {
    it('a welded slug is automatable at the analyzer layer but blocked at the reporter layer', () => {
        const weldedSlug = 'INVALIDNAME_TEXT';
        expect(isContentlessName(weldedSlug)).toBe(false);
        expect(isWeldName(weldedSlug, 'invalid name')).toBe(true);
        expect(isPlaceholderPatchText(weldedSlug, 'invalid name')).toBe(true);
    });

    it('a domain name passes both layers', () => {
        const domainName = 'DEFAULT_RETRY_BUDGET';
        expect(isContentlessName(domainName)).toBe(false);
        expect(isWeldName(domainName, 'default retry budget')).toBe(false);
        expect(isPlaceholderPatchText(domainName, 'default retry budget')).toBe(false);
    });
});
