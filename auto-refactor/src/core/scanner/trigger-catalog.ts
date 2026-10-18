/**
 * Module: Core Engine — Fast Trigger Prefilter Catalog
 * File Path: src/core/scanner/trigger-catalog.ts
 * Architecture Role: Grep-inspired inverted trigger index and 256-LUT byte probe prefilter.
 * Dependencies & Triggers: Consumed by analyzerRunner and scanStage before AST construction
 *   and analyzer execution to short-circuit inactive analyzers.
 * Responsibilities: Maintain catalog of signature trigger tokens per analyzer, compile 256-LUT
 *   initial-byte tables, probe content for triggers, and short-circuit inactive analyzers.
 * Exit Semantics & Design Rationale: Safe degradation: unregistered or empty-trigger analyzers
 *   always return true; empty content returns false; zero transient heap allocation in loops.
 */

import { nativeCore } from '../native/native-bridge';

/** Size of the single-byte ASCII lookup table (256 entries). */
const LUT_SIZE = 256;

/** Trigger keywords indicating loop constructs across supported languages. */
export const LOOP_TRIGGERS: readonly string[] = Object.freeze(['for', 'while', 'do', 'loop']);

/** Trigger keywords indicating branching and looping constructs for complexity. */
export const COMPLEXITY_TRIGGERS: readonly string[] = Object.freeze([
    'for',
    'while',
    'do',
    'switch',
    'case',
    'catch',
    'if',
    'else',
    '?',
    '&&',
    '||',
    '??',
    'loop',
]);

/** Trigger tokens indicating comments and docstrings across supported languages. */
export const COMMENT_TRIGGERS: readonly string[] = Object.freeze([
    '/*',
    '//',
    '#',
    '"""',
    "'''",
    '<!--',
    '{-',
    '--',
    'export ',
    'public ',
    'def ',
    'fn ',
    'class ',
]);

/** Trigger tokens indicating credentials, keys, and confidential secrets. */
export const SECRET_TRIGGERS: readonly string[] = Object.freeze([
    'token',
    'key',
    'secret',
    'password',
    'passwd',
    'api_key',
    'apikey',
    'private_key',
    'auth',
    'bearer',
    'credentials',
    'cert',
    'AKIA',
    'ghp_',
    'github_pat_',
    'sk-',
    'BEGIN ',
    'TOKEN',
    'KEY',
    'SECRET',
    'PASSWORD',
    'PASSWD',
    'API_KEY',
    'APIKEY',
    'PRIVATE_KEY',
    'AUTH',
    'BEARER',
    'CREDENTIALS',
    'CERT',
    'Token',
    'Key',
    'Secret',
    'Password',
    'Auth',
    'Bearer',
    'Cert',
]);

/** Trigger tokens indicating dynamic execution and security-sensitive APIs. */
export const SECURITY_TRIGGERS: readonly string[] = Object.freeze([
    'eval',
    'Function',
    'execScript',
    'child_process',
    'exec',
    'spawn',
    'Math.random',
    'crypto',
    'md5',
    'sha1',
    'innerHTML',
    'dangerouslySetInnerHTML',
    'prototype',
    '__proto__',
    'constructor',
]);

/** Trigger tokens indicating shell command invocations. */
export const SHELL_LINT_TRIGGERS: readonly string[] = Object.freeze([
    'echo',
    'rm ',
    'sudo ',
    'export ',
    '#!/bin/',
    'source ',
    'cat ',
    'grep ',
    'mkdir ',
    'chmod ',
    'chown ',
]);

/** Trigger keywords indicating class-level object definitions. */
export const CLASS_TRIGGERS: readonly string[] = Object.freeze([
    'class ',
    'class_name',
    'struct ',
    'interface ',
]);

/** Trigger keywords indicating asynchronous coroutines and promises. */
export const ASYNC_TRIGGERS: readonly string[] = Object.freeze([
    'async ',
    'await ',
    'Promise',
    'go ',
]);

/** Trigger tokens indicating regular expression patterns and utilities. */
export const REGEX_TRIGGERS: readonly string[] = Object.freeze([
    'RegExp',
    're.',
    'regex',
    'Pattern',
]);

/** Catalog entry encapsulating registered triggers and their precomputed 256-LUT. */
export interface TriggerCatalogEntry {
    /** Target analyzer identifier. */
    readonly analyzerId: string;
    /** Registered trigger tokens. */
    readonly triggers: readonly string[];
    /** Precomputed 256-LUT for rapid initial-byte filtering. */
    readonly firstByteLut: Uint8Array;
}

