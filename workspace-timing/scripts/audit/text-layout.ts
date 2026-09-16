// @wt-script audit/text-layout
// @purpose L3 文档文本布局门禁：CHANGELOG keep-a-changelog 结构/版本同步/列表风格 + README 必需节与路线图版本同步
// @origin native
// @usage node dist/audit/text-layout.js [--json] [--root <dir>]
// @exit 0=PASS 1=存在阻断级布局违规 2=配置错误

import path from 'node:path';
import { parseArgs, helpFromHeader } from '../common/cli.js';
import { createLogger } from '../common/logger.js';
import { ROOT, SCRIPTS_DIR } from '../common/paths.js';
import { loadJson, ReviewRules } from '../common/config.js';
import { readFileSafe } from '../common/scan.js';
import { finding, envelope, printEnvelope, STATUS, verdict, Finding } from '../common/result.js';

const args = parseArgs(process.argv.slice(2));
if (args.help) { await helpFromHeader(import.meta.url); process.exit(0); }
const log = createLogger({ quiet: args.json });
const root = args.root ? path.resolve(args.root) : ROOT;
const started = Date.now();

const rulesRes = await loadJson<ReviewRules>(path.join(SCRIPTS_DIR, 'config', 'review-rules.json'));
if (!rulesRes.ok) {
    printEnvelope(envelope({ checker: 'L3-DOC-LAYOUT', status: STATUS.CONFIG_ERROR, durationMs: Date.now() - started, notes: [rulesRes.error] }));
    process.exit(2);
}

const findings: Finding[] = [];

