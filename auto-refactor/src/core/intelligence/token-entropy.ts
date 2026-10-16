/**
 * Module: Core Intelligence — Token Stream Classification & Shannon Entropy
 * File Path: src/core/intelligence/token-entropy.ts
 * Architecture Role: Primary lexical tokenizer and information-theoretic entropy analyzer
 *   providing language-agnostic token classification, cognitive flux bandwidth tuning,
 *   and log-normal column density calculation.
 * Dependencies & Triggers: Pure native mathematical utility; zero external dependencies;
 *   invoked by analyzers and scoring modules to evaluate semantic density.
 * Responsibilities: Tokenize multi-language source code into four semantic categories
 *   (CALC_FLOW, DOMAIN_LITERAL, DELIMITER, WIRING); compute Shannon entropy and normalized
 *   entropy over token frequency distributions; evaluate Goldilocks entropy tuning factor;
 *   compute bilateral log-normal column density.
 * Exit Semantics & Design Rationale: Deterministic pure functions with zero runtime side effects;
 *   handles empty or invalid inputs gracefully with zero values; avoids division by zero;
 *   optimized with lookup tables and pre-compiled regex for sub-millisecond execution.
 */

/**
 * Semantic classification categories for lexical tokens.
 */
export type SemanticCategory = 'CALC_FLOW' | 'DOMAIN_LITERAL' | 'DELIMITER' | 'WIRING';

/**
 * Token classified with a semantic category and cognitive weight.
 */
export interface ClassifiedToken {
    readonly text: string;
    readonly category: SemanticCategory;
    readonly weight: number;
}

/**
 * Stream of classified tokens and category counts extracted from code.
 */
export interface TokenStream {
    readonly tokens: readonly ClassifiedToken[];
    readonly rawTokens: readonly string[];
    readonly tokenCountsByCategory: Readonly<Record<SemanticCategory, number>>;
}

/**
 * Result of Shannon entropy calculation across token vocabulary.
 */
export interface ShannonEntropyResult {
    readonly entropy: number;
    readonly normalizedEntropy: number;
    readonly vocabularySize: number;
}

/**
 * Result of column density analysis (tokens per line and column density).
 */
export interface ColumnDensityResult {
    readonly tokensPerEloc: number;
    readonly columnDensity: number;
}

/** Semantic category weights as dictated by cognitive payload specifications. */
export const CATEGORY_WEIGHTS: Readonly<Record<SemanticCategory, number>> = Object.freeze({
    CALC_FLOW: 1.0,
    DOMAIN_LITERAL: 0.8,
    DELIMITER: 0.1,
    WIRING: 0.05,
});

/** Wiring keywords across TypeScript, JavaScript, GDScript, Rust, Python, and Shell. */
const WIRING_KEYWORDS = new Set<string>([
    'import',
    'export',
    'from',
    'require',
    'use',
    'extern',
    'include',
    'package',
    'using',
    'as',
    'pub',
    'crate',
    'super',
    'extends',
    'preload',
    'module',
]);

/** Calculation and control-flow keywords across supported languages. */
const CALC_FLOW_KEYWORDS = new Set<string>([
    'if',
    'else',
    'elif',
    'for',
    'while',
    'loop',
    'match',
    'switch',
    'case',
    'default',
    'break',
    'continue',
    'return',
    'yield',
    'await',
    'fn',
    'function',
    'def',
    'func',
    'let',
    'const',
    'var',
    'mut',
    'class',
    'interface',
    'type',
    'struct',
    'enum',
    'trait',
    'impl',
    'async',
    'try',
    'catch',
    'finally',
    'throw',
    'except',
    'raise',
    'with',
    'in',
    'is',
    'not',
    'and',
    'or',
    'pass',
    'assert',
    'where',
    'select',
]);

/** Delimiter characters. */
const DELIMITER_SET = new Set<string>(['(', ')', '{', '}', '[', ']', ';', ',', '.']);

/** Regex for multi-character and single-character operators. */
const OPERATOR_PATTERN =
    /^(?:===|!==|>>>|<<=|>>=|\*\*=|&&=|\|\|=|\?\?=|==|!=|<=|>=|=>|->|<-|:=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<|>>|\*\*|&&|\|\||\?\?|\?\:|\?\.|--|\+\+|[+\-*/%&|^~!=<>?:])/;