/**
 * Compile a 256-element byte lookup table marking the initial byte of each trigger.
 *
 * @param triggers - Non-empty trigger tokens.
 * @returns Precomputed Uint8Array of size 256 with 1 at candidate initial byte indices.
 */
export function buildFirstByteLut(triggers: readonly string[]): Uint8Array {
    const lut = new Uint8Array(LUT_SIZE);
    const count = triggers.length;
    for (let i = 0; i < count; i++) {
        const trigger = triggers[i];
        if (trigger.length > 0) {
            lut[trigger.charCodeAt(0) & 0xff] = 1;
        }
    }
    return lut;
}

/**
 * Fast first-byte probe over text content using a precomputed 256-LUT.
 * Flat control flow without transient heap allocations (CPX-SPACE-001).
 *
 * @param content - File content string.
 * @param lut - Precomputed 256-byte lookup table.
 * @returns True if at least one candidate initial byte exists in content.
 */
export function probeFirstBytePresence(content: string, lut: Uint8Array): boolean {
    const len = content.length;
    for (let i = 0; i < len; i++) {
        if (lut[content.charCodeAt(i) & 0xff] === 1) {
            return true;
        }
    }
    return false;
}

/**
 * Vectorized substring probe testing whether any trigger in the array is present in content.
 * Flat early-exit loop; strictly zero heap allocation (CPX-SPACE-001).
 *
 * @param content - File content to search.
 * @param triggers - Trigger tokens to probe.
 * @returns True if any trigger is found.
 */
export function probeSubstrings(content: string, triggers: readonly string[]): boolean {
    const count = triggers.length;
    for (let i = 0; i < count; i++) {
        const trigger = triggers[i];
        if (trigger.length === 0) {
            continue;
        }
        if (content.indexOf(trigger) !== -1) {
            return true;
        }
    }
    return false;
}

/**
 * Combined 256-LUT byte probe and substring search.
 * First screens with the 256-LUT byte probe; if no candidate initial byte exists,
 * returns false immediately without performing string searches.
 *
 * @param content - File content.
 * @param triggers - Trigger tokens.
 * @param lut - 256-LUT byte table.
 * @returns True if content matches any trigger.
 */
export function matchAnyTrigger(
    content: string,
    triggers: readonly string[],
    lut: Uint8Array,
): boolean {
    if (!probeFirstBytePresence(content, lut)) {
        return false;
    }
    return probeSubstrings(content, triggers);
}

/**
 * Grep-inspired inverted trigger index managing signature trigger keywords
 * and 256-LUT byte probes for fast analyzer short-circuiting.
 */
export class AnalyzerTriggerCatalog {
    private readonly entries = new Map<string, TriggerCatalogEntry>();

    constructor() {
        this.registerDefaultTriggers();
    }

    /**
     * Register an analyzer with its signature trigger keywords.
     *
     * @param analyzerId - Unique identifier of the analyzer.
     * @param triggers - Array of trigger tokens required for activation.
     */
    public register(analyzerId: string, triggers: readonly string[]): void {
        const validTriggers = triggers.filter((t) => t.length > 0);
        const firstByteLut = buildFirstByteLut(validTriggers);
        this.entries.set(analyzerId, {
            analyzerId,
            triggers: validTriggers,
            firstByteLut,
        });
    }

    /**
     * Unregister an analyzer from the catalog.
     *
     * @param analyzerId - Identifier of the analyzer to remove.
     * @returns True if the analyzer was registered and removed.
     */
    public unregister(analyzerId: string): boolean {
        return this.entries.delete(analyzerId);
    }

    /**
     * Check if an analyzer has registered triggers.
     *
     * @param analyzerId - Analyzer identifier.
     * @returns True if registered and has non-empty triggers.
     */
    public hasTriggers(analyzerId: string): boolean {
        const entry = this.entries.get(analyzerId);
        return Boolean(entry && entry.triggers.length > 0);
    }

    /**
     * Retrieve the registered triggers for an analyzer.
     *
     * @param analyzerId - Analyzer identifier.
     * @returns Trigger tokens array or undefined if unregistered.
     */
    public getTriggers(analyzerId: string): readonly string[] | undefined {
        return this.entries.get(analyzerId)?.triggers;
    }

