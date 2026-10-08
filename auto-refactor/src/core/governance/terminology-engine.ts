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
    'two-pass',
    'multi-pass',
    'single-pass',
    'pass by value',
    'pass by reference',
    'pass parameter',
    'pass parameters',
    'pass argument',
    'pass arguments',
    'pass through',
    'pass-through',
]);

/** Matches transient batch milestones and work-in-progress markers */
export const CONSTRUCTION_JARGON_RE = /\b(p[0-9]+|phase[\s_]*[0-9]+|st[\s_]*[0-9]+|wip)\b/i;

const ASCII_CORE_ROOT_PATTERNS: readonly string[] = Object.freeze([
    'wip',
    'quick[-\\s]*(?:fix|and[-\\s]*dirty)',
    'hack(?:s|y)?',
    'band-?aid',
    'for\\s+now',
    'tentative',
    'provisional',
    'ad-?hoc',
    'stopgap',
    'patchy',
    'half-?baked',
    'casual\\s+commit',
    'placeholders?',
    'flawless',
    'perfect(?:ion)?',
    'ultimate',
    'bulletproof',
    'unbeatable',
    'invincible',
    'god-?tier',
    'peerless',
    'silver\\s+bullet',
    'zero-?bug',
    'enterprise-?grade',
    'state-?of-?the-?art',
    'best-?in-?class',
    'never\\s+fails?',
    'absolutely',
    'rubbish',
    'garbage',
    'crap',
    'trash',
    'shitty',
    'horrible',
    'terrible',
    'worthless',
    'complete\\s+mess',
    'disaster',
    'catastrophe',
    'useless\\s+code',
    'broken\\s+beyond\\s+repair',
    'idiotic',
    'game-?changer',
    'groundbreaking',
    'paradigm\\s+shift',
    'revolutionary',
    'epoch-?making',
    'monumental',
    'quantum\\s+leap',
    'milestone\\s+breakthrough',
    'tone\\s+down',
    'low-?key',
    'pragmatism',
    'stay\\s+humble',
    'truth-?seeking',
    'down-?to-?earth',
    'boastful',
    'promotional',
    'hyped',
    'meta-?narrative',
    'style\\s+refactoring',
    'style\\s+upgrade',
    'factual\\s+and\\s+pragmatic',
]);

function buildDefaultRulesCandidateRegex(): RegExp {
    const chinesePatterns: string[] = [];
    for (const rule of DEFAULT_TERMINOLOGY_RULES) {
        for (const pattern of rule.patterns) {
            if (pattern) {
                chinesePatterns.push(
                    pattern.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&'),
                );
            }
        }
    }
    const parts = [
        ...chinesePatterns,
        `\\b(?:${ASCII_CORE_ROOT_PATTERNS.join('|')})\\b`,
        '\\b100%',
    ];
    return new RegExp(parts.join('|'), 'i');
}

/**
 * Top-level singleton regex matching candidate forbidden terms and roots across all default rules.
 * Enables zero-overhead pre-filtering to short-circuit clean prose lines and documents.
 */
export const DEFAULT_RULES_FAST_CANDIDATE_RE: RegExp = buildDefaultRulesCandidateRegex();

const EMPTY_TERMINOLOGY_FINDINGS: readonly TerminologyFinding[] = Object.freeze([]);

