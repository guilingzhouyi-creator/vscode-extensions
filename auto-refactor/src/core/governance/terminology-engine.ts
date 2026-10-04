/**
 * Module: Core Governance — Single Source of Truth Terminology Engine
 * File Path: src/core/governance/terminology-engine.ts
 * Architecture Role: Provides unified prose sanitization, forbidden term detection, and
 *   contextual whitelist masking across source comments, documentation, and metadata definitions.
 * Dependencies & Triggers: Consumes markerScope; invoked by CommentsAnalyzer, DocsAnalyzer,
 *   Governance analyzers, and registry verification harnesses.
 * Responsibilities:
 *   1. Define canonical TerminologyRule and TerminologyFinding data contracts.
 *   2. Sanitize candidate prose via four-stage masking pipeline (code, IDs, quotes, whitelists).
 *   3. Match sanitized text against bidirectional bilingual forbidden patterns.
 *   4. Provide deterministic audit functions with zero side effects.
 * Exit Semantics & Design Rationale: Pure string evaluation; never throws; returns frozen arrays.
 */

import { isVocabularyEnumeration } from './markerScope';

/** Categorical classifications for terminology defects */
export type TerminologyCategory =
    'temporary' | 'hyperbolic_affirmative' | 'hyperbolic_negative' | 'meta_narrative';

/** Diagnostic severity for terminology violation findings */
export type TerminologySeverity = 'error' | 'warning' | 'info';

/** Rule specification for terminology constraints */
export interface TerminologyRule {
    readonly category: TerminologyCategory;
    readonly severity: TerminologySeverity;
    readonly title: string;
    readonly patterns: readonly string[];
    readonly asciiPatterns: readonly string[];
    readonly reason: string;
    readonly guidance: string;
}

/** Finding payload emitted when non-compliant terminology is detected */
export interface TerminologyFinding {
    readonly category: TerminologyCategory;
    readonly severity: TerminologySeverity;
    readonly term: string;
    readonly line: number;
    readonly column: number;
    readonly message: string;
    readonly guidance: string;
    readonly contextSnippet: string;
}

/** Options configuring prose terminology audit */
export interface TerminologyAuditOptions {
    readonly customWhitelist?: readonly string[];
    readonly allowedCategories?: readonly TerminologyCategory[];
    readonly checkAscii?: boolean;
    readonly checkPatterns?: boolean;
}

/** Built-in canonical rules fallback matching workspace single-source specification */
export const DEFAULT_TERMINOLOGY_RULES: readonly TerminologyRule[] = Object.freeze([
    {
        category: 'temporary',
        severity: 'warning',
        title: 'Temporary or Casual Language Constraint',
        patterns: [
            '临时方案',
            '暂存',
            '凑合',
            '随便',
            '粗略',
            '先这样',
            '待处理',
            '后续再看',
            '占位',
            '随便改改',
            '打补丁',
            '草率',
        ],
        asciiPatterns: [
            '\\b(wip|quick\\s*fix|quick-and-dirty|hack|hacky|hacks|band-?aid|for\\s*now|tentative|provisional|ad-?hoc|stopgap|patchy|half-?baked|casual\\s*commit)\\b',
            '\\b((?:just|stub|dummy|temporary|wip)\\s*a?\\s*placeholders?|placeholders?\\s*(?:implementation|for\\s*now|only|code))\\b',
        ],
        reason: 'Technical documentation and comments must convey enduring facts rather than casual or unfinished markers.',
        guidance: 'State concrete technical boundaries and scopes instead of tentative phrasing.',
    },
    {
        category: 'hyperbolic_affirmative',
        severity: 'warning',
        title: 'Hyperbolic Affirmative and Absolute Claim Constraint',
        patterns: [
            '绝对化',
            '完美无瑕',
            '极致',
            '终极',
            '史无前例',
            '完全消除',
            '永不崩溃',
            '100%安全',
            '工业级',
            '顶级',
            '天花板',
            '最强',
            '无懈可击',
            '超强',
            '万能',
            '零缺陷',
        ],
        asciiPatterns: [
            '\\b(flawless|perfect|perfection|ultimate|bulletproof|unbeatable|invincible|god-?tier|peerless|silver\\s*bullet|zero-?bug|enterprise-?grade|state-?of-?the-?art|best-?in-?class)\\b',
            '\\b(never\\s*fails?|absolutely\\s*(safe|correct|flawless))\\b',
            '\\b100%\\s*(safe|secure|fixed|working|reliable|guaranteed)\\b',
        ],
        reason: 'Technical narratives must remain factual, verifiable, and free of hyperbolic marketing claims.',
        guidance:
            'Describe specific algorithms, mechanisms, and verified test conditions objectively.',
    },
    {
        category: 'hyperbolic_negative',
        severity: 'warning',
        title: 'Hyperbolic Negative and Derogatory Language Constraint',
        patterns: [
            '一团糟',
            '稀烂',
            '毫无意义',
            '彻底失败',
            '毫无价值',
            '致命缺陷',
            '严重崩溃',
            '烂代码',
            '废物',
            '稀碎',
        ],
        asciiPatterns: [
            '\\b(rubbish|garbage|total\\s*crap|trash|shitty|horrible|terrible|worthless|complete\\s*mess|disaster|catastrophe|useless\\s*code|broken\\s*beyond\\s*repair|idiotic)\\b',
        ],
        reason: 'Technical discussions and issue logs must remain professional, constructive, and neutral.',
        guidance: 'State specific technical motivations and architectural deficiencies factually.',
    },
    {
        category: 'meta_narrative',
        severity: 'warning',
        title: 'Meta-Narrative Slogans and Promotional Phrasing Constraint',
        patterns: [
            '低调中肯',
            '求真务实',
            '宣扬性词汇',
            '移除宣扬性词汇',
            '调整文案语调',
            '风格升级',
            '实事求是',
            '拒绝浮夸',
            '标杆',
            '跨时代',
            '划时代',
            '重磅',
            '里程碑式',
            '突破性',
            '颠覆性',
            '重塑',
            '飞跃',
            '史诗级',
        ],
        asciiPatterns: [
            '\\b(game-?changer|groundbreaking|paradigm\\s*shift|revolutionary|epoch-?making|monumental|quantum\\s*leap|milestone\\s*breakthrough)\\b',
            '\\b(tone\\s*down|low-?key|pragmatism|stay\\s*humble|truth-?seeking|down-?to-?earth)\\b',
            '\\b(remove\\s*(boastful|promotional|hyped)\\s*(words?|vocabulary|terms?|language)?)\\b',
            '\\b(meta-?narrative|style\\s*refactoring|style\\s*upgrade|factual\\s*and\\s*pragmatic)\\b',
        ],
        reason: 'Governance slogans and meta-narrative declarations must not substitute concrete technical facts.',
        guidance: 'Directly describe the concrete changes and file sections modified.',
    },
]);

