/**
 * Module: Core Engine - Effective Comment Density & Water-Logging Detector
 * File Path: src/core/comments/comment-density-model.ts
 * Architecture Role: Quantifies semantic quality and utility of comments in source code;
 *   penalizes trivial translations, tautological echoes, and water-logging padding.
 * Dependencies & Triggers: Consumes comment-types; consumed by comments analyzer and
 *   anti-gaming scorer.
 * Responsibilities: Classify comments into 9 distinct semantic categories; compute weighted
 *   Effective Comment Lines (ECL-C) and Effective Comment Ratio (ECR); flag water-logging patterns.
 * Exit Semantics & Design Rationale: Never throws; deterministic sub-millisecond parser.
 */

import type {
    CommentCategory,
    CommentSnippetAnalysis,
    EffectiveCommentMetrics,
} from './comment-types';

/** Category weight coefficients matrix */
const CATEGORY_WEIGHTS: Record<CommentCategory, number> = {
    DESIGN_RATIONALE: 1.0,
    ARCHITECTURE_INTENT: 1.0,
    ALGORITHMIC_PROOF: 1.0,
    LIFECYCLE_OWNERSHIP: 0.9,
    INVARIANT_BOUNDARY: 0.9,
    API_CONTRACT: 0.8,
    TRIVIAL_TRANSLATION: 0.0,
    BEHAVIOR_ECHO: -0.2,
    WATER_LOGGING: -0.5,
};

const DEFAULT_EXPLANATORY_WEIGHT = 0.7;
const MIN_WATER_LOGGING_RATIO_CEILING = 0.45;
const WATER_LOGGING_CRITICAL_COUNT = 2;
const COMBINED_WATER_LOGGING_THRESHOLD = 3;

/** Design rationale pattern */
const DESIGN_RATIONALE_RE =
    /\b(why|because|rationale|trade-?off|design\s+choice|intentional|reason)\b|为什么|设计原因|权衡|设计依据/i;

/** Architecture intent pattern */
const ARCHITECTURE_INTENT_RE =
    /\b(architecture\s+role|module|clean\s+architecture|subsystem|facade|adapter|domain)\b|架构定位|模块归属|契约/i;

/** Algorithmic complexity and proof pattern */
const ALGORITHMIC_PROOF_RE =
    /\b(o\([1nlogk]+\)|complexity|proof|convergence|heuristic|lemma|theorem)\b|算法|复杂度|推导|收敛|证明/i;

/** Lifecycle and concurrency pattern */
const LIFECYCLE_OWNERSHIP_RE =
    /\b(lifecycle|ownership|dispose|release|thread-?safe|reentrant|idempotent|mutex|lock)\b|生命周期|释放|并发|重入|幂等|锁/i;

/** Invariant and boundary conditions pattern */
const INVARIANT_BOUNDARY_RE =
    /\b(invariant|never\s+throws|must\s+satisfy|boundary|fallback|edge\s+case|safeguard|precondition)\b|不变量|边界|严禁|不可破坏|必须满足|异常时/i;

/** API contract and parameter tags pattern */
const API_CONTRACT_RE =
    /@(?:param|returns?|throws?|yields?|example|see)|(?:input|output|contract)\s*[:：]/i;