    /**
     * Retrieve the precomputed 256-LUT for an analyzer.
     *
     * @param analyzerId - Analyzer identifier.
     * @returns 256-LUT Uint8Array or undefined if unregistered.
     */
    public getFirstByteLut(analyzerId: string): Uint8Array | undefined {
        return this.entries.get(analyzerId)?.firstByteLut;
    }

    /**
     * Determine whether an analyzer should execute against the provided content.
     * Safe degradation contract:
     * - Unregistered or empty-trigger analyzers return true (execute safely).
     * - Empty content returns false when the analyzer has registered triggers.
     * - Registered analyzers execute only when content matches candidate triggers.
     *
     * @param analyzerId - Target analyzer identifier.
     * @param content - File content to inspect.
     * @returns True if the analyzer should be dispatched.
     */
    public shouldExecuteAnalyzer(analyzerId: string, content: string): boolean {
        const entry = this.entries.get(analyzerId);
        if (!entry || entry.triggers.length === 0) {
            return true;
        }
        if (!content || content.length === 0) {
            return false;
        }
        return matchAnyTrigger(content, entry.triggers, entry.firstByteLut);
    }

    /**
     * Filter active analyzer identifiers against the provided file content.
     *
     * @param analyzerIds - Iterable of candidate analyzer identifiers.
     * @param content - File content to inspect.
     * @returns Set of analyzer identifiers that should execute.
     */
    public filterActiveAnalyzers(analyzerIds: Iterable<string>, content: string): Set<string> {
        const ids = Array.from(analyzerIds);
        if (ids.length === 0) {
            return new Set<string>();
        }
        const triggerGroups = ids.map((id) => this.entries.get(id)?.triggers ?? []);
        const probeResults = nativeCore.batchProbeTriggers(content, triggerGroups);
        const result = new Set<string>();
        for (let i = 0; i < ids.length; i++) {
            if (probeResults[i]) {
                result.add(ids[i]);
            }
        }
        return result;
    }

    /**
     * Filter a resolved analyzer plan array against the provided file content.
     * Preserves plan order while pruning analyzers whose triggers are absent.
     *
     * @param plan - Resolved analyzer plan descriptors.
     * @param content - File content to inspect.
     * @returns Pruned plan containing only active analyzers.
     */
    public filterPlan<T extends { name: string }>(plan: readonly T[], content: string): T[] {
        if (!plan || plan.length === 0) {
            return [];
        }
        const triggerGroups = plan.map((p) => this.entries.get(p.name)?.triggers ?? []);
        const probeResults = nativeCore.batchProbeTriggers(content, triggerGroups);
        return plan.filter((_, idx) => probeResults[idx]);
    }

    /**
     * Reset the catalog to its initial built-in trigger configurations.
     */
    public reset(): void {
        this.entries.clear();
        this.registerDefaultTriggers();
    }

    /**
     * Populate the catalog with default trigger mappings for core analyzers.
     */
    private registerDefaultTriggers(): void {
        this.register('loops', LOOP_TRIGGERS);
        this.register('complexity', COMPLEXITY_TRIGGERS);
        this.register('comments', COMMENT_TRIGGERS);
        this.register('secrets', SECRET_TRIGGERS);
        this.register('security', SECURITY_TRIGGERS);
    }
}

/** Global singleton instance of AnalyzerTriggerCatalog. */
export const defaultTriggerCatalog = new AnalyzerTriggerCatalog();

/**
 * Top-level probe function evaluating whether an analyzer should execute on content.
 * Safe fallback: returns true for unregistered analyzers.
 *
 * @param analyzerId - Target analyzer identifier.
 * @param content - File content to inspect.
 * @returns True if the analyzer should execute.
 */
export function shouldExecuteAnalyzer(analyzerId: string, content: string): boolean {
    return defaultTriggerCatalog.shouldExecuteAnalyzer(analyzerId, content);
}

/**
 * Top-level plan filtering helper pruning inactive analyzers for a file.
 *
 * @param analyzers - Analyzer plan or descriptor list.
 * @param content - File content to inspect.
 * @returns Filtered list of active analyzers.
 */
export function filterAnalyzersForContent<T extends { name: string }>(
    analyzers: readonly T[],
    content: string,
): T[] {
    return defaultTriggerCatalog.filterPlan(analyzers, content);
}