/** Canonical technical compound terms exempted from false positive triggers */
export const DEFAULT_TECHNICAL_WHITELIST: readonly string[] = Object.freeze([
    '绝对路径',
    '绝对地址',
    '绝对值',
    '绝对像素尺寸',
    '绝对坐标',
    '绝对定位',
    '临时文件',
    '临时目录',
    '临时表',
    '临时对象',
    '临时缓冲区',
    '临时变量',
    '临时存储',
    '全量编译',
    '全量检查点',
    '完全限定名',
    'absolute path',
    'absolute address',
    'absolute value',
    'absolute coordinate',
    'absolute position',
    'temp file',
    'temporary file',
    'temporary directory',
    'temporary table',
    'temporary object',
    'temporary buffer',
    'temporary variable',
    'temporary storage',
    'full build',
    'full checkpoint',
    '垃圾回收',
    'garbage collection',
    'garbage collector',
    'garbage-collected',
    'garbage-collection',
    'quick fix action',
    'quick-fix action',
    'quick fix snippet',
    'quick fix label',
    'format placeholder',
    'template placeholder',
    'parameter placeholder',
    'empty placeholder',
    'placeholder node',
    'placeholder pattern',
    'placeholder bag',
    'placeholder archive',
    'vacuous placeholder',
    'positional placeholder',
    '暂存区',
    '暂存切片',
    'staging area',
    'discard 占位符',
    '占位文件',
    '占位注释',
    '占位符',
]);

/** Matches transient batch milestones and work-in-progress markers */
export const CONSTRUCTION_JARGON_RE = /\b(p[0-9]+|phase[\s_]*[0-9]+|st[\s_]*[0-9]+|wip)\b/i;

