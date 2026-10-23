/**
 * Module: Core Governance — Shared Rule/Step Lexicon
 * File Path: src/core/governance/rule-lexicon.ts
 * Architecture Role: Loads the workspace lexicon that both this engine and the workspace gate
 *   scripts compile their identifier shapes from, so one concept never has two definitions.
 * Dependencies & Triggers: Node fs/path; used by ./rule-catalog-ssot on first inspection and by
 *   scripts/common/validate-rule-id-closure.js through the same JSON file.
 * Responsibilities:
 *   1. Search upward from the compiled module for scripts/common/rule-lexicon.json;
 *   2. Compile the candidate, step-id, layer-range, and date shapes into global RegExps;
 *   3. Expose the benign external-standard prefixes as a frozen lookup;
 *   4. Report an unusable lexicon so callers can degrade instead of guessing.
 * Exit Semantics & Design Rationale: Total and non-throwing. The lexicon is read at most once
 *   per process and memoized, the same one-shot policy the rule catalog uses. When the file is
 *   unreachable the loader returns null and callers report NO drift rather than reporting
 *   everything — a standalone consumer outside the workspace tree must not be flooded with
 *   findings it cannot resolve. There is deliberately no embedded fallback vocabulary: a second
 *   copy is exactly what let the gate and the engine disagree about what a step identifier is.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Basename of the workspace lexicon, relative to `scripts/common`. */
const LEXICON_BASENAME = 'rule-lexicon.json';

/** Relative directory holding the lexicon, below the workspace root. */
const LEXICON_DIRECTORY = path.join('scripts', 'common');

/** How many ancestor directories the upward search will inspect. */
const SEARCH_DEPTH = 6;

/**
 * Environment variable pinning the lexicon path.
 *
 * The upward search from the compiled module cannot be starved from inside the workspace tree,
 * which made the degradation path untestable through the public surface. Pinning the path with an
 * explicit override lets a verification harness point the loader at a scratch tree, an absent
 * file, or a malformed document, and observe the degradation the documentation promises. The same
 * explicit-override idiom `LINUX_PARITY_GNU_ROOT` uses for the command surface: a pinned but
 * unusable value reproduces the failure deterministically instead of silently falling back.
 */
const LEXICON_PATH_ENV = 'AUTO_REFACTOR_RULE_LEXICON';

/** Isolated synchronous read barrier for the lexicon, mirroring the catalog barrier. */
const LexiconIoBarrier = {
    /**
     * Read the lexicon source text.
     *
     * @param lexiconPath - Absolute path of the lexicon file.
     * @returns Raw UTF-8 JSON text.
     */
    readText(lexiconPath: string): string {
        return fs['readFileSync'](lexiconPath, 'utf8');
    },

    /**
     * Report whether a candidate path exists.
     *
     * @param lexiconPath - Absolute path to test.
     * @returns True when the path exists.
     */
    exists(lexiconPath: string): boolean {
        return fs.existsSync(lexiconPath);
    },
};

/** Compiled identifier vocabulary shared by every consumer of the lexicon. */
export interface RuleLexicon {
    /** Global RegExp matching rule-identifier candidates (callers must reset `lastIndex`). */
    readonly candidate: RegExp;
    /** RegExp recognizing a semantic step identifier. */
    readonly semanticStepId: RegExp;
    /** RegExp recognizing a layer range such as `L1-L3`. */
    readonly layerRange: RegExp;
    /** RegExp recognizing a calendar-shaped token such as `2026-10-23`. */
    readonly calendarDate: RegExp;
    /** Prefixes that look like rule codes but name external standards. */
    readonly externalStandardPrefixes: readonly string[];
}

let cachedLexicon: RuleLexicon | null = null;
let lexiconResolved = false;

/**
 * Resolves the lexicon path, honoring an explicit pin before the upward search.
 *
 * @returns Absolute path of the lexicon, or null when it cannot be located.
 */
