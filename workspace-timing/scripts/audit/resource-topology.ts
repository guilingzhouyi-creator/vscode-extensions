// @wt-script audit/resource-topology
// @purpose L3 结构化资源命名拓扑与智能拆分审查：认识论四分类/语义体积SV抗压行/倒排索引稀疏图/三元风险/Tarjan SCC
// @origin native
// @usage node dist/audit/resource-topology.js [--json] [--strict] [--root <dir>]
// @exit 0=PASS 1=存在 error/warning 阻断 2=配置错误

import path from 'node:path';
import { parseArgs, helpFromHeader } from '../common/cli.js';
import { ROOT, SCRIPTS_DIR } from '../common/paths.js';
import { loadJson, ReviewRules, ScalingConstants } from '../common/config.js';
import { collectFiles, readFileSafe } from '../common/scan.js';
import { finding, envelope, printEnvelope, STATUS, verdict, Finding } from '../common/result.js';
import {
    detectLanguage,
    computeSemanticVolume,
    computeDynamicThresholds,
    buildInvertedCallerIndex,
    computeMultiModalCohesion,
    computeCallerDisjointness,
    clusterSymbols,
    generateBarrelFacade,
    extractSubTokens,
    computeTripartiteRisk,
} from '../common/resource-math.js';

const args = parseArgs(process.argv.slice(2));
if (args.help) {
    await helpFromHeader(import.meta.url);
    process.exit(0);
}
const root = args.root ? path.resolve(args.root) : ROOT;
const started = Date.now();

const rulesRes = await loadJson<ReviewRules>(path.join(SCRIPTS_DIR, 'config', 'review-rules.json'));
if (!rulesRes.ok) {
    printEnvelope(envelope({
        checker: 'L3-RESOURCE-TOPO',
        status: STATUS.CONFIG_ERROR,
        durationMs: Date.now() - started,
        notes: [rulesRes.error],
    }));
    process.exit(2);
}

const topoCfg = rulesRes.data.resourceTopology ?? {};
if (topoCfg.enabled === false) {
    printEnvelope(envelope({
        checker: 'L3-RESOURCE-TOPO',
        status: STATUS.SKIP,
        durationMs: Date.now() - started,
        notes: ['resourceTopology disabled in review-rules.json'],
    }));
    process.exit(0);
}

const defaultScaling: ScalingConstants = {
    baseOmnibus: 350,
    alpha: 0.85,
    scaleInflectionK: 5000,
    capMax: 2000,
    baseFragment: 25,
    floorMin: 20,
    maxNamingDepth: 3,
    maxWordsInName: 4,
    minStructuralPurity: 0.85,
};

const scaling: ScalingConstants = {
    ...defaultScaling,
    ...(topoCfg.scalingConstants ?? {}),
};

const multipliers: Record<string, number> = topoCfg.languageMultipliers ?? {
    typescript: 1.0,
    javascript: 1.0,
    rust: 2.0,
    cpp: 2.5,
    c: 2.5,
    go: 1.6,
    gdscript: 0.9,
    python: 0.85,
};

const findings: Finding[] = [];
const push = (
    ruleId: string,
    severity: 'error' | 'warning',
    message: string,
    file: string,
    line: number | null = null,
    suggestedFix: string | null = null,
    evidence: string | null = null
): void => {
    findings.push(finding({
        ruleId,
        severity,
        file,
        line,
        message,
        evidence,
        suggestedFix,
        source: 'internal-checker',
    }));
};

// 1. 全量扫描工作区源文件
const allSourceFiles = await collectFiles({
    root,
    include: ['src/**/*.ts', 'src/**/*.js', 'src/**/*.rs', 'src/**/*.cpp', 'src/**/*.gd', 'src/**/*.py'],
    exclude: ['out/**', 'dist/**', 'node_modules/**', '.git/**'],
});

// 2. 识别全仓结构化资源文件集合 R_t，并计算纯业务规模 ELOC_core^(t) [快照条件不变性]
const resourceFileSet = new Set<string>();
const fileElocMap = new Map<string, number>();
const fileContentMap = new Map<string, string>();
const fileSvMap = new Map<string, import('../common/resource-math.js').SemanticVolumeResult>();