const CODE_SPAN_RE = /`[^`]+`/g;
const RULE_ID_RE = /\b[A-Z]{2,4}-[A-Z0-9]+-[0-9]{3}\b/g;
const QUOTE_SPAN_DOUBLE_RE = /"[^"]+"/g;
const QUOTE_SPAN_SMART_RE = /“[^”]+”/g;
const QUOTE_SPAN_SINGLE_TOKEN_RE = /'(?:[a-zA-Z0-9_\-\.\*\/]+|(?:\([^\)]+\)))'/g;
const INLINE_FORMULA_RE = /\$[^$]+\$/g;
const LEADING_COMMENT_RE = /^\s*(?:\/\/|#|--|\*+)\s*/;

function buildCompiledWhitelistRegexes(whitelist: readonly string[]): {
    asciiRe: RegExp | null;
    nonAsciiRe: RegExp | null;
} {
    const asciiTerms: string[] = [];
    const nonAsciiTerms: string[] = [];

    for (const term of whitelist) {
        if (!term) continue;
        const escaped = term
            .replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&')
            .replace(/\s+/g, '\\s+');
        if (/^[a-zA-Z\s\-]+$/.test(term)) {
            asciiTerms.push(escaped);
        } else {
            nonAsciiTerms.push(escaped);
        }
    }

    const asciiRe =
        asciiTerms.length > 0 ? new RegExp(`\\b(?:${asciiTerms.join('|')})s?\\b`, 'gi') : null;
    const nonAsciiRe =
        nonAsciiTerms.length > 0 ? new RegExp(`(?:${nonAsciiTerms.join('|')})`, 'gi') : null;
    return { asciiRe, nonAsciiRe };
}

const DEFAULT_WHITELIST_COMPILED = buildCompiledWhitelistRegexes(DEFAULT_TECHNICAL_WHITELIST);
const ASCII_PATTERN_RE_CACHE = new Map<string, RegExp>();
const CUSTOM_WHITELIST_CACHE = new Map<
    string,
    { asciiRe: RegExp | null; nonAsciiRe: RegExp | null }
>();

function getOrCompileAsciiPattern(asciiPat: string): RegExp {
    let re = ASCII_PATTERN_RE_CACHE.get(asciiPat);
    if (!re) {
        const unescaped = asciiPat.replace(/\\[a-zA-Z]/g, '');
        const isExactCase = !/[a-z]/.test(unescaped) && /[A-Z]/.test(unescaped);
        const flags = isExactCase ? 'g' : 'gi';
        re = new RegExp(asciiPat, flags);
        ASCII_PATTERN_RE_CACHE.set(asciiPat, re);
    }
    return re;
}

interface CompiledRuleLexicon {
    readonly patternRe: RegExp | null;
    readonly patternSet: ReadonlySet<string>;
}

const RULE_LEXICON_CACHE = new WeakMap<TerminologyRule, CompiledRuleLexicon>();

function getOrCompileRuleLexicon(rule: TerminologyRule): CompiledRuleLexicon {
    let lexicon = RULE_LEXICON_CACHE.get(rule);
    if (!lexicon) {
        const validPatterns = rule.patterns.filter((p): p is string => Boolean(p && p.length > 0));
        if (validPatterns.length === 0) {
            lexicon = { patternRe: null, patternSet: new Set() };
        } else {
            // Sort by descending length so longer compound phrases match first
            const sorted = [...validPatterns].sort((a, b) => b.length - a.length);
            const escaped = sorted.map((p) =>
                p.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&'),
            );
            lexicon = {
                patternRe: new RegExp(escaped.join('|'), 'g'),
                patternSet: new Set(validPatterns),
            };
        }
        RULE_LEXICON_CACHE.set(rule, lexicon);
    }
    return lexicon;
}

// Pre-warm the lexicon cache for all default terminology rules
for (const defaultRule of DEFAULT_TERMINOLOGY_RULES) {
    getOrCompileRuleLexicon(defaultRule);
}

/**
 * Strips leading line comment markers (//, #, --, block comment markers) from a line.
 *
 * @param line - Raw prose line
 * @returns Clean line with leading comment syntax stripped
 */
export function stripLineComments(line: string): string {
    if (!line) return '';
    return line.replace(LEADING_COMMENT_RE, '');
}

/**
 * Strips or masks quoted literal string spans within a line.
 *
 * @param line - Candidate line
 * @returns Line with quoted literals masked
 */
export function stripQuotedLiterals(line: string): string {
    if (!line) return '';
    let sanitized = line;
    if (sanitized.includes('"')) {
        sanitized = sanitized.replace(QUOTE_SPAN_DOUBLE_RE, ' __QUOTE_SPAN__ ');
    }
    if (sanitized.includes('“')) {
        sanitized = sanitized.replace(QUOTE_SPAN_SMART_RE, ' __QUOTE_SPAN__ ');
    }
    if (sanitized.includes("'")) {
        sanitized = sanitized.replace(QUOTE_SPAN_SINGLE_TOKEN_RE, ' __QUOTE_SPAN__ ');
    }
    return sanitized;
}

/**
 * Masks technical code spans, formulas, and rule identifiers.
 *
 * @param line - Candidate line
 * @returns Line with technical spans masked
 */
export function maskTechnicalSpans(line: string): string {
    if (!line) return '';
    let sanitized = line;
    if (sanitized.includes('`')) {
        sanitized = sanitized.replace(CODE_SPAN_RE, ' __CODE_SPAN__ ');
    }
    if (sanitized.includes('$')) {
        sanitized = sanitized.replace(INLINE_FORMULA_RE, ' __FORMULA_SPAN__ ');
    }
    if (sanitized.includes('-')) {
        sanitized = sanitized.replace(RULE_ID_RE, ' __RULE_ID__ ');
    }
    return sanitized;
}