/**
 * Classify a token into its semantic category.
 *
 * @param token The raw token string.
 * @returns The classified category and associated cognitive weight.
 */
function classifySingleToken(token: string): { category: SemanticCategory; weight: number } {
    if (WIRING_KEYWORDS.has(token)) {
        return { category: 'WIRING', weight: CATEGORY_WEIGHTS.WIRING };
    }
    if (CALC_FLOW_KEYWORDS.has(token) || OPERATOR_PATTERN.test(token)) {
        return { category: 'CALC_FLOW', weight: CATEGORY_WEIGHTS.CALC_FLOW };
    }
    if (DELIMITER_SET.has(token)) {
        return { category: 'DELIMITER', weight: CATEGORY_WEIGHTS.DELIMITER };
    }
    return { category: 'DOMAIN_LITERAL', weight: CATEGORY_WEIGHTS.DOMAIN_LITERAL };
}

interface TokenParserState {
    inWiringContext: boolean;
    braceDepth: number;
    lastIndex: number;
}

function extractRawToken(match: RegExpExecArray): string | null {
    for (let i = 1; i <= 5; i++) {
        const val = match[i];
        if (val !== undefined && val.length > 0) {
            return val;
        }
    }
    return null;
}

function updateWiringState(
    state: TokenParserState,
    rawToken: string,
    matchIndex: number,
    content: string,
): void {
    const gap = content.slice(state.lastIndex, matchIndex);
    if (state.braceDepth === 0 && gap.includes('\n')) {
        state.inWiringContext = false;
    }
    if (rawToken === 'import' || rawToken === 'export') {
        state.inWiringContext = true;
    }
    if (rawToken === '{') {
        state.braceDepth++;
    } else if (rawToken === '}' && state.braceDepth > 0) {
        state.braceDepth--;
    }
}

function resolveTokenCategory(
    rawToken: string,
    state: TokenParserState,
): { category: SemanticCategory; weight: number } {
    let { category, weight } = classifySingleToken(rawToken);

    if (category === 'DELIMITER') {
        if (rawToken === ';') {
            state.inWiringContext = false;
        }
    } else if (category === 'CALC_FLOW') {
        state.inWiringContext = false;
    } else if (state.inWiringContext) {
        category = 'WIRING';
        weight = CATEGORY_WEIGHTS.WIRING;
    }

    return { category, weight };
}

/**
 * Fast multi-language tokenizer supporting TypeScript/JavaScript, GDScript,
 * Rust, Python, and Shell.
 *
 * @param content The source code content string.
 * @param _language Optional language identifier (ts, js, gd, rs, py, sh).
 * @returns TokenStream containing classified tokens and category counts.
 */
export function tokenizeCode(content: string, _language?: string): TokenStream {
    if (!content || content.length === 0) {
        return {
            tokens: [],
            rawTokens: [],
            tokenCountsByCategory: { CALC_FLOW: 0, DOMAIN_LITERAL: 0, DELIMITER: 0, WIRING: 0 },
        };
    }

    const tokenRegex =
        /(?:\/\/.*?$|#.*?$|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(0x[0-9a-fA-F]+|0b[01]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([a-zA-Z_$][a-zA-Z0-9_$]*)|(===|!==|>>>|<<=|>>=|\*\*=|&&=|\|\|=|\?\?=|==|!=|<=|>=|=>|->|<-|:=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<|>>|\*\*|&&|\|\||\?\?|\?\.|--|\+\+|[+\-*/%&|^~!=<>?:])|([()[\]{};,.])/gmu;

    const classifiedTokens: ClassifiedToken[] = [];
    const rawTokensList: string[] = [];
    const counts: Record<SemanticCategory, number> = {
        CALC_FLOW: 0,
        DOMAIN_LITERAL: 0,
        DELIMITER: 0,
        WIRING: 0,
    };

    const state: TokenParserState = { inWiringContext: false, braceDepth: 0, lastIndex: 0 };
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(content)) !== null) {
        const rawToken = extractRawToken(match);
        if (!rawToken) {
            continue;
        }

        updateWiringState(state, rawToken, match.index, content);
        state.lastIndex = tokenRegex.lastIndex;

        const { category, weight } = resolveTokenCategory(rawToken, state);

        classifiedTokens.push({ text: rawToken, category, weight });
        rawTokensList.push(rawToken);
        counts[category]++;
    }

    return {
        tokens: classifiedTokens,
        rawTokens: rawTokensList,
        tokenCountsByCategory: counts,
    };
}

