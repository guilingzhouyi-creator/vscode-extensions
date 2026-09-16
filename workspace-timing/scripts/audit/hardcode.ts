// @wt-script audit/hardcode
// @purpose L3 硬编码专项：绝对路径/宿主UI串/密钥/魔法值——并按"结构性常量/配置项/UI串/环境"分类判定，不做一刀切
// @origin native（分类判定思想参考 WebGames audit_hardcode：提示级+豁免清单）
// @usage node dist/audit/hardcode.js [--json] [--strict] [--root <dir>]
// @exit 0=PASS 1=存在 error 级违规（--strict 时 warning 也阻断） 2=配置错误

import path from 'node:path';
import { parseArgs, helpFromHeader } from '../common/cli.js';
import { createLogger } from '../common/logger.js';
import { ROOT, SCRIPTS_DIR } from '../common/paths.js';
import { loadJson, ReviewRules } from '../common/config.js';
import { collectFiles, readFileSafe, stripComments } from '../common/scan.js';
import { finding, envelope, printEnvelope, STATUS, verdict, Finding } from '../common/result.js';

const args = parseArgs(process.argv.slice(2));
if (args.help) { await helpFromHeader(import.meta.url); process.exit(0); }
const log = createLogger({ quiet: args.json });
const root = args.root ? path.resolve(args.root) : ROOT;
const started = Date.now();

const rulesRes = await loadJson<ReviewRules>(path.join(SCRIPTS_DIR, 'config', 'review-rules.json'));
if (!rulesRes.ok) {
    printEnvelope(envelope({ checker: 'L3-HARDCODE', status: STATUS.CONFIG_ERROR, durationMs: Date.now() - started, notes: [rulesRes.error] }));
    process.exit(2);
}
const hc = rulesRes.data.hardcode ?? {};

const findings: Finding[] = [];
const files = await collectFiles({ root, include: ['src/**/*.ts'] });

const SECRET_RES = (hc.secretPatterns ?? []).map((p) => new RegExp(p));
const MAGIC_EXEMPT = hc.magicNumber?.exemptPaths ?? [];
const MAGIC_EXEMPT_VALUES = new Set(hc.magicNumber?.exemptValues ?? [0, 1, 2, -1]);
const UI_SCAN = hc.uiString?.scanPaths ?? ['src/presentation/'];
const UI_EXEMPT = hc.uiString?.exemptPaths ?? [];

function isExempt(rel: string, prefixes: string[]): boolean {
    return prefixes.some((p) => rel.startsWith(p) || rel === p);
}

for (const file of files) {
    const raw = await readFileSafe(path.join(root, file));
    if (raw === null) continue;
    const text = stripComments(raw);
    const lines = text.split('\n');

    lines.forEach((lineText: string, idx: number) => {
        const lineNo = idx + 1;
        const push = (ruleId: string, severity: 'error' | 'warning', message: string, suggestedFix: string | null = null): void => {
            findings.push(finding({
                ruleId, severity, file, line: lineNo,
                message, evidence: lineText.trim().slice(0, 160), suggestedFix,
            }));
        };

        // 1. 绝对路径 / file:// 盘符路径（总纲禁止项，error）
        if (/(?:[A-Za-z]:[\\/]|file:\/\/)/.test(lineText) && !/https?:\/\//.test(lineText)) {
            push('HC-ABS-PATH', 'error', '疑似硬编码本机绝对路径 / file:// 路径', '改用相对路径 + 路径解析模块；确属正则示例时改写为不含盘符的形式');
        }

        // 2. 密钥/凭证特征（error）
        for (const re of SECRET_RES) {
            if (re.test(lineText)) {
                push('HC-SECRET', 'error', `疑似密钥/凭证泄露特征（规则片段: ${re.source.slice(0, 30)}）`, '立即移出源码，改经环境变量或宿主密钥存储注入');
                break;
            }
        }

        // 3. 宿主 UI 调用携带字符串字面量（presentation 层，error —— 必须经 i18n）
        if (isExempt(file, UI_SCAN) && !isExempt(file, UI_EXEMPT)) {
            const uiCall = lineText.match(/show(?:Information|Warning|Error)Message\(\s*(['"`])(?:(?!\1).)*\1/);
            if (uiCall) {
                push('HC-UI-STRING', 'error', '宿主消息 API 直接使用字符串字面量，绕过 i18n', "改用 t()['key'] + format() 模板");
            }
            const cjk = lineText.match(/['"`][^'"`]*[\u4e00-\u9fff]+[^'"`]*['"`]/);
            if (cjk) {
                push('HC-CJK-LITERAL', 'warning', 'presentation 层出现内联中文字面量（应经 i18n 词条）', '迁移到 src/i18n/zh-CN.ts 与 en.ts 双语词条');
            }
        }

        // 4. 魔法数值（warning 提示级，分类豁免：常量家园/模板/测试/基元值）
        if (!isExempt(file, MAGIC_EXEMPT)) {
            for (const m of lineText.matchAll(/(?<![\w.])(\d{2,})(?![\w.]|\s*(?:px|em|rem|%))/g)) {
                const val = Number(m[1]);
                if (MAGIC_EXEMPT_VALUES.has(val)) continue;
                push('HC-MAGIC-NUM', 'warning',
                    `魔法数值 ${m[1]}：请判定其归属（结构性常量→domain/models.ts；可调阈值→TimingConfig；临时值→命名局部常量）`,
                    '迁移至 src/domain/models.ts 常量并语义命名（如 MS_PER_X / DEFAULT_Y）');
                break; // 每行至多报一条，避免刷屏
            }
        }
    });
}

const blockOn = args.strict ? 'warning' : 'error';
const status = verdict(findings, { blockOn });
log.info(`硬编码审查: ${files.length} 文件, 发现 ${findings.length} 条（gate=${blockOn}）`);

printEnvelope(envelope({
    checker: 'L3-HARDCODE',
    status,
    findings,
    filesScanned: files.length,
    durationMs: Date.now() - started,
    notes: [`gate=${blockOn}`, 'HC-MAGIC-NUM 为提示级：要求人工归类，不是一刀切禁止'],
}));
process.exit(status === STATUS.PASS ? 0 : 1);