const CODE_SPAN_RE = /`[^`]+`/g;
const RULE_ID_RE = /\b[A-Z]{2,4}-[A-Z0-9]+-[0-9]{3}\b/g;
const QUOTE_SPAN_DOUBLE_RE = /"[^"]+"/g;
const QUOTE_SPAN_SMART_RE = /“[^”]+”/g;
const QUOTE_SPAN_SINGLE_TOKEN_RE = /'(?:[a-zA-Z0-9_\-\.\*\/]+|(?:\([^\)]+\)))'/g;
const INLINE_FORMULA_RE = /\$[^$]+\$/g;

/**
 * Mask explicit technical spans, rule codes, formulas, and whitelisted terms.
 *
 * @param line - Raw input text line
 * @param customWhitelist - Optional additional whitelist entries
 * @returns Masked sanitized line safe for term verification
 */
export function sanitizeLineForTerminology(
    line: string,
    customWhitelist: readonly string[] = [],
): string {
    let sanitized = line;

    // Stage 1: Mask code spans, formulas, and rule IDs
    sanitized = sanitized.replace(CODE_SPAN_RE, ' __CODE_SPAN__ ');
    sanitized = sanitized.replace(INLINE_FORMULA_RE, ' __FORMULA_SPAN__ ');
    sanitized = sanitized.replace(RULE_ID_RE, ' __RULE_ID__ ');

    // Stage 2: Mask explicit quotation marks
    sanitized = sanitized.replace(QUOTE_SPAN_DOUBLE_RE, ' __QUOTE_SPAN__ ');
    sanitized = sanitized.replace(QUOTE_SPAN_SMART_RE, ' __QUOTE_SPAN__ ');
    sanitized = sanitized.replace(QUOTE_SPAN_SINGLE_TOKEN_RE, ' __QUOTE_SPAN__ ');

    // Stage 3: Mask whitelisted technical compound terms
    const mergedWhitelist = [...DEFAULT_TECHNICAL_WHITELIST, ...customWhitelist];
    for (const term of mergedWhitelist) {
        if (!term) continue;
        const escaped = term
            .replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&')
            .replace(/\s+/g, '\\s+');
        if (/^[a-zA-Z\s\-]+$/.test(term)) {
            const reg = new RegExp(`\\b${escaped}s?\\b`, 'gi');
            sanitized = sanitized.replace(reg, ' __WHITELIST_TERM__ ');
        } else {
            const reg = new RegExp(escaped, 'gi');
            sanitized = sanitized.replace(reg, ' __WHITELIST_TERM__ ');
        }
    }

    return sanitized;
}

/** Check pattern match on a single line */
function checkLinePatterns(
    sanitized: string,
    rawLine: string,
    lineNum: number,
    rule: TerminologyRule,
): TerminologyFinding[] {
    const findings: TerminologyFinding[] = [];
    for (const pattern of rule.patterns) {
        if (!pattern || !sanitized.includes(pattern)) continue;
        if (isVocabularyEnumeration(sanitized, sanitized.indexOf(pattern), pattern)) continue;
        const col = rawLine.indexOf(pattern);
        if (col >= 0 && isVocabularyEnumeration(rawLine, col, pattern)) continue;

        findings.push({
            category: rule.category,
            severity: rule.severity,
            term: pattern,
            line: lineNum,
            column: Math.max(1, col + 1),
            message: `Prose contains ${rule.category} terminology \`${pattern}\`: ${rule.reason}`,
            guidance: rule.guidance,
            contextSnippet: rawLine.trim().slice(0, 100),
        });
    }
    return findings;
}

/** Check ascii regex patterns on a single line */
function checkLineAsciiPatterns(
    sanitized: string,
    rawLine: string,
    lineNum: number,
    rule: TerminologyRule,
): TerminologyFinding[] {
    const findings: TerminologyFinding[] = [];
    for (const asciiPat of rule.asciiPatterns) {
        if (!asciiPat) continue;
        const re = new RegExp(asciiPat, 'gi');
        let match: RegExpExecArray | null;
        while ((match = re.exec(sanitized)) !== null) {
            const term = match[0];
            if (isVocabularyEnumeration(sanitized, match.index, term)) continue;
            const col = rawLine.toLowerCase().indexOf(term.toLowerCase());
            const actualCol = col >= 0 ? col : match.index;
            if (isVocabularyEnumeration(rawLine, actualCol, term)) continue;

            findings.push({
                category: rule.category,
                severity: rule.severity,
                term,
                line: lineNum,
                column: Math.max(1, actualCol + 1),
                message: `Prose contains ${rule.category} term \`${term}\`: ${rule.reason}`,
                guidance: rule.guidance,
                contextSnippet: rawLine.trim().slice(0, 100),
            });
        }
    }
    return findings;
}

/**
 * Evaluates prose text against terminology constraints.
 *
 * @param content - Multi-line string content to audit
 * @param options - Audit configuration options
 * @param rules - Terminology rule set (defaults to standard rules)
 * @returns Immutable array of detected findings
 */
export function auditTerminologyProse(
    content: string,
    options: TerminologyAuditOptions = {},
    rules: readonly TerminologyRule[] = DEFAULT_TERMINOLOGY_RULES,
): readonly TerminologyFinding[] {
    if (!content || content.length === 0) return [];

    const lines = content.split('\n');
    const findings: TerminologyFinding[] = [];
    const customWhitelist = options.customWhitelist || [];

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        if (!rawLine || rawLine.trim().length === 0) continue;

        const sanitized = sanitizeLineForTerminology(rawLine, customWhitelist);

        for (const rule of rules) {
            if (options.allowedCategories && !options.allowedCategories.includes(rule.category)) {
                continue;
            }

            if (options.checkPatterns !== false) {
                findings.push(...checkLinePatterns(sanitized, rawLine, i + 1, rule));
            }
            if (options.checkAscii !== false) {
                findings.push(...checkLineAsciiPatterns(sanitized, rawLine, i + 1, rule));
            }
        }
    }

    return Object.freeze(findings);
}
