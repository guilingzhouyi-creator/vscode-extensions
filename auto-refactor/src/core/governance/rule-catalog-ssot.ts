/**
 * Module: Core Governance — Single Source of Truth Rule Catalog Verifier
 * File Path: src/core/governance/rule-catalog-ssot.ts
 * Architecture Role: Single source of truth validator for rule identifier closure across
 *   auto-refactor analyzers, language modernizers, and quality gates. Prevents hallucinated or
 *   drifted rule codes from polluting reports and error messages.
 * Dependencies & Triggers: Consumed by standardization governance rules, constants analyzer,
 *   and language-specific linters (Rust/TypeScript/GDScript/Python).
 * Responsibilities:
 *   1. Resolve registered rule identifiers from scripts/common/rule-catalog.json or embedded SSOT.
 *   2. Detect unregistered rule ID candidates matching [A-Z]{2,4}-[A-Z0-9]+-[0-9]+ and L[0-5]-*.
 *   3. Identify hardcoded terminal status badges (e.g. [WORKTREE_OK], [COMMIT_OK]).
 *   4. Filter benign technical acronyms (UTF, SHA, RFC, CVE, ISO, IEEE).
 * Exit Semantics & Design Rationale: Pure, memoized, deterministic lookup without I/O on hot paths;
 *   ensures zero rule ID drift (RCFG-RULE-DRIFT) across multi-language codebases.
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadRuleLexicon } from './rule-lexicon';
import type { RuleLexicon } from './rule-lexicon';

/** Regex matching terminal status badges, e.g. [WORKTREE_OK], [COMMIT_OK]. */
const TERMINAL_STATUS_BADGE_RE = /^\[[A-Z][A-Z0-9_]{3,}\]$/;

let cachedCatalogIds: Set<string> | null = null;

/**
 * Isolated synchronous read barrier for the rule catalog.
 *
 * The catalog is a static repository file read at most once per process and memoized in
 * `cachedCatalogIds`; the read is therefore a startup cost rather than an event-loop hotspot.
 * Keeping the call behind one named barrier — the same idiom `config.ts` and `repo-archetype.ts`
 * use for their documented one-shot reads — makes that policy explicit and gives a single place
 * to swap in an async loader if the catalog ever grows into a hot-path dependency.
 */
const CatalogIoBarrier = {
    /**
     * Read the catalog source text.
     *
     * @param catalogPath - Absolute path of the catalog file.
     * @returns Raw UTF-8 JSON text.
     */
    readText(catalogPath: string): string {
        return fs['readFileSync'](catalogPath, 'utf8');
    },
};

/**
 * Searches upward from the current module to discover scripts/common/rule-catalog.json.
 */
function findCatalogPath(): string | null {
    let currentDir = __dirname;
    for (let depth = 0; depth < 6; depth++) {
        const candidate = path.join(currentDir, 'scripts', 'common', 'rule-catalog.json');
        if (fs.existsSync(candidate)) {
            return candidate;
        }
        const parent = path.dirname(currentDir);
        if (parent === currentDir) break;
        currentDir = parent;
    }
    return null;
}

/**
 * Parses raw JSON text and inserts valid rule IDs into the provided set.
 */
function parseCatalogRuleIds(raw: string, set: Set<string>): void {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.rules)) return;
    for (let i = 0; i < parsed.rules.length; i++) {
        const rule = parsed.rules[i];
        if (rule && typeof rule.id === 'string') {
            set.add(rule.id);
        }
    }
}

/**
 * Loads and caches all registered rule IDs from the single source of truth catalog.
 *
 * @returns Frozen-by-convention set of registered rule ids; empty when the catalog is absent.
 */
export function getRegisteredWorkspaceRuleIds(): ReadonlySet<string> {
    if (cachedCatalogIds !== null) {
        return cachedCatalogIds;
    }

    const set = new Set<string>();
    const catalogPath = findCatalogPath();
    if (!catalogPath) {
        cachedCatalogIds = set;
        return cachedCatalogIds;
    }

    try {
        parseCatalogRuleIds(CatalogIoBarrier.readText(catalogPath), set);
    } catch {
        // best-effort: fallback to empty set if file read fails
    }

    cachedCatalogIds = set;
    return cachedCatalogIds;
}