/**
 * Masks default technical whitelist terms using precompiled regexes.
 *
 * @param line - Partially sanitized line
 * @returns Line with default whitelist terms masked
 */
function maskDefaultWhitelist(line: string): string {
    let sanitized = line;
    if (DEFAULT_WHITELIST_COMPILED.asciiRe) {
        sanitized = sanitized.replace(DEFAULT_WHITELIST_COMPILED.asciiRe, ' __WHITELIST_TERM__ ');
    }
    if (DEFAULT_WHITELIST_COMPILED.nonAsciiRe) {
        sanitized = sanitized.replace(DEFAULT_WHITELIST_COMPILED.nonAsciiRe, ' __WHITELIST_TERM__ ');
    }
    return sanitized;
}

function getOrCompileCustomWhitelist(whitelist: readonly string[]): {
    asciiRe: RegExp | null;
    nonAsciiRe: RegExp | null;
} {
    const key = whitelist.join('\u0000');
    let compiled = CUSTOM_WHITELIST_CACHE.get(key);
    if (!compiled) {
        compiled = buildCompiledWhitelistRegexes(whitelist);
        if (CUSTOM_WHITELIST_CACHE.size >= 50) {
            CUSTOM_WHITELIST_CACHE.clear();
        }
        CUSTOM_WHITELIST_CACHE.set(key, compiled);
    }
    return compiled;
}

/**
 * Masks custom whitelist expressions on a sanitized line.
 *
 * @param line - Pre-masked line
 * @param customWhitelist - Optional whitelist entries to mask
 * @returns Line with custom whitelisted terms masked
 */
export function maskCustomWhitelist(
    line: string,
    customWhitelist?: readonly string[],
): string {
    if (!line || !customWhitelist || customWhitelist.length === 0) {
        return line;
    }
    const compiled = getOrCompileCustomWhitelist(customWhitelist);
    let sanitized = line;
    if (compiled.asciiRe) {
        sanitized = sanitized.replace(compiled.asciiRe, ' __WHITELIST_TERM__ ');
    }
    if (compiled.nonAsciiRe) {
        sanitized = sanitized.replace(compiled.nonAsciiRe, ' __WHITELIST_TERM__ ');
    }
    return sanitized;
}

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
    if (!line) return '';

    // Stage 1: Mask code spans, formulas, and rule IDs
    let sanitized = maskTechnicalSpans(line);

    // Stage 2: Mask explicit quotation marks
    sanitized = stripQuotedLiterals(sanitized);

    // Stage 3: Mask whitelisted technical compound terms using precompiled regexes
    sanitized = maskDefaultWhitelist(sanitized);

    // Stage 4: Process custom whitelist if provided
    return maskCustomWhitelist(sanitized, customWhitelist);
}

/**
 * Resolves column index in raw line with fast prefix/boundary probe.
 */
function resolveRawColumn(rawLine: string, term: string, hintIndex: number): number {
    const termLen = term.length;
    if (hintIndex >= 0 && hintIndex + termLen <= rawLine.length) {
        if (rawLine.startsWith(term, hintIndex)) {
            return hintIndex;
        }
    }
    const col = rawLine.indexOf(term);
    return col >= 0 ? col : hintIndex;
}

/**
 * Resolves case-insensitive column index in raw line with single boundary probe.
 */
function resolveAsciiRawColumn(
    rawLine: string,
    term: string,
    hintIndex: number,
    lowerRawLine: string,
): number {
    const termLen = term.length;
    const lowerTerm = term.toLowerCase();

    // 1. Fast prefix/boundary probe at hintIndex (O(termLen), zero full-string scan)
    if (hintIndex >= 0 && hintIndex + termLen <= rawLine.length) {
        if (lowerRawLine.startsWith(lowerTerm, hintIndex)) {
            return hintIndex;
        }
    }

    // 2. Fallback single scan on pre-lowercased line
    const col = lowerRawLine.indexOf(lowerTerm);
    return col >= 0 ? col : hintIndex;
}