for (const rel of allSourceFiles) {
    const raw = await readFileSafe(path.join(root, rel));
    if (raw === null) continue;
    fileContentMap.set(rel, raw);
    const lang = detectLanguage(rel);
    const svRes = computeSemanticVolume(raw, lang);
    fileElocMap.set(rel, svRes.pureEloc);
    fileSvMap.set(rel, svRes);

    const baseName = path.basename(rel, path.extname(rel));
    const isResourceDir = /(?:^|\/)(?:config|constants|i18n|messages|strings|rules)(?:\/|$)/i.test(rel);
    const isResourcePrefix = /^(?:constants?|configs?|rules?|strings?|errors?|enums?|i18n)(?:[-_.]|$)/i.test(baseName);
    const isCamelResource = /^[a-z]+(?:[A-Z][a-z0-9]+)*(?:Constants|Config|Strings|Rules|Errors|Enums)$/.test(baseName);
    const isLoader = baseName.toLowerCase() === 'index' || baseName.toLowerCase() === 'loader';
    const isHighPurity = svRes.structuralPurity >= 0.85 && svRes.pureEloc >= 10 && !/\bclass\s+\w+/.test(raw);

    if ((isResourceDir && !isLoader) || isResourcePrefix || isCamelResource || isHighPurity) {
        resourceFileSet.add(rel);
    }
}

// 核心快照条件不变性：ELOC_core 严格扣除当前快照冻结的资源文件集合 R_t
let elocCore = 0;
for (const rel of allSourceFiles) {
    if (!resourceFileSet.has(rel)) {
        elocCore += fileElocMap.get(rel) ?? 0;
    }
}
elocCore = Math.max(50, elocCore);

// 3. 构建导出符号与倒排调用索引 [O(|E_s|) 复杂度优化]
const exportSymbolMap = new Map<string, string[]>();
const allTargetSymbols: string[] = [];

const EXPORT_SYMBOL_RE = /export\s+(?:const|let|var|enum|type|interface|function|class)\s+([a-zA-Z0-9_$]+)/g;

for (const rel of resourceFileSet) {
    const content = fileContentMap.get(rel) ?? '';
    const symbols: string[] = [];
    for (const match of content.matchAll(EXPORT_SYMBOL_RE)) {
        symbols.push(match[1]);
        allTargetSymbols.push(match[1]);
    }
    if (symbols.length > 0) {
        exportSymbolMap.set(rel, symbols);
    }
}

// 基于倒排索引构建稀疏调用图
const symbolCallerMap = buildInvertedCallerIndex(fileContentMap, allTargetSymbols);