// ─────────────────────────────────────────────
// 一、CHANGELOG.md —— keep-a-changelog 布局契约
// ─────────────────────────────────────────────
const CL_NOTES: string[] = [];
const clText = await readFileSafe(path.join(root, 'CHANGELOG.md'));
if (clText === null) {
    CL_NOTES.push('CHANGELOG.md 不存在于扫描根 —— DOC-CL 规则本轮跳过（显式声明，非静默 PASS）');
} else {
    const clLines = clText.split(/\r?\n/);

    // DOC-CL-001：keep-a-changelog 契约 —— 必须存在 Unreleased 累积节
    if (!clLines.some((l) => /^## \[Unreleased\]/.test(l))) {
        findings.push(finding({
            ruleId: 'DOC-CL-001', severity: 'error', module: 'docs', file: 'CHANGELOG.md',
            message: '缺少 ## [Unreleased] 累积节（改动无处登记 → 下次发布必然漏记）',
            suggestedFix: '在文件头部恢复 ## [Unreleased] 节',
        }));
    }

    // DOC-CL-002：版本头格式 `## [X.Y.Z] — YYYY-MM-DD` 且按版本降序
    const VER_RE = /^## \[(\d+)\.(\d+)\.(\d+)\] — (\d{4}-\d{2}-\d{2})\s*$/;
    const versions: Array<{ ver: string; date: string; line: number }> = [];
    clLines.forEach((l, idx) => {
        if (!l.startsWith('## [') || l.startsWith('## [Unreleased]')) return;
        const m = l.match(VER_RE);
        if (!m) {
            findings.push(finding({
                ruleId: 'DOC-CL-002', severity: 'error', module: 'docs', file: 'CHANGELOG.md', line: idx + 1,
                message: `版本头格式不合规（应为 \`## [X.Y.Z] — YYYY-MM-DD\`）: ${l.trim()}`,
                evidence: l,
            }));
            return;
        }
        versions.push({ ver: `${m[1]}.${m[2]}.${m[3]}`, date: m[4], line: idx + 1 });
    });
    const verNum = (v: string): number => v.split('.').reduce((acc, n) => acc * 1000 + Number(n), 0);
    for (let i = 1; i < versions.length; i++) {
        if (verNum(versions[i].ver) >= verNum(versions[i - 1].ver)) {
            findings.push(finding({
                ruleId: 'DOC-CL-002', severity: 'error', module: 'docs', file: 'CHANGELOG.md',
                message: `版本节未按新→旧降序: ${versions[i - 1].ver} → ${versions[i].ver}`,
                suggestedFix: '降序排列版本节（最新在最上）',
            }));
            break;
        }
    }

    // DOC-CL-003：最新版本节与 package.json 版本同步（"打包了却没写日志"的机器化）
    const pkgRes = await loadJson<{ version?: string }>(path.join(root, 'package.json'));
    const pkgVersion = pkgRes.ok ? pkgRes.data?.version : undefined;
    if (pkgVersion && versions.length > 0 && versions[0].ver !== pkgVersion) {
        findings.push(finding({
            ruleId: 'DOC-CL-003', severity: 'error', module: 'docs', file: 'CHANGELOG.md',
            message: `package.json 版本 ${pkgVersion} 与变更日志最新节 ${versions[0].ver} 不同步（打包发版未写日志）`,
            suggestedFix: '为当前版本补写变更日志节后再打包',
        }));
    }

    // DOC-CL-004：分类标题标准化 —— 标准英文 token + 任意中文括注（布局统一，措辞自由）
    const STANDARD_TOKENS = [
        'Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Refactoring',
        'Performance & Optimization', 'Security', 'Tests', 'Engineering Infrastructure', 'Docs', '⚠️ Breaking',
    ];
    const SECTION_RE = new RegExp(`^### (${STANDARD_TOKENS.join('|')})(（|\\s|$)`);
    clLines.forEach((l, idx) => {
        if (!l.startsWith('### ')) return;
        if (!SECTION_RE.test(l)) {
            findings.push(finding({
                ruleId: 'DOC-CL-004', severity: 'warning', module: 'docs', file: 'CHANGELOG.md', line: idx + 1,
                message: `分类标题偏离标准表: ${l.trim()}`,
                evidence: l,
                suggestedFix: `改用标准分类之一：${STANDARD_TOKENS.join(' / ')}`,
            }));
        }
    });

    // DOC-CL-005：版本节列表项风格 —— 一律粗体导语（`- **`），杜绝无重点长条目
    clLines.forEach((l, idx) => {
        if (!/^- /.test(l)) return;
        if (/^- \*\*/.test(l)) return;
        findings.push(finding({
            ruleId: 'DOC-CL-005', severity: 'error', module: 'docs', file: 'CHANGELOG.md', line: idx + 1,
            message: '变更列表项缺少粗体导语（版面与历史条目风格断裂）',
            evidence: l.trim().slice(0, 80),
            suggestedFix: '首句以 **粗体短语** 概括，再接详述',
        }));
    });

    // DOC-CL-006：版本日期合法且不超前（防手滑写成未来日期）。
    // ★ 日期合法性用本地时区分量校验——经 toISOString 回转会在 UTC+8 把本地零点判成前一天
    //   （本扩展 0.4.0 修过的同类时区错误，检查器自己也不能犯）。
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const v of versions) {
        const m = v.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const dt = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
        const real = m && dt !== null
            && dt.getFullYear() === Number(m[1]) && dt.getMonth() === Number(m[2]) - 1 && dt.getDate() === Number(m[3]);
        if (!m || !real) {
            findings.push(finding({
                ruleId: 'DOC-CL-006', severity: 'error', module: 'docs', file: 'CHANGELOG.md', line: v.line,
                message: `版本日期非法: ${v.date}`,
            }));
        } else if (v.date > todayStr) {
            findings.push(finding({
                ruleId: 'DOC-CL-006', severity: 'error', module: 'docs', file: 'CHANGELOG.md', line: v.line,
                message: `版本日期超前于今日（${v.date} > ${todayStr}）`,
            }));
        }
    }
    CL_NOTES.push(`CHANGELOG 布局契约: 版本节 ${versions.length} 个，列表风格与日期校验完成`);
}