/** Water-logging placeholder pattern */
const WATER_LOGGING_RE =
    /^\s*(?:\/\/|#|\*)*\s*(?:todo\s*[:：]?\s*(?:implement|add|write)?|placeholder|fixme|dummy|pass|temp)\s*$/i;

/** Common simple statement echo pattern */
const BEHAVIOR_ECHO_CODE_RE =
    /^\s*(?:return\s+(?:true|false|null|undefined|\w+)|(?:let\s+)?\w+\+\+|(?:let\s+)?\w+--;|continue;|break;)\s*;?\s*$/;

/**
 * Strips formatting tokens and delimiters from raw comment text.
 */
function cleanCommentString(raw: string): string {
    return raw
        .replace(/^[\s/*#\-]+|[\s/*#\-]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extracts the declared identifier from the immediate following line of code.
 */
function extractNextLineSymbol(nextLine?: string): string | undefined {
    if (!nextLine) return undefined;
    const match = nextLine.match(
        /(?:function|class|interface|type|const|let|var|def|func|pub\s+fn)\s+([A-Za-z0-9_$]+)/,
    );
    return match ? match[1] : undefined;
}

/**
 * Classifies a single comment snippet into one of the 9 taxonomic categories.
 *
 * @param lineText - Raw text line containing the comment
 * @param nextCodeLine - Optional immediate next non-empty code line
 * @param lineIdx - 1-based source line index
 * @returns Classified CommentSnippetAnalysis record
 */
export function classifyCommentSnippet(
    lineText: string,
    nextCodeLine?: string,
    lineIdx = 1,
): CommentSnippetAnalysis {
    const trimmed = lineText.trim();
    if (trimmed === '/**' || trimmed === '*/' || trimmed === '/*' || trimmed === '*') {
        return {
            line: lineIdx,
            text: lineText,
            category: 'API_CONTRACT',
            weight: 0,
            isWaterLogging: false,
            reason: 'Block comment syntactic delimiter',
        };
    }

    const clean = cleanCommentString(lineText);

    // 1. Empty or placeholder water-logging
    if (WATER_LOGGING_RE.test(clean) || (clean.length > 0 && clean.length <= 2)) {
        return {
            line: lineIdx,
            text: lineText,
            category: 'WATER_LOGGING',
            weight: CATEGORY_WEIGHTS.WATER_LOGGING,
            isWaterLogging: true,
            reason: 'Empty or trivial placeholder comment without substantive documentation',
        };
    }

    // 2. Tautological behavior echo
    if (nextCodeLine && BEHAVIOR_ECHO_CODE_RE.test(nextCodeLine.trim())) {
        const nextClean = nextCodeLine.trim().toLowerCase().replace(/[;{}]/g, '');
        if (clean.toLowerCase().includes(nextClean) || nextClean.includes(clean.toLowerCase())) {
            return {
                line: lineIdx,
                text: lineText,
                category: 'BEHAVIOR_ECHO',
                weight: CATEGORY_WEIGHTS.BEHAVIOR_ECHO,
                isWaterLogging: true,
                reason: 'Tautological behavior echo mechanically re-stating obvious statement below',
            };
        }
    }

    // 3. Trivial symbol translation
    const nextSymbol = extractNextLineSymbol(nextCodeLine);
    if (nextSymbol) {
        const symbolLower = nextSymbol.toLowerCase();
        const cleanLower = clean.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (
            cleanLower === symbolLower ||
            cleanLower === `get${symbolLower}` ||
            cleanLower === `set${symbolLower}`
        ) {
            return {
                line: lineIdx,
                text: lineText,
                category: 'TRIVIAL_TRANSLATION',
                weight: CATEGORY_WEIGHTS.TRIVIAL_TRANSLATION,
                isWaterLogging: true,
                reason: `Trivial translation merely repeating symbol name [${nextSymbol}]`,
            };
        }
    }

    // 4. Substantive design rationale
    if (DESIGN_RATIONALE_RE.test(clean)) {
        return {
            line: lineIdx,
            text: lineText,
            category: 'DESIGN_RATIONALE',
            weight: CATEGORY_WEIGHTS.DESIGN_RATIONALE,
            isWaterLogging: false,
            reason: 'Substantive design rationale explaining why decisions or trade-offs were made',
        };
    }

    // 5. Architectural intent
    if (ARCHITECTURE_INTENT_RE.test(clean)) {
        return {
            line: lineIdx,
            text: lineText,
            category: 'ARCHITECTURE_INTENT',
            weight: CATEGORY_WEIGHTS.ARCHITECTURE_INTENT,
            isWaterLogging: false,
            reason: 'Architectural intent and subsystem role declaration',
        };
    }

    // 6. Algorithmic proof and complexity
    if (ALGORITHMIC_PROOF_RE.test(clean)) {
        return {
            line: lineIdx,
            text: lineText,
            category: 'ALGORITHMIC_PROOF',
            weight: CATEGORY_WEIGHTS.ALGORITHMIC_PROOF,
            isWaterLogging: false,
            reason: 'Algorithmic proof, complexity bounds, or convergence invariants',
        };
    }

    // 7. Invariant boundaries
    if (INVARIANT_BOUNDARY_RE.test(clean)) {
        return {
            line: lineIdx,
            text: lineText,
            category: 'INVARIANT_BOUNDARY',
            weight: CATEGORY_WEIGHTS.INVARIANT_BOUNDARY,
            isWaterLogging: false,
            reason: 'Invariant boundary, safety guard, or failure fallback specification',
        };
    }

    // 8. Resource lifecycle and concurrency ownership
    if (LIFECYCLE_OWNERSHIP_RE.test(clean)) {
        return {
            line: lineIdx,
            text: lineText,
            category: 'LIFECYCLE_OWNERSHIP',
            weight: CATEGORY_WEIGHTS.LIFECYCLE_OWNERSHIP,
            isWaterLogging: false,
            reason: 'Resource lifecycle, ownership management, or concurrency reentrancy notice',
        };
    }

    // 9. Structured API contracts
    if (API_CONTRACT_RE.test(clean)) {
        return {
            line: lineIdx,
            text: lineText,
            category: 'API_CONTRACT',
            weight: CATEGORY_WEIGHTS.API_CONTRACT,
            isWaterLogging: false,
            reason: 'Structured API contract, parameters, or return specifications',
        };
    }

    // 10. Default baseline explanatory documentation
    return {
        line: lineIdx,
        text: lineText,
        category: 'DESIGN_RATIONALE',
        weight: DEFAULT_EXPLANATORY_WEIGHT,
        isWaterLogging: false,
        reason: 'General explanatory documentation',
    };
}

/**
 * Calculates Effective Comment Density (ECD-C) metrics for source content.
 *
 * @param content - Full source code text
 * @returns Evaluated EffectiveCommentMetrics
 */
export function evaluateEffectiveCommentDensity(content: string): EffectiveCommentMetrics {
    const lines = content.split(/\r\n|\n/);
    const snippets: CommentSnippetAnalysis[] = [];
    const counts: Record<CommentCategory, number> = {
        DESIGN_RATIONALE: 0,
        ARCHITECTURE_INTENT: 0,
        ALGORITHMIC_PROOF: 0,
        LIFECYCLE_OWNERSHIP: 0,
        INVARIANT_BOUNDARY: 0,
        API_CONTRACT: 0,
        TRIVIAL_TRANSLATION: 0,
        BEHAVIOR_ECHO: 0,
        WATER_LOGGING: 0,
    };

    let totalCommentLines = 0;
    let weightedSum = 0;
    let inBlockComment = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const nextCodeLine = lines.slice(i + 1).find((l) => {
            const t = l.trim();
            return t.length > 0 && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('*');
        });

        let isCommentLine = false;
        let lineCommentText = '';

        if (inBlockComment) {
            if (trimmed.includes('*/')) {
                inBlockComment = false;
            }
            if (trimmed === '*/' || trimmed === '*') {
                continue;
            }
            isCommentLine = true;
            lineCommentText = trimmed;
        } else if (trimmed.startsWith('/*')) {
            if (!trimmed.includes('*/')) {
                inBlockComment = true;
            }
            if (trimmed === '/**' || trimmed === '/*') {
                continue;
            }
            isCommentLine = true;
            lineCommentText = trimmed;
        } else if (
            trimmed.startsWith('//') ||
            (trimmed.startsWith('#') && !trimmed.startsWith('#!'))
        ) {
            isCommentLine = true;
            lineCommentText = trimmed;
        }

        if (isCommentLine) {
            totalCommentLines++;
            const analysis = classifyCommentSnippet(lineCommentText, nextCodeLine, i + 1);
            snippets.push(analysis);
            counts[analysis.category]++;
            weightedSum += analysis.weight;
        }
    }

    const effectiveCommentLines = Math.max(0, Math.round(weightedSum * 10) / 10);
    const effectiveCommentRatio =
        totalCommentLines > 0
            ? Number((effectiveCommentLines / totalCommentLines).toFixed(3))
            : 1.0;

    const waterLoggingCount =
        counts.WATER_LOGGING + counts.BEHAVIOR_ECHO + counts.TRIVIAL_TRANSLATION;
    const hasWaterLogging =
        counts.WATER_LOGGING >= WATER_LOGGING_CRITICAL_COUNT ||
        (waterLoggingCount >= COMBINED_WATER_LOGGING_THRESHOLD &&
            effectiveCommentRatio < MIN_WATER_LOGGING_RATIO_CEILING);

    return {
        totalCommentLines,
        effectiveCommentLines,
        effectiveCommentRatio,
        hasWaterLogging,
        categoryCounts: counts,
        snippets,
    };
}
