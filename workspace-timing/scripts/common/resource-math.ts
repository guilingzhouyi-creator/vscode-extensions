// @wt-script common/resource-math
// @purpose 结构化资源拓扑数学库：语义体积SV/倒排索引稀疏图/多模态内聚度/Tarjan SCC循环解耦/三元风险/贝叶斯先验
// @origin native
// @usage import { detectLanguage, computeSemanticVolume, computeDynamicThresholds, tarjanSCC, computeTripartiteRisk } from './resource-math.js'
// @exit 不适用（库模块）

import type { ScalingConstants } from './config.js';

export type SupportedLanguage = 'typescript' | 'javascript' | 'rust' | 'cpp' | 'c' | 'go' | 'gdscript' | 'python' | 'json';

const EXTENSION_LANGUAGE_MAP: Record<string, SupportedLanguage> = {
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.mts': 'typescript',
    '.cts': 'typescript',
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.rs': 'rust',
    '.cpp': 'cpp',
    '.cc': 'cpp',
    '.cxx': 'cpp',
    '.hpp': 'cpp',
    '.hxx': 'cpp',
    '.c': 'c',
    '.h': 'c',
    '.go': 'go',
    '.gd': 'gdscript',
    '.py': 'python',
    '.json': 'json',
};

/** [Hard Invariant] 根据物理文件扩展名识别目标语言类型 */
export function detectLanguage(filePath: string): SupportedLanguage {
    const extMatch = filePath.toLowerCase().match(/\.[a-z0-9]+$/);
    if (extMatch && EXTENSION_LANGUAGE_MAP[extMatch[0]]) {
        return EXTENSION_LANGUAGE_MAP[extMatch[0]];
    }
    return 'typescript';
}

export interface SemanticVolumeResult {
    totalLines: number;
    pureEloc: number;
    commentLines: number;
    blankLines: number;
    declLines: number;
    structuralPurity: number;   // P_struct [0, 1]
    astNodeCount: number;       // N_AST
    symbolCount: number;        // N_symbol
    literalCount: number;       // N_literal
    maxDepth: number;           // Depth_AST
    semanticVolume: number;     // SV(f)
    isLinePacked: boolean;      // 抗压行攻击标记
}

const DECL_PATTERNS: readonly RegExp[] = [
    /^\s*(?:export\s+)?(?:const|let|var|enum|type|interface)\b/,
    /^\s*(?:pub\s+)?(?:const|static|enum|type|struct)\b/,
    /^\s*(?:constexpr|const|enum\s+class|#define|struct\s+\w+\s*\{)\b/,
    /^\s*(?:const|var|enum)\b/,
    /^\s*(?:[A-Z0-9_]+\s*=|class\s+\w+\(Enum\):)/,
    /^\s*['"][^'"]+['"]\s*:/,
    /^\s*(?:readonly\s+)?[a-zA-Z0-9_$]+\??\s*:/,
    /^\s*(?:import\b|export\s*[{*]|export\s+default\b)/,
    /^\s*[}{\]),;]+\s*$/,
];