// 4. 逐个审查结构化资源文件
for (const rel of resourceFileSet) {
    const raw = fileContentMap.get(rel) ?? '';
    const lang = detectLanguage(rel);
    const svRes = fileSvMap.get(rel) ?? computeSemanticVolume(raw, lang);
    const baseName = path.basename(rel, path.extname(rel));
    const ext = path.extname(rel);

    // 4.1 维度 D1 声明纯度校验（名实相符度）
    if (svRes.pureEloc >= 30 && svRes.structuralPurity < scaling.minStructuralPurity) {
        push(
            'RES-TOPO-RESP-MISMATCH',
            'error',
            `资源文件 "${baseName}" 声明结构纯度仅为 ${(svRes.structuralPurity * 100).toFixed(1)}%（低于 ${scaling.minStructuralPurity * 100}%），混入了大量普通业务逻辑或组件实现`,
            rel,
            1,
            '将可执行业务函数、状态管理与组件渲染抽离至 application/presentation 层，保持资源文件纯净性',
            `有效ELOC=${svRes.pureEloc}, 声明行=${svRes.declLines}, 纯度=${svRes.structuralPurity}`
        );
    }

    // 4.2 命名拓扑层级分词与过度描述校验
    const nameSegments = baseName.split(/[-_]/).filter(Boolean);
    const rawTokens = [...extractSubTokens(baseName)];

    if (nameSegments.length >= 4) {
        push(
            'RES-TOPO-NAMING-DEPTH',
            'error',
            `文件命名层级深度为 ${nameSegments.length}（超出三级上限 Category-Domain-Subdomain）: "${baseName}"`,
            rel,
            1,
            '收敛命名层级至 2~3 层（例如 constants-domain-subdomain），避免无限堆叠路径语义',
            `分段=${JSON.stringify(nameSegments)}`
        );
    }

    if (rawTokens.length > scaling.maxWordsInName) {
        push(
            'RES-TOPO-OVER-DESCRIPTIVE',
            'warning',
            `文件名包含 ${rawTokens.length} 个单词，存在过度描述与信息堆叠异味: "${baseName}"`,
            rel,
            1,
            '精简文件名为核心概念词（不超过 4 个有效单词），具体职责由内部导出符号表达',
            `单词清单=${JSON.stringify(rawTokens)}`
        );
    }

    // 4.3 动态容量与语义体积 (SV) 对抗压行校验
    const { thresholdOmnibus, thresholdFragment, thresholdSV } = computeDynamicThresholds(
        lang,
        elocCore,
        scaling,
        multipliers
    );

    const exportedSymbols = exportSymbolMap.get(rel) ?? [];
    const isSingleTier = nameSegments.length <= 1 || baseName.toLowerCase() === 'constants' || baseName.toLowerCase() === 'config';
    const isThreeTier = nameSegments.length >= 3;

    // 大杂烩异常检查 (RES-TOPO-OVER-GENERIC)
    // 综合判定：纯行数溢出 OR 语义体积溢出 (防压行攻击)
    const isSizeOverflow = svRes.pureEloc > thresholdOmnibus || svRes.semanticVolume > thresholdSV || svRes.isLinePacked;

    if (isSingleTier && isSizeOverflow) {
        const tokenMap = new Map<string, Set<string>>();
        for (const s of exportedSymbols) tokenMap.set(s, extractSubTokens(s));

        const cohesion = computeMultiModalCohesion(exportedSymbols, symbolCallerMap, tokenMap);
        const disjointness = computeCallerDisjointness(exportedSymbols, symbolCallerMap);
        const clusters = clusterSymbols(exportedSymbols, baseName);
        const facadeCode = generateBarrelFacade(clusters, ext);

        // 计算三元正交风险
        const callersTotal = new Set<string>();
        for (const s of exportedSymbols) {
            for (const c of symbolCallerMap.get(s) ?? []) callersTotal.add(c);
        }
        const blastRadius = allSourceFiles.length > 0 ? callersTotal.size / allSourceFiles.length : 0;
        const tripartiteRisk = computeTripartiteRisk(
            { astConfidence: 1.0, callerConfidence: 0.95, typeConfidence: 0.9, historyConfidence: 0.8 },
            { sizeRisk: svRes.semanticVolume / thresholdSV, callerDisjointness: disjointness, domainEntropy: 0.7 },
            blastRadius
        );

        push(
            'RES-TOPO-OVER-GENERIC',
            'warning',
            `结构化资源文件 "${baseName}" 纯净行数 ${svRes.pureEloc} (SV=${svRes.semanticVolume}) 超出动态上限 ${thresholdOmnibus} (SV上限=${thresholdSV}, ELOC_core=${elocCore}, μ=${multipliers[lang] ?? 1.0})，且调用方离散度 CSD=${disjointness}，三元风险分=${tripartiteRisk.riskScore}`,
            rel,
            1,
            `按领域职责拆分为高内聚子文件（如 ${clusters.map((c) => c.name + ext).join(', ')}），并将原文件保留为重导出门面：\n${facadeCode}`,
            `ELOC=${svRes.pureEloc}, SV=${svRes.semanticVolume}, 动态上限=${thresholdOmnibus}, CSD=${disjointness}, Cohesion=${cohesion}, Packed=${svRes.isLinePacked}`
        );
    }

    // 过度碎片化异常检查 (RES-TOPO-OVER-SPECIALIZED)
    if (isThreeTier && svRes.pureEloc < thresholdFragment && svRes.pureEloc > 0) {
        const parentDomain = `${nameSegments[0]}-${nameSegments[1]}${ext}`;
        push(
            'RES-TOPO-OVER-SPECIALIZED',
            'warning',
            `三级细分资源文件 "${baseName}" 纯净行数仅为 ${svRes.pureEloc} (SV=${svRes.semanticVolume})，低于当前项目动态下限 ${thresholdFragment} 行，造成目录与命名过度碎片化`,
            rel,
            1,
            `将内部少量符号合并回父级功能域文件 "${parentDomain}" 并删除过度特化的细分子文件`,
            `ELOC=${svRes.pureEloc}, SV=${svRes.semanticVolume}, 动态下限=${thresholdFragment}`
        );
    }
}

// 5. 组装信封并输出
const status = verdict(findings, { blockOn: args.flags.strict ? 'warning' : 'error' });
printEnvelope(envelope({
    checker: 'L3-RESOURCE-TOPO',
    status,
    findings,
    filesScanned: resourceFileSet.size,
    durationMs: Date.now() - started,
    notes: [
        `全仓纯业务基线: ELOC_core=${elocCore}`,
        `识别结构化资源文件: ${resourceFileSet.size} 个`,
        `动态容量基准 (TS): Omnibus=${computeDynamicThresholds('typescript', elocCore, scaling, multipliers).thresholdOmnibus}行 (SV=${computeDynamicThresholds('typescript', elocCore, scaling, multipliers).thresholdSV}), Fragment=${computeDynamicThresholds('typescript', elocCore, scaling, multipliers).thresholdFragment}行`,
        `抗压行 (Semantic Volume) 与倒排索引稀疏图机制已生效`,
    ],
}));

process.exit(status === STATUS.PASS ? 0 : 1);