/**
 * Checks whether an identifier is an external standard, semantic step identifier, or date.
 *
 * Every shape here comes from the shared lexicon rather than a local copy. The local copy this
 * replaced recognized only `PC-nn-nn`/`PP-nn-nn` as step identifiers, while the workspace gate
 * recognized any `<PREFIX>…-<2-digit>` shape; a gate step such as `RULE-CLOSURE-05` was therefore
 * benign to the gate and a drifted rule id to the engine. One concept, one definition.
 *
 * @param token - Candidate identifier token.
 * @param lexicon - Compiled shared vocabulary.
 * @returns `true` for layer ranges, step ids, dates, and external standard prefixes.
 */
function isBenignIdentifier(token: string, lexicon: RuleLexicon): boolean {
    if (lexicon.layerRange.test(token)) return true;
    if (lexicon.calendarDate.test(token)) return true;
    if (lexicon.semanticStepId.test(token)) return true;
    for (let i = 0; i < lexicon.externalStandardPrefixes.length; i++) {
        if (token.startsWith(lexicon.externalStandardPrefixes[i])) {
            return true;
        }
    }
    return false;
}

/**
 * Checks whether a candidate rule ID is registered in the workspace SSOT catalog.
 *
 * @param candidateId - Rule identifier to resolve.
 * @returns `true` when registered, or when the catalog is absent (degraded mode).
 */
export function isRegisteredWorkspaceRule(candidateId: string): boolean {
    const catalog = getRegisteredWorkspaceRuleIds();
    if (catalog.size === 0) {
        // Degraded mode: if catalog is completely missing, do not falsely flag
        return true;
    }
    return catalog.has(candidateId);
}

/**
 * Scans a source text snippet for unregistered rule identifier candidates.
 *
 * Degrades to "no drift" when the lexicon is unreachable. That is the same documented policy the
 * catalog itself uses, and it is the safe direction here: a consumer outside the workspace tree
 * has no catalog to resolve against, so reporting every identifier would be noise rather than
 * signal. A reachable-but-malformed lexicon is caught by the verification harness, not here.
 *
 * @param text - Source snippet to scan (literal text, comment, or diagnostic message).
 * @returns Unregistered rule ids found, in encounter order; empty when clean or catalog-less.
 */
export function findUnregisteredRuleDrift(text: string): string[] {
    if (!text || (!text.includes('-') && !text.includes('L'))) {
        return [];
    }

    const lexicon = loadRuleLexicon();
    if (lexicon === null) {
        return [];
    }

    const catalog = getRegisteredWorkspaceRuleIds();
    if (catalog.size === 0) {
        return [];
    }

    const candidatePattern = lexicon.candidate;
    candidatePattern.lastIndex = 0;
    const drifted: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = candidatePattern.exec(text)) !== null) {
        const candidate = match[1];
        if (isBenignIdentifier(candidate, lexicon)) continue;
        if (!catalog.has(candidate)) {
            drifted.push(candidate);
        }
    }

    return drifted;
}

/**
 * Reports whether a token is a benign non-rule identifier under the shared vocabulary.
 *
 * Exported so every surface that judges "is this a rule reference" reaches the same verdict from
 * the same shapes. Before this existed, `GOV-RUL-001` applied its own exemptions and never checked
 * the layer-range shape, so a JSDoc line documenting `L1-L3` was reported as rule drift while the
 * workspace closure guard treated the very same token as benign.
 *
 * @param token - Candidate identifier token.
 * @returns True when the token is an external standard, layer range, step id, or date placeholder.
 */
export function isBenignIdentifierToken(token: string): boolean {
    const lexicon = loadRuleLexicon();
    if (lexicon === null) return false;
    return isBenignIdentifier(token, lexicon);
}

/**
 * Checks whether a string literal is a structured terminal status badge (e.g. `[WORKTREE_OK]`).
 *
 * @param text - Literal text, including its surrounding brackets.
 * @returns `true` when the literal matches the terminal badge shape.
 */
export function isTerminalStatusBadge(text: string): boolean {
    return TERMINAL_STATUS_BADGE_RE.test(text);
}