function findLexiconPath(): string | null {
    const pinned = process.env[LEXICON_PATH_ENV];
    if (typeof pinned === 'string' && pinned.length > 0) {
        return LexiconIoBarrier.exists(pinned) ? pinned : null;
    }
    let currentDir = __dirname;
    for (let depth = 0; depth < SEARCH_DEPTH; depth++) {
        const candidate = path.join(currentDir, LEXICON_DIRECTORY, LEXICON_BASENAME);
        if (LexiconIoBarrier.exists(candidate)) return candidate;
        const parent = path.dirname(currentDir);
        if (parent === currentDir) break;
        currentDir = parent;
    }
    return null;
}

/**
 * Compiles one source-text shape into a RegExp.
 *
 * The anchored shapes are compiled WITHOUT the global flag on purpose: callers test them with
 * `.test()`, and a global regex carries `lastIndex` between calls, so the second token inspected
 * would start scanning mid-string and the verdict would depend on call order.
 *
 * @param pattern - Regular-expression source text from the lexicon.
 * @param label - Field name, used to build an actionable failure message.
 * @param flags - RegExp flags to apply; empty for the anchored shapes.
 * @returns The compiled RegExp.
 * @throws Error when the shape is missing or not a usable pattern.
 */
function compileShape(pattern: unknown, label: string, flags: string): RegExp {
    if (typeof pattern !== 'string' || pattern.length === 0) {
        throw new Error(`rule-lexicon: '${label}' must be a non-empty pattern string`);
    }
    try {
        return new RegExp(pattern, flags);
    } catch (error) {
        throw new Error(`rule-lexicon: '${label}' is not a valid pattern (${String(error)})`);
    }
}

/**
 * Compiles the prefixes into a validated frozen list.
 *
 * @param prefixes - Raw `externalStandardPrefixes` value.
 * @returns The frozen prefix list.
 * @throws Error when the field is not an array of non-empty strings.
 */
function compilePrefixes(prefixes: unknown): readonly string[] {
    if (!Array.isArray(prefixes) || prefixes.length === 0) {
        throw new Error('rule-lexicon: \'externalStandardPrefixes\' must be a non-empty array');
    }
    for (const prefix of prefixes) {
        if (typeof prefix !== 'string' || prefix.length === 0) {
            throw new Error('rule-lexicon: every external prefix must be a non-empty string');
        }
    }
    return Object.freeze([...prefixes] as string[]);
}

/**
 * Compiles a parsed lexicon document into the runtime vocabulary.
 *
 * @param document - Parsed JSON document.
 * @returns The compiled lexicon.
 * @throws Error when a required shape is absent or malformed.
 */
function compileLexicon(document: Record<string, unknown>): RuleLexicon {
    return {
        candidate: compileShape(document.ruleIdCandidate, 'ruleIdCandidate', 'g'),
        semanticStepId: compileShape(document.semanticStepId, 'semanticStepId', ''),
        layerRange: compileShape(document.layerRange, 'layerRange', ''),
        calendarDate: compileShape(document.calendarDate, 'calendarDate', ''),
        externalStandardPrefixes: compilePrefixes(document.externalStandardPrefixes),
    };
}

/**
 * Loads and memoizes the shared identifier vocabulary.
 *
 * A malformed lexicon is treated the same as an absent one: the log is silent here because this
 * module sits on a per-file inspection path, and a shape error surfaces through the dedicated
 * verification harness rather than as a per-file log storm.
 *
 * @returns The compiled lexicon, or null when it is unreachable or unusable.
 */
export function loadRuleLexicon(): RuleLexicon | null {
    if (lexiconResolved) return cachedLexicon;
    lexiconResolved = true;
    const lexiconPath = findLexiconPath();
    if (lexiconPath === null) return null;
    try {
        const parsed = JSON.parse(LexiconIoBarrier.readText(lexiconPath)) as Record<string, unknown>;
        cachedLexicon = compileLexicon(parsed);
    } catch {
        cachedLexicon = null;
    }
    return cachedLexicon;
}

/**
 * Resets the memoized lexicon so a verification harness can drive the loader against fixtures.
 */
export function resetRuleLexiconCache(): void {
    cachedLexicon = null;
    lexiconResolved = false;
}