// ─────────────────────────────────────────────
// 二、README.md —— 必需节与路线图版本同步
// ─────────────────────────────────────────────
const RD_NOTES: string[] = [];
const rdText = await readFileSafe(path.join(root, 'README.md'));
if (rdText === null) {
    RD_NOTES.push('README.md 不存在于扫描根 —— DOC-RD 规则本轮跳过（显式声明，非静默 PASS）');
} else {
    const rdLines = rdText.split(/\r?\n/);

    // DOC-RD-001：必需节存在（双语标头按实际锚点匹配）
    const REQUIRED_SECTIONS: Array<{ anchor: string; label: string }> = [
        { anchor: '# Workspace Timing', label: 'H1 标题' },
        { anchor: '## ✨ 功能亮点', label: '功能亮点' },
        { anchor: '## 💻 命令清单', label: '命令清单' },
        { anchor: '## 🗄️ 存储架构', label: '存储架构' },
        { anchor: '## ⚙️ 扩展设置', label: '扩展设置' },
        { anchor: '## 🗺️ 路线图', label: '路线图' },
        { anchor: '## 📄 许可证', label: '许可证' },
    ];
    for (const { anchor, label } of REQUIRED_SECTIONS) {
        if (!rdLines.some((l) => l.startsWith(anchor))) {
            findings.push(finding({
                ruleId: 'DOC-RD-001', severity: 'error', module: 'docs', file: 'README.md',
                message: `README 缺少必需节: ${label}（锚点 \`${anchor}\`）`,
            }));
        }
    }

    // DOC-RD-002：package.json 版本必须在路线图行中登记，且不得仍标 🚧 规划中
    // （路线图顶行允许存在 🚧 的未来版本——那是规划项，不与当前发布版本硬比）
    const pkgRes = await loadJson<{ version?: string }>(path.join(root, 'package.json'));
    const pkgVersion = pkgRes.ok ? pkgRes.data?.version : undefined;
    if (pkgVersion) {
        const roadmapRows = rdLines
            .map((l, idx) => ({ l, idx }))
            .filter(({ l }) => /^\|\s*\*\*v\d+\.\d+\.\d+\*\*/.test(l))
            .map(({ l, idx }) => ({ ver: (l.match(/v(\d+\.\d+\.\d+)/) ?? [])[1] ?? '', line: idx + 1, raw: l }));
        if (roadmapRows.length === 0) {
            findings.push(finding({
                ruleId: 'DOC-RD-002', severity: 'error', module: 'docs', file: 'README.md',
                message: '路线图节无任何版本行（`| **vX.Y.Z** |`），路线图表失去版本索引作用',
            }));
        } else {
            const shipped = roadmapRows.find((r) => r.ver === pkgVersion);
            if (!shipped) {
                findings.push(finding({
                    ruleId: 'DOC-RD-002', severity: 'error', module: 'docs', file: 'README.md',
                    message: `已发布版本 v${pkgVersion} 未列入 README 路线图（发布与文档脱节）`,
                    suggestedFix: '补一行 `| **v' + pkgVersion + '** | ... | ✅ |`',
                }));
            } else if (shipped.raw.includes('🚧')) {
                findings.push(finding({
                    ruleId: 'DOC-RD-002', severity: 'error', module: 'docs', file: 'README.md',
                    message: `路线图中 v${pkgVersion} 仍标记为 🚧 规划中，与已发布状态矛盾`,
                    suggestedFix: '将该行状态改为 ✅ 并补一句成果摘要',
                }));
            }
        }
    }
    RD_NOTES.push(`README 布局契约: 必需节 ${7 - findings.filter((f) => f.ruleId === 'DOC-RD-001').length}/7 在位，路线图同步校验完成`);
}

const status = verdict(findings, { blockOn: 'error' });
log.info(`文档布局门禁: 违规 ${findings.length} 条`);

printEnvelope(envelope({
    checker: 'L3-DOC-LAYOUT',
    status,
    findings,
    filesScanned: 2,
    durationMs: Date.now() - started,
    notes: [...CL_NOTES, ...RD_NOTES],
}));
process.exit(status === STATUS.PASS ? 0 : 1);