/** Check pattern match on a single line appending directly into accumulator */
function collectLinePatterns(
    outFindings: TerminologyFinding[],
    sanitized: string,
    rawLine: string,
    lineNum: number,
    rule: TerminologyRule,
): void {
    const lexicon = getOrCompileRuleLexicon(rule);
    if (!lexicon.patternRe) return;

    lexicon.patternRe.lastIndex = 0;
    const seenTerms = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = lexicon.patternRe.exec(sanitized)) !== null) {
        const pattern = match[0];
        if (!lexicon.patternSet.has(pattern) || seenTerms.has(pattern)) {
            continue;
        }
        seenTerms.add(pattern);

        const sanitizedCol = match.index;
        if (isVocabularyEnumeration(sanitized, sanitizedCol, pattern)) {
            continue;
        }

        const col = resolveRawColumn(rawLine, pattern, sanitizedCol);
        if (col >= 0 && isVocabularyEnumeration(rawLine, col, pattern)) {
            continue;
        }

        outFindings.push({
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
}

/** Check pattern match on a single line */
function checkLinePatterns(
    sanitized: string,
    rawLine: string,
    lineNum: number,
    rule: TerminologyRule,
): TerminologyFinding[] {
    const findings: TerminologyFinding[] = [];
    collectLinePatterns(findings, sanitized, rawLine, lineNum, rule);
    return findings;
}

/** Check ascii regex patterns on a single line appending directly into accumulator */
function collectLineAsciiPatterns(
    outFindings: TerminologyFinding[],
    sanitized: string,
    rawLine: string,
    lineNum: number,
    rule: TerminologyRule,
    lowerRawLine?: string,
): void {
    const lowerRaw = lowerRawLine ?? rawLine.toLowerCase();
    for (const asciiPat of rule.asciiPatterns) {
        const re = getOrCompileAsciiPattern(asciiPat);
        re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(sanitized)) !== null) {
            const term = match[0];
            if (isVocabularyEnumeration(sanitized, match.index, term)) {
                continue;
            }

            const actualCol = resolveAsciiRawColumn(rawLine, term, match.index, lowerRaw);
            if (isVocabularyEnumeration(rawLine, actualCol, term)) {
                continue;
            }

            outFindings.push({
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
}

/** Check ascii regex patterns on a single line */
function checkLineAsciiPatterns(
    sanitized: string,
    rawLine: string,
    lineNum: number,
    rule: TerminologyRule,
): TerminologyFinding[] {
    const findings: TerminologyFinding[] = [];
    collectLineAsciiPatterns(findings, sanitized, rawLine, lineNum, rule);
    return findings;
}

function auditLineAgainstRules(
    findings: TerminologyFinding[],
    sanitized: string,
    rawLine: string,
    lineNum: number,
    rules: readonly TerminologyRule[],
    options: TerminologyAuditOptions,
    allowedCategorySet: ReadonlySet<TerminologyCategory> | null,
    lowerRawLine: string,
): void {
    for (const rule of rules) {
        if (allowedCategorySet && !allowedCategorySet.has(rule.category)) {
            continue;
        }
        if (options.checkPatterns !== false) {
            collectLinePatterns(findings, sanitized, rawLine, lineNum, rule);
        }
        if (options.checkAscii !== false) {
            collectLineAsciiPatterns(findings, sanitized, rawLine, lineNum, rule, lowerRawLine);
        }
    }
}

function isEligibleProseLine(line: string, isDefaultRules: boolean): boolean {
    if (!line || line.trim().length === 0) return false;
    if (isDefaultRules && !DEFAULT_RULES_FAST_CANDIDATE_RE.test(line)) return false;
    return true;
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
    if (!content || content.length === 0) return EMPTY_TERMINOLOGY_FINDINGS;

    const isDefaultRules = rules === DEFAULT_TERMINOLOGY_RULES;
    if (isDefaultRules && !DEFAULT_RULES_FAST_CANDIDATE_RE.test(content)) {
        return EMPTY_TERMINOLOGY_FINDINGS;
    }

    const lines = content.split('\n');
    const findings: TerminologyFinding[] = [];
    const customWhitelist = options.customWhitelist || [];
    const allowedCategorySet = options.allowedCategories
        ? new Set<TerminologyCategory>(options.allowedCategories)
        : null;

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        if (!isEligibleProseLine(rawLine, isDefaultRules)) continue;

        const sanitized = sanitizeLineForTerminology(rawLine, customWhitelist);
        const lowerRawLine = rawLine.toLowerCase();
        auditLineAgainstRules(
            findings,
            sanitized,
            rawLine,
            i + 1,
            rules,
            options,
            allowedCategorySet,
            lowerRawLine,
        );
    }

    return findings.length === 0 ? EMPTY_TERMINOLOGY_FINDINGS : Object.freeze(findings);
}