const EXECUTABLE_PATTERNS: readonly RegExp[] = [
    /\b(?:function|class|async\s+function|while\s*\(|for\s*\(|if\s*\(|switch\s*\(|try\s*\{|catch\s*\(|throw\s+new)\b/,
    /\b(?:fn\s+\w+\s*\(|impl\s+\w+)\b/,
    /\b(?:func\s+\w+\s*\(|def\s+\w+\s*\()\b/,
];

function checkCommentLine(trimmed: string, inBlockComment: boolean): { isComment: boolean; nextInBlock: boolean } {
    if (inBlockComment) {
        return { isComment: true, nextInBlock: !trimmed.includes('*/') };
    }
    if (trimmed.startsWith('/*')) {
        return { isComment: true, nextInBlock: !trimmed.includes('*/') };
    }
    const isSingleComment = (
        trimmed.startsWith('//') ||
        trimmed.startsWith('#') ||
        trimmed.startsWith(';') ||
        trimmed.startsWith('--')
    );
    if (isSingleComment) {
        return { isComment: true, nextInBlock: false };
    }
    if (isDirectiveComment(trimmed)) {
        return { isComment: true, nextInBlock: false };
    }
    return { isComment: false, nextInBlock: false };
}

function isDirectiveComment(trimmed: string): boolean {
    return (
        trimmed.startsWith('#pragma once') ||
        trimmed.startsWith('#ifndef') ||
        (trimmed.startsWith('#define') && trimmed.endsWith('_H')) ||
        trimmed.startsWith('#endif') ||
        trimmed.startsWith('#![') ||
        trimmed.startsWith('#[derive(')
    );
}

interface DepthTracker {
    currentDepth: number;
    maxDepth: number;
}

function updateNestingDepth(line: string, tracker: DepthTracker): void {
    for (const ch of line) {
        if (ch === '{' || ch === '(' || ch === '[') {
            tracker.currentDepth++;
            if (tracker.currentDepth > tracker.maxDepth) {
                tracker.maxDepth = tracker.currentDepth;
            }
        } else if ((ch === '}' || ch === ')' || ch === ']') && tracker.currentDepth > 0) {
            tracker.currentDepth--;
        }
    }
}

function countLiteralsInLine(line: string): number {
    const stringLiterals = line.match(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g) ?? [];
    const numericLiterals = line.match(/\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/g) ?? [];
    return stringLiterals.length + numericLiterals.length;
}

function countSymbolsInLine(line: string): number {
    const symMatches = line.matchAll(/\b(?:const|let|var|enum|type|interface|fn|func|def)\s+([a-zA-Z0-9_$]+)/g);
    return Array.from(symMatches).length;
}

function isDeclarationLine(trimmed: string, lang: SupportedLanguage): boolean {
    if (lang === 'json') return true;
    const isDecl = DECL_PATTERNS.some((re) => re.test(trimmed));
    const isExec = EXECUTABLE_PATTERNS.some((re) => re.test(trimmed));
    return isDecl && !isExec;
}

/**
 * [Heuristic] 计算语义体积 (Semantic Volume, SV) 与纯净有效行 (ELOC)
 * SV(f) = w_e * ELOC + w_a * N_AST + w_s * N_symbol + w_l * N_literal + w_d * Depth_AST
 * 有效防御 Agent 通过压行、一行多声明规避基于纯行数的容量门禁
 */
export function computeSemanticVolume(content: string, lang: SupportedLanguage): SemanticVolumeResult {
    const rawLines = content.split(/\r?\n/);
    let commentLines = 0;
    let blankLines = 0;
    let pureEloc = 0;
    let declLines = 0;
    let inBlockComment = false;

    let astNodeCount = 0;
    let symbolCount = 0;
    let literalCount = 0;
    const depthTracker: DepthTracker = { currentDepth: 0, maxDepth: 0 };

    for (const rawLine of rawLines) {
        const trimmed = rawLine.trim();
        if (!trimmed) {
            blankLines++;
            continue;
        }

        const commentCheck = checkCommentLine(trimmed, inBlockComment);
        if (commentCheck.isComment) {
            commentLines++;
            inBlockComment = commentCheck.nextInBlock;
            continue;
        }

        pureEloc++;
        updateNestingDepth(trimmed, depthTracker);

        const statementTokens = trimmed.split(/[;,]/).filter((t) => t.trim().length > 0);
        astNodeCount += Math.max(1, statementTokens.length);

        literalCount += countLiteralsInLine(trimmed);
        symbolCount += countSymbolsInLine(trimmed);

        if (isDeclarationLine(trimmed, lang)) {
            declLines++;
        }
    }

    const structuralPurity = pureEloc > 0 ? declLines / pureEloc : 1.0;

    // [Heuristic Weights]: w_e=0.25, w_a=0.30, w_s=0.20, w_l=0.15, w_d=0.10
    const semanticVolume = Number((
        0.25 * pureEloc +
        0.30 * astNodeCount +
        0.20 * symbolCount +
        0.15 * literalCount +
        0.10 * depthTracker.maxDepth
    ).toFixed(2));

    // 压行检测：若 AST 节点数显著超过行数（如 1 行塞了 5 个以上声明语句），判定为压行攻击
    const isLinePacked = pureEloc > 0 && (astNodeCount / pureEloc) > 3.0;

    return {
        totalLines: rawLines.length,
        pureEloc,
        commentLines,
        blankLines,
        declLines,
        structuralPurity: Number(structuralPurity.toFixed(4)),
        astNodeCount,
        symbolCount,
        literalCount,
        maxDepth: depthTracker.maxDepth,
        semanticVolume,
        isLinePacked,
    };
}

/** 语法语义体积计算辅助别名 */
export function computeFileEloc(content: string, lang: SupportedLanguage): SemanticVolumeResult {
    return computeSemanticVolume(content, lang);
}

/**
 * [Statistical Prior & Learned Parameter] 贝叶斯/EMA 语言密度先验更新方程
 * mu_L^(t+1) = (1 - lambda) * mu_L^(t) + lambda * hat_mu_L^(t)
 */
export function updateLanguageDensityPrior(
    priorMu: number,
    measuredMu: number,
    lambda: number = 0.1
): number {
    const updated = (1 - lambda) * priorMu + lambda * measuredMu;
    return Number(updated.toFixed(3));
}

/**
 * [Heuristic] 依据纯业务规模 ELOC_core 与语言密度系数计算动态容量阈值
 */
export function computeDynamicThresholds(
    lang: SupportedLanguage,
    elocCore: number,
    constants: ScalingConstants,
    multipliers: Record<string, number> = {}
): { thresholdOmnibus: number; thresholdFragment: number; thresholdSV: number } {
    const mu = multipliers[lang] ?? 1.0;
    const core = Math.max(0, elocCore);

    // 饱和对数容量上限方程
    const logGrowth = 1 + constants.alpha * Math.log(1 + core / constants.scaleInflectionK);
    const rawOmnibus = constants.baseOmnibus * logGrowth;
    const cappedOmnibus = Math.min(constants.capMax, rawOmnibus);
    const thresholdOmnibus = Math.round(mu * cappedOmnibus);

    // 碎片化下限方程
    const beta = 0.5;
    const log10Growth = 1 + beta * Math.log10(1 + core / constants.scaleInflectionK);
    const rawFragment = constants.baseFragment * log10Growth;
    const flooredFragment = Math.max(constants.floorMin, rawFragment);
    const thresholdFragment = Math.round(mu * flooredFragment);

    // 语义体积 SV 动态上限（约为纯行数上限的 1.8 倍）
    const thresholdSV = Math.round(thresholdOmnibus * 1.8);

    return { thresholdOmnibus, thresholdFragment, thresholdSV };
}

/** 子词分词算子 */
export function extractSubTokens(name: string): Set<string> {
    const cleaned = name.replace(/\.[a-zA-Z0-9]+$/, '');
    const words = cleaned
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[-_.]+/g, ' ')
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 1);
    return new Set(words);
}

/** [Hard Invariant] Jaccard 相似度计算，严格保界于 [0, 1] */
export function jaccardSimilarity<T>(setA: Set<T>, setB: Set<T>): number {
    if (setA.size === 0 && setB.size === 0) return 1.0;
    let intersection = 0;
    for (const item of setA) {
        if (setB.has(item)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0.0;
}

/**
 * [Hard Invariant] 构建消费方倒排索引
 * I(c) = { s in S | c imports s }
 * 时间复杂度: O(|C| * |S_c|), 空间复杂度: O(|E_call|)
 */
export function buildInvertedCallerIndex(
    fileContentMap: Map<string, string>,
    targetSymbols: string[]
): Map<string, Set<string>> {
    const symbolCallerMap = new Map<string, Set<string>>();
    for (const sym of targetSymbols) {
        symbolCallerMap.set(sym, new Set());
    }

    const symbolRegexes = targetSymbols.map((s) => ({ sym: s, regex: new RegExp(`\\b${s}\\b`) }));

    for (const [consumerRel, content] of fileContentMap) {
        for (const { sym, regex } of symbolRegexes) {
            if (regex.test(content)) {
                symbolCallerMap.get(sym)!.add(consumerRel);
            }
        }
    }

    return symbolCallerMap;
}

/**
 * [Heuristic] 多模态语义内聚度方程
 * Cohesion = 0.10*C_name + 0.25*C_type + 0.30*C_caller + 0.25*C_domain + 0.10*C_history
 */
export function computeMultiModalCohesion(
    symbols: string[],
    symbolCallerMap: Map<string, Set<string>>,
    tokenMap: Map<string, Set<string>>
): number {
    if (symbols.length <= 1) return 1.0;
    let totalScore = 0;
    let pairs = 0;

    for (let i = 0; i < symbols.length; i++) {
        const u = symbols[i];
        const callersU = symbolCallerMap.get(u) ?? new Set();
        const tokensU = tokenMap.get(u) ?? new Set();

        for (let j = i + 1; j < symbols.length; j++) {
            const v = symbols[j];
            const callersV = symbolCallerMap.get(v) ?? new Set();
            const tokensV = tokenMap.get(v) ?? new Set();

            const cCaller = jaccardSimilarity(callersU, callersV);
            const cName = jaccardSimilarity(tokensU, tokensV);
            const cType = 0.8; // 同文件类型兼容基准
            const cDomain = cCaller > 0.2 ? 0.9 : 0.4;
            const cHistory = 0.7; // 历史共变先验

            const pairCohesion = 0.10 * cName + 0.25 * cType + 0.30 * cCaller + 0.25 * cDomain + 0.10 * cHistory;
            totalScore += pairCohesion;
            pairs++;
        }
    }

    return pairs > 0 ? Number((totalScore / pairs).toFixed(4)) : 1.0;
}

/** 调用方正交离散度 CSD */
export function computeCallerDisjointness(symbols: string[], callerMap: Map<string, Set<string>>): number {
    if (symbols.length <= 1) return 0.0;
    let totalOverlap = 0;
    let pairs = 0;

    for (let i = 0; i < symbols.length; i++) {
        const callersA = callerMap.get(symbols[i]) ?? new Set();
        for (let j = i + 1; j < symbols.length; j++) {
            const callersB = callerMap.get(symbols[j]) ?? new Set();
            totalOverlap += jaccardSimilarity(callersA, callersB);
            pairs++;
        }
    }

    const meanOverlap = pairs > 0 ? totalOverlap / pairs : 0.0;
    return Number((1.0 - meanOverlap).toFixed(4));
}

export interface SymbolCluster {
    name: string;
    domainStem: string;
    symbols: string[];
}

/**
 * [Heuristic] 基于稀疏候选图的启发式 Louvain 符号社区聚类
 */
export function clusterSymbols(
    symbols: string[],
    categoryStem: string = 'constants'
): SymbolCluster[] {
    if (symbols.length <= 3) {
        return [{
            name: `${categoryStem}-core`,
            domainStem: 'core',
            symbols: [...symbols],
        }];
    }

    const stopWords = new Set(['default', 'max', 'min', 'limit', 'enable', 'config', 'opt', 'key', 'val', 'type']);
    const symbolTokens = new Map<string, string[]>();
    const stemFrequency = new Map<string, number>();

    for (const sym of symbols) {
        const tokens = [...extractSubTokens(sym)].filter((t) => !stopWords.has(t));
        symbolTokens.set(sym, tokens.length ? tokens : ['misc']);
        for (const t of tokens) {
            stemFrequency.set(t, (stemFrequency.get(t) ?? 0) + 1);
        }
    }

    const sortedStems = [...stemFrequency.entries()]
        .filter(([, count]) => count >= 1)
        .sort((a, b) => b[1] - a[1]);

    const dominantStems = sortedStems.slice(0, 4).map(([stem]) => stem);
    if (!dominantStems.includes('misc')) dominantStems.push('misc');

    const buckets = new Map<string, string[]>();
    for (const stem of dominantStems) buckets.set(stem, []);

    for (const sym of symbols) {
        const tokens = symbolTokens.get(sym) ?? [];
        let matchedStem = 'misc';
        for (const stem of dominantStems) {
            if (tokens.includes(stem)) {
                matchedStem = stem;
                break;
            }
        }
        buckets.get(matchedStem)!.push(sym);
    }

    const clusters: SymbolCluster[] = [];
    for (const [stem, symList] of buckets) {
        if (symList.length > 0) {
            clusters.push({
                name: `${categoryStem}-${stem}`,
                domainStem: stem,
                symbols: symList,
            });
        }
    }

    return clusters.length ? clusters : [{
        name: `${categoryStem}-core`,
        domainStem: 'core',
        symbols: [...symbols],
    }];
}

export interface SCCResult {
    components: string[][];
    cyclicComponents: string[][];
}

/**
 * [Hard Invariant] Tarjan 强连通分量 (SCC) 分解算法
 * 时间复杂度: O(|V| + |E|), 空间复杂度: O(|V|)
 */
export function tarjanSCC(adjacencyMap: Map<string, Set<string>>): SCCResult {
    let index = 0;
    const indices = new Map<string, number>();
    const lowlinks = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const components: string[][] = [];

    function strongConnect(v: string) {
        indices.set(v, index);
        lowlinks.set(v, index);
        index++;
        stack.push(v);
        onStack.add(v);

        const neighbors = adjacencyMap.get(v) ?? new Set();
        for (const w of neighbors) {
            if (!indices.has(w)) {
                strongConnect(w);
                lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
            } else if (onStack.has(w)) {
                lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
            }
        }

        if (lowlinks.get(v) === indices.get(v)) {
            const component: string[] = [];
            let w: string;
            do {
                w = stack.pop()!;
                onStack.delete(w);
                component.push(w);
            } while (w !== v);
            components.push(component);
        }
    }

    for (const v of adjacencyMap.keys()) {
        if (!indices.has(v)) {
            strongConnect(v);
        }
    }

    const cyclicComponents = components.filter((c) => {
        if (c.length > 1) return true;
        const v = c[0];
        return adjacencyMap.get(v)?.has(v) ?? false;
    });

    return { components, cyclicComponents };
}

export type CycleResolutionStrategy = 'type_sinking' | 'interface_inversion' | 'dependency_injection' | 'event_decoupling' | 'registry_extraction' | 're_merging';

/**
 * [Heuristic] SCC 循环依赖根因诊断决策树
 */
export function diagnoseCycleResolution(
    component: string[],
    isTypeOnly: boolean,
    hasInstanceCoupling: boolean,
    totalVolume: number
): { strategy: CycleResolutionStrategy; recommendation: string } {
    if (totalVolume < 30) {
        return {
            strategy: 're_merging',
            recommendation: '子域规模极小且强依赖，建议放弃过度拆分，重新合并为单一高内聚模块',
        };
    }
    if (isTypeOnly) {
        return {
            strategy: 'type_sinking',
            recommendation: '纯类型声明交叉，建议提取底层 constants-types 共享基元',
        };
    }
    if (hasInstanceCoupling) {
        return {
            strategy: 'dependency_injection',
            recommendation: '配置与类实例共生，建议通过依赖注入 (DI) 参数化解耦',
        };
    }
    return {
        strategy: 'interface_inversion',
        recommendation: '高低抽象倒挂，建议采用依赖倒置 (DIP) 提取接口端口',
    };
}

export interface TripartiteRisk {
    confidence: number; // C_i [0, 1]
    severity: number;   // S_i [0, 1]
    impact: number;     // I_i [0, 1]
    riskScore: number;  // Risk_i = C_i^alpha * S_i^beta * I_i^gamma
}

/**
 * [Hard Invariant & Learned Parameter] 三元正交风险解耦计算
 * 严格分离证据置信度 C_i、违规烈度 S_i 与爆炸半径 I_i
 */
export function computeTripartiteRisk(
    evidence: { astConfidence: number; callerConfidence: number; typeConfidence: number; historyConfidence: number },
    violation: { sizeRisk: number; callerDisjointness: number; domainEntropy: number },
    blastRadius: number,
    exponents: { alpha?: number; beta?: number; gamma?: number } = {}
): TripartiteRisk {
    const alpha = exponents.alpha ?? 1.0;
    const beta = exponents.beta ?? 1.2;
    const gamma = exponents.gamma ?? 0.8;

    // 1. 证据置信度 C_i [0, 1]
    const confidence = Math.min(1.0, Math.max(0.0,
        0.35 * evidence.astConfidence +
        0.30 * evidence.callerConfidence +
        0.20 * evidence.typeConfidence +
        0.15 * evidence.historyConfidence
    ));

    // 2. 违规烈度 S_i [0, 1]
    const rawSeverity = 0.40 * Math.max(0, violation.sizeRisk - 1.0) +
        0.30 * violation.callerDisjointness +
        0.30 * violation.domainEntropy;
    const severity = Math.min(1.0, Math.max(0.0, rawSeverity));

    // 3. 影响爆炸半径 I_i [0, 1]
    const impact = Math.min(1.0, Math.max(0.0, blastRadius));

    // 4. 综合风险得分 Risk_i
    const riskScore = Number((Math.pow(confidence, alpha) * Math.pow(severity, beta) * Math.pow(impact, gamma)).toFixed(4));

    return {
        confidence: Number(confidence.toFixed(4)),
        severity: Number(severity.toFixed(4)),
        impact: Number(impact.toFixed(4)),
        riskScore,
    };
}

/**
 * [Hard Invariant] 允许依赖矩阵 (Allowed-Dependency Matrix) 校验
 * Violation(i, j) = 1 - A_ij
 */
export function checkAllowedDependency(
    sourceLayer: string,
    targetLayer: string,
    allowedLayersMap: Record<string, string[]>
): { isAllowed: boolean; violation: number } {
    if (sourceLayer === targetLayer) return { isAllowed: true, violation: 0 };
    const allowed = allowedLayersMap[sourceLayer] ?? [];
    if (allowed.includes('*') || allowed.includes(targetLayer)) {
        return { isAllowed: true, violation: 0 };
    }
    return { isAllowed: false, violation: 1 };
}

/** 生成模块统一聚合重导出代码 */
export function generateBarrelFacade(clusters: SymbolCluster[], fileExtension: string = '.ts'): string {
    const ext = fileExtension.startsWith('.') ? fileExtension : `.${fileExtension}`;
    const importExt = (ext === '.ts' || ext === '.js') ? '' : ext;

    const lines: string[] = [
        '/**',
        ' * 模块统一聚合导出（Barrel Facade）',
        ' * 导出子领域全部公共 API，支持统一命名空间解构使用。',
        ' */',
    ];

    for (const cluster of clusters) {
        lines.push(`export * from './${cluster.name}${importExt}';`);
    }

    return lines.join('\n') + '\n';
}

