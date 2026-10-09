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
import { readFileSafe, collectFiles } from '../common/scan.js';
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
        ruleId: 'DOC-CL-004', severity: 'error', module: 'docs', file: 'CHANGELOG.md', line: idx + 1,
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
  //   （避免因 UTC 转换导致本地时区跨日边界判定偏差）。
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

  // DOC-CL-007 与 DOC-CL-008：最新发布版本条目真实性、代码符号防虚构与产品文本纪律
  if (versions.length > 0) {
    const latestVer = versions[0];
    const nextVerLine = versions.length > 1 ? versions[1].line : clLines.length + 1;
    const latestLines = clLines.slice(latestVer.line - 1, nextVerLine - 1);

    const configKeys = new Set<string>();
    if (pkgRes.ok && (pkgRes.data as any)?.contributes?.configuration) {
      const configs = (pkgRes.data as any).contributes.configuration;
      const configList = Array.isArray(configs) ? configs : [configs];
      for (const c of configList) {
        if (c?.properties) {
          Object.keys(c.properties).forEach((k) => configKeys.add(k));
        }
      }
    }

    const srcFiles = await collectFiles({ root: path.join(root, 'src'), include: ['**/*.ts'] });
    const allSrcTextArr = await Promise.all(srcFiles.map((f) => readFileSafe(path.join(root, 'src', f))));
    const allSrcText = allSrcTextArr.filter(Boolean).join('\n');
    const allSrcBasenames = new Set(srcFiles.map((f) => path.basename(f, '.ts')));

    const FORBIDDEN_JARGON_PATTERNS: Array<{ regex: RegExp; desc: string }> = [
      { regex: /\$[^$]+\$/, desc: 'LaTeX 数学公式符号（破坏通用 Markdown 渲染）' },
      { regex: /\b(p[0-9]+|phase[0-9]+|st[0-9]+|wip)\b/i, desc: '敏捷冲刺/临时过程代号' },
      { regex: /(圈复杂度|三元嵌套|AST\s*切片|ELOC|单行噪声比)/, desc: '代码分析器内部度量技术黑话' },
    ];

    latestLines.forEach((l, idx) => {
      if (!l.trim().startsWith('- ')) return;
      const lineNum = latestVer.line + idx;

      // DOC-CL-007: 真实性防虚构
      const codeTokens = [...l.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      for (const token of codeTokens) {
        if (token.startsWith('workspaceTiming.')) {
          if (!configKeys.has(token)) {
            findings.push(finding({
              ruleId: 'DOC-CL-007', severity: 'error', module: 'docs', file: 'CHANGELOG.md', line: lineNum,
              message: `变更日志引用了不存在的扩展配置项 \`${token}\`（虚构配置/日志幻觉）`,
              evidence: l.trim(),
              suggestedFix: `核对 package.json contributes.configuration 中实际声明的配置项`,
            }));
          }
        } else if (/^[A-Z][a-zA-Z0-9]+$/.test(token)) {
          const EXEMPT_PASCAL = new Set([
            'Promise', 'Map', 'Set', 'Array', 'Date', 'RegExp', 'Error', 'JSON', 'CSV',
            'Markdown', 'VSIX', 'FIFO', 'HTML', 'URI', 'UTC', 'JSDoc', 'TypeScript', 'Node',
          ]);
          if (!EXEMPT_PASCAL.has(token)) {
            const hasFile = allSrcBasenames.has(token);
            const hasSymbol = new RegExp(`\\b${token}\\b`).test(allSrcText);
            if (!hasFile && !hasSymbol) {
              findings.push(finding({
                ruleId: 'DOC-CL-007', severity: 'error', module: 'docs', file: 'CHANGELOG.md', line: lineNum,
                message: `变更日志引用了代码库中不存在的代码符号 \`${token}\`（虚构类或模块/日志幻觉）`,
                evidence: l.trim(),
                suggestedFix: `核对 src/ 中实际存在的文件名、类名或接口定义`,
              }));
            }
          }
        }
      }

      // DOC-CL-008: 文本纪律与防黑话
      for (const { regex, desc } of FORBIDDEN_JARGON_PATTERNS) {
        if (regex.test(l)) {
          findings.push(finding({
            ruleId: 'DOC-CL-008', severity: 'error', module: 'docs', file: 'CHANGELOG.md', line: lineNum,
            message: `变更日志包含非面向用户的内部技术黑话: ${desc}`,
            evidence: l.trim(),
            suggestedFix: '以面向终端用户的客观产品功能和稳定性价值重构表述，消除内部实现细节与度量指标',
          }));
        }
      }

      // DOC-CL-009: 产品更新日志边界守卫与内部工程事务隔离
      const FORBIDDEN_ENGINEERING_TERMS = [
        { regex: /JSDoc/i, term: 'JSDoc' },
        { regex: /六字段/, term: '六字段契约' },
        { regex: /(代码注释|注释契约|注释规范|注释治理)/, term: '代码注释事务' },
        { regex: /package\.(ps1|sh)/i, term: 'package.ps1/sh 脚本' },
        { regex: /(打包脚本|构建脚本|构建流水线|CI\s*流水线)/, term: '构建/打包流水线' },
        { regex: /(tsconfig|eslint|门禁系统|pre-commit)/i, term: '内部工具配置/门禁' },
      ];
      for (const { regex, term } of FORBIDDEN_ENGINEERING_TERMS) {
        if (regex.test(l)) {
          findings.push(finding({
            ruleId: 'DOC-CL-009', severity: 'error', module: 'docs', file: 'CHANGELOG.md', line: lineNum,
            message: `产品更新日志混入内部代码注释或工程构建事务词汇: ${term}`,
            evidence: l.trim(),
            suggestedFix: 'CHANGELOG 是面向最终用户的产品更新日志，严禁混入内部 JSDoc 注释、构建脚本或工程治理事务，请仅保留面向用户的产品功能、体验与稳定性提升',
          }));
        }
      }
    });

    // DOC-CL-009: 分类标题工程事务隔离（产品发布中不得出现纯工程基础设施或内部文档节）
    latestLines.forEach((l, idx) => {
      if (!l.startsWith('### ')) return;
      const lineNum = latestVer.line + idx;
      if (/^### (Engineering Infrastructure|Docs)/.test(l)) {
        findings.push(finding({
          ruleId: 'DOC-CL-009', severity: 'error', module: 'docs', file: 'CHANGELOG.md', line: lineNum,
          message: `产品更新日志分类标题不得使用内部工程分类: ${l.trim()}`,
          evidence: l.trim(),
          suggestedFix: '产品更新日志仅允许用户可感知的分类：Added（新功能）、Changed（功能与体验优化）、Fixed（缺陷修复）、Performance & Optimization（性能与稳定性优化）等',
        }));
      }
    });
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

      // DOC-RD-003：路线图已发布版本成果摘要真实性与反虚构核验
      if (shipped) {
        const configKeys = new Set<string>();
        if (pkgRes.ok && (pkgRes.data as any)?.contributes?.configuration) {
          const configs = (pkgRes.data as any).contributes.configuration;
          const configList = Array.isArray(configs) ? configs : [configs];
          for (const c of configList) {
            if (c?.properties) {
              Object.keys(c.properties).forEach((k) => configKeys.add(k));
            }
          }
        }
        const codeTokens = [...shipped.raw.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
        for (const token of codeTokens) {
          if (token.startsWith('workspaceTiming.') && !configKeys.has(token)) {
            findings.push(finding({
              ruleId: 'DOC-RD-003', severity: 'error', module: 'docs', file: 'README.md', line: shipped.line,
              message: `路线图表项引用了不存在的配置项 \`${token}\`（虚构配置）`,
              evidence: shipped.raw.trim(),
            }));
          }
        }
        if (/(圈复杂度|三元嵌套|AST\s*切片|\$[^$]+\$)/.test(shipped.raw)) {
          findings.push(finding({
            ruleId: 'DOC-RD-003', severity: 'error', module: 'docs', file: 'README.md', line: shipped.line,
            message: '路线图表项包含内部度量黑话或 LaTeX 公式',
            evidence: shipped.raw.trim(),
          }));
        }
        if (/(JSDoc|六字段|代码注释|注释契约|package\.(ps1|sh)|构建脚本|打包脚本)/i.test(shipped.raw)) {
          findings.push(finding({
            ruleId: 'DOC-RD-003', severity: 'error', module: 'docs', file: 'README.md', line: shipped.line,
            message: '路线图表项混入内部代码注释或工程构建事务词汇',
            evidence: shipped.raw.trim(),
            suggestedFix: '路线图成果摘要必须是面向用户的产品交付价值，严禁混入内部代码注释或构建脚本',
          }));
        }
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