/**
 * Calculate token-level Shannon information entropy and normalized entropy.
 *
 * Formula:
 *   H(T) = -\sum P(t) \log_2 P(t)
 *   \hat{H}(T) = H(T) / \log_2 |V_T|
 *
 * @param tokens Array of raw token strings.
 * @returns Entropy, normalized entropy [0.0, 1.0], and vocabulary size.
 */
export function calculateTokenShannonEntropy(tokens: readonly string[]): ShannonEntropyResult {
    const totalCount = tokens.length;
    if (totalCount === 0) {
        return { entropy: 0, normalizedEntropy: 0, vocabularySize: 0 };
    }

    const freqMap = new Map<string, number>();
    for (let i = 0; i < totalCount; i++) {
        const t = tokens[i];
        freqMap.set(t, (freqMap.get(t) ?? 0) + 1);
    }

    const vocabularySize = freqMap.size;
    if (vocabularySize <= 1) {
        return { entropy: 0, normalizedEntropy: 0, vocabularySize };
    }

    let entropy = 0;
    const invTotal = 1.0 / totalCount;
    for (const count of freqMap.values()) {
        const p = count * invTotal;
        if (p > 0) {
            entropy -= p * Math.log2(p);
        }
    }

    const maxEntropy = Math.log2(vocabularySize);
    const normalizedEntropy =
        maxEntropy > 0 ? Math.min(1.0, Math.max(0.0, entropy / maxEntropy)) : 0;

    return {
        entropy: Math.round(entropy * 1e6) / 1e6,
        normalizedEntropy: Math.round(normalizedEntropy * 1e6) / 1e6,
        vocabularySize,
    };
}

/**
 * Calculate cognitive flux Goldilocks bandwidth Gaussian tuning factor.
 *
 * Bandwidth [4.5, 7.5] yields factor 1.0. Lower (under-entropy boilerplate) or higher
 * (over-entropy chaos) values decay smoothly via Gaussian attenuation.
 *
 * @param entropy Shannon entropy value.
 * @returns Tuning factor in [0.0, 1.0].
 */
export function calculateGoldilocksEntropyFactor(entropy: number): number {
    if (entropy < 0 || !Number.isFinite(entropy)) {
        return 0;
    }
    if (entropy >= 4.5 && entropy <= 7.5) {
        return 1.0;
    }

    const sigma = 1.0;
    const twoSigmaSq = 2.0 * sigma * sigma;

    if (entropy < 4.5) {
        const diff = 4.5 - entropy;
        const factor = Math.exp(-(diff * diff) / twoSigmaSq);
        return Math.round(Math.min(1.0, Math.max(0.0, factor)) * 1e6) / 1e6;
    }

    const diff = entropy - 7.5;
    const factor = Math.exp(-(diff * diff) / twoSigmaSq);
    return Math.round(Math.min(1.0, Math.max(0.0, factor)) * 1e6) / 1e6;
}

/**
 * Calculate bilateral log-normal effective column density.
 *
 * Optimal nominal: \tau_{optimal} = 7.5 tokens/eloc, tolerance \sigma = 0.55.
 *
 * @param tokensCount Total number of classified tokens.
 * @param eloc Effective lines of code.
 * @returns tokensPerEloc and columnDensity in [0.0, 1.0].
 */
export function calculateColumnDensity(tokensCount: number, eloc: number): ColumnDensityResult {
    if (tokensCount <= 0 || eloc <= 0 || !Number.isFinite(tokensCount) || !Number.isFinite(eloc)) {
        return { tokensPerEloc: 0, columnDensity: 0 };
    }

    const tokensPerEloc = tokensCount / eloc;
    const tauOptimal = 7.5;
    const sigma = 0.55;

    const logRatio = Math.log(tokensPerEloc / tauOptimal);
    const exponent = -(logRatio * logRatio) / (2.0 * sigma * sigma);
    const columnDensity = Math.exp(exponent);

    return {
        tokensPerEloc: Math.round(tokensPerEloc * 1e4) / 1e4,
        columnDensity: Math.round(Math.min(1.0, Math.max(0.0, columnDensity)) * 1e6) / 1e6,
    };
}
