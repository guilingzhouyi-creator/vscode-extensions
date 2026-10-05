#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 全工作区跨项目审查中枢)
# 文件路径: scripts/sh/audit-all.sh
# 架构定位: 全工作区跨项目统一审查 Runner (Linux Bash)
# 依赖与触发: 触发方: 本地 CLI / CI 门禁 | 上游: 三项目专属门禁套件 | 下游: 统一质量看板 | 运行时: Bash 4+
# 职责说明: 调度执行全工作区跨项目质量审查，多项目并行调度 workspace-timing、auto-refactor 与 WebGames
# 退出语义与设计依据: 退出码: 0=全项审查通过, 1=存在审查违规 | 设计依据: AGENTS.md 工作区全局治理总规
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/audit-all.sh
#   bash scripts/sh/audit-all.sh --fast
#   bash scripts/sh/audit-all.sh --json
# ==============================================================================
set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT_DIR" || exit 1

export GIT_CONFIG_GLOBAL="${GIT_CONFIG_GLOBAL:-NUL}"
export GIT_CONFIG_SYSTEM="${GIT_CONFIG_SYSTEM:-NUL}"
export GIT_CONFIG_NOSYSTEM="${GIT_CONFIG_NOSYSTEM:-1}"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$ROOT_DIR}"

NODE_BIN=$(command -v node 2>/dev/null || command -v node.exe 2>/dev/null || echo "node")
NPM_BIN=$(command -v npm 2>/dev/null || command -v npm.cmd 2>/dev/null || echo "npm")
PYTHON_BIN=$(command -v python3 2>/dev/null || command -v python 2>/dev/null || command -v py 2>/dev/null || echo "python3")

FAST_MODE=0
JSON_MODE=0

for arg in "$@"; do
    case "$arg" in
        --fast|-f) FAST_MODE=1 ;;
        --json|-j) JSON_MODE=1 ;;
        --help|-h)
            echo "用法: bash scripts/sh/audit-all.sh [选项]"
            echo "选项:"
            echo "  --fast, -f    快速审查模式 (跳过耗时深层自审)"
            echo "  --json, -j    以 JSON 格式输出审查摘要"
            echo "  --help, -h    显示此帮助信息"
            exit 0
            ;;
    esac
done

if [[ "$JSON_MODE" -eq 0 ]]; then
    echo "================================================================="
    echo "🌐 全工作区跨项目统一审查中枢 (Unified Workspace Review Engine)"
    echo "================================================================="
fi

FAILED=0
START_TIME=$("$NODE_BIN" -e 'process.stdout.write(Date.now().toString())')

# 1. 物理卫生与零空文件看守
if [[ "$JSON_MODE" -eq 0 ]]; then echo "▶ [1/5] 检查全工作区物理卫生与零空文件..."; fi
if ! "$NODE_BIN" scripts/common/validate-no-empty-files.js >/dev/null 2>&1; then
    STATUS_HYGIENE="FAIL"
    FAILED=1
else
    STATUS_HYGIENE="PASS"
fi

# 2. 单源规则注册表与目录一致性
if [[ "$JSON_MODE" -eq 0 ]]; then echo "▶ [2/5] 聚合与校验全工作区单源规则目录..."; fi
if ! "$NODE_BIN" scripts/common/generate-rule-catalog.js >/dev/null 2>&1; then
    STATUS_RULES="FAIL"
    FAILED=1
else
    STATUS_RULES="PASS"
fi

# 3, 4, 5. 多项目并行并发审查调度 (auto-refactor [3/5], workspace-timing [4/5], WebGames [5/5])
if [[ "$JSON_MODE" -eq 0 ]]; then
    echo "▶ [3~5/5] 并行调度执行 auto-refactor、workspace-timing 与 WebGames 审查..."
fi

LOG_AR=$(mktemp)
LOG_WT=$(mktemp)
LOG_WG=$(mktemp)
trap 'rm -f "$LOG_AR" "$LOG_WT" "$LOG_WG"' EXIT

if [[ "$FAST_MODE" -eq 1 ]]; then
    (cd auto-refactor && "$NODE_BIN" scripts/validate-self-multidimensional-audit.js) >"$LOG_AR" 2>&1 & PID_AR=$!
else
    (cd auto-refactor && "$NPM_BIN" test && "$NODE_BIN" scripts/validate-self-multidimensional-audit.js) >"$LOG_AR" 2>&1 & PID_AR=$!
fi

(cd workspace-timing && "$NPM_BIN" run review && "$NPM_BIN" run test:fast) >"$LOG_WT" 2>&1 & PID_WT=$!

("$PYTHON_BIN" WebGames/scripts/py/audit_config.py --strict) >"$LOG_WG" 2>&1 & PID_WG=$!

STATUS_AR="PASS"
STATUS_WT="PASS"
STATUS_WG="PASS"

if ! wait "$PID_AR"; then
    STATUS_AR="FAIL"
    FAILED=1
fi

if ! wait "$PID_WT"; then
    STATUS_WT="FAIL"
    FAILED=1
fi

if ! wait "$PID_WG"; then
    STATUS_WG="FAIL"
    FAILED=1
fi

rm -f "$LOG_AR" "$LOG_WT" "$LOG_WG"

END_TIME=$("$NODE_BIN" -e 'process.stdout.write(Date.now().toString())')
ELAPSED_SEC=$("$NODE_BIN" -e "console.log((($END_TIME - $START_TIME) / 1000).toFixed(2))")

if [[ "$JSON_MODE" -eq 1 ]]; then
    "$NODE_BIN" -e '
      const fs = require("fs");
      const baselineFile = process.argv[1];
      const failed = process.argv[2] === "1";
      const elapsedSec = Number(process.argv[3]);
      const statusHygiene = process.argv[4];
      const statusRules = process.argv[5];
      const statusAr = process.argv[6];
      const statusWt = process.argv[7];
      const statusWg = process.argv[8];

      let compositeScore = null;
      let tenDimensions = null;
      let qualityVector = null;

      try {
        if (fs.existsSync(baselineFile)) {
          const b = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
          const m = b.metrics || {};
          compositeScore = m.compositeScore ?? b.compositeScore ?? null;
          if (b.tenDimensions) {
            tenDimensions = b.tenDimensions;
            qualityVector = b.tenDimensions;
          }
        }
      } catch (_) {}

      const summary = {
        timestamp: new Date().toISOString(),
        status: failed ? "FAIL" : "PASS",
        elapsedSeconds: elapsedSec,
        projects: {
          hygiene: statusHygiene,
          rulesCatalog: statusRules,
          autoRefactor: statusAr,
          workspaceTiming: statusWt,
          webGames: statusWg
        },
        compositeScore,
        tenDimensions,
        qualityVector
      };
      console.log(JSON.stringify(summary, null, 2));
    ' "$ROOT_DIR/auto-refactor/reports/self-audit-baseline.json" "$FAILED" "$ELAPSED_SEC" "$STATUS_HYGIENE" "$STATUS_RULES" "$STATUS_AR" "$STATUS_WT" "$STATUS_WG"
    exit "$FAILED"
fi

FMT_HYGIENE=$(printf '%-11s' "$STATUS_HYGIENE")
FMT_RULES=$(printf '%-11s' "$STATUS_RULES")
FMT_AR=$(printf '%-11s' "$STATUS_AR")
FMT_WT=$(printf '%-11s' "$STATUS_WT")
FMT_WG=$(printf '%-11s' "$STATUS_WG")

echo ""
echo "┌───────────────────────────────────────────────────────────────┐"
echo "│              全工作区统一审查报告与质量看板                   │"
echo "├─────────────────────────────┬─────────────┬───────────────────┤"
echo "│ 审查检查项 / 子系统         │ 判定结果    │ 覆盖范围          │"
echo "├─────────────────────────────┼─────────────┼───────────────────┤"
echo "│ 1. 工作区零空文件物理卫生   │ $FMT_HYGIENE │ 全仓代码/脚本/配置│"
echo "│ 2. 单源规则目录一致性 (SSOT)│ $FMT_RULES │ 单源规则总目录    │"
echo "│ 3. auto-refactor 质量基线   │ $FMT_AR │ 质量模型 / 并行自审│"
echo "│ 4. workspace-timing 审查门禁│ $FMT_WT │ L0~L5 / 并行门禁  │"
echo "│ 5. WebGames 配置架构审查    │ $FMT_WG │ 领域配置 / 并行审查│"
echo "├─────────────────────────────┴─────────────┴───────────────────┤"
echo "│ 耗时: ${ELAPSED_SEC}s  |  全局状态: $([[ $FAILED -eq 0 ]] && echo '✅ 检查通过' || echo '❌ 检查未通过')           │"
echo "└───────────────────────────────────────────────────────────────┘"

# 全工作区十维工程质量看板
echo ""
"$NODE_BIN" -e '
  const fs = require("fs");
  const p = process.argv[1];
  const dims = [
    { num: "1.", name: "架构一致", pad: "    ", key: "architectureConsistency" },
    { num: "2.", name: "语义纯度", pad: "    ", key: "semanticPurity" },
    { num: "3.", name: "代码安全", pad: "    ", key: "codeSecurity" },
    { num: "4.", name: "性能预算", pad: "    ", key: "performanceEfficiency" },
    { num: "5.", name: "标准化", pad: "      ", key: "standardization" },
    { num: "6.", name: "现代化", pad: "      ", key: "modernity" },
    { num: "7.", name: "可维护性", pad: "    ", key: "maintainability" },
    { num: "8.", name: "注释质量", pad: "    ", key: "commentQuality" },
    { num: "9.", name: "重复率", pad: "      ", key: "duplication" },
    { num: "10.", name: "技术债风险", pad: "  ", key: "techDebtRisk" }
  ];

  console.log("┌───────────────────────────────────────────────────────────────┐");
  console.log("│                   全工作区十维工程质量看板                    │");
  console.log("├───────────────────────────────────────────────────────────────┤");

  let loaded = false;
  try {
    if (fs.existsSync(p)) {
      const b = JSON.parse(fs.readFileSync(p, "utf8"));
      const m = b.metrics || {};
      const compositeScore = m.compositeScore ?? b.compositeScore ?? null;
      const grade = m.grade || null;
      const totalDebt = m.totalIssues ?? m.unsuppressedIssues ?? null;
      const autonomyRate = b.autonomyRate ?? m.autonomyRate ?? b.cai ?? null;
      const tenDimensions = b.tenDimensions || null;

      if (tenDimensions && compositeScore !== null) {
        loaded = true;
        let summaryText = `综合健康分: ${compositeScore}` + (grade ? ` (${grade})` : "");
        if (autonomyRate) summaryText += `  |  自研率: ${autonomyRate}%`;
        if (totalDebt !== null) summaryText += `  |  技术债总量: ${totalDebt} 项`;

        let w = 0;
        for (const ch of summaryText) w += ch.charCodeAt(0) > 127 ? 2 : 1;
        const rightPad = Math.max(0, 61 - w);
        console.log(`│ ${summaryText}${" ".repeat(rightPad)} │`);
        console.log("├───────────────────────────────────────────────────────────────┤");

        for (const d of dims) {
          const score = Number(tenDimensions[d.key] ?? 0);
          const filled = Math.max(0, Math.min(20, Math.round((score / 100) * 20)));
          const empty = 20 - filled;
          const bar = "█".repeat(filled) + "░".repeat(empty);
          const scoreStr = (score % 1 === 0 ? score.toFixed(1) : String(Math.round(score * 100) / 100)).padStart(5);
          console.log(`│ ${d.num.padEnd(4)}${d.name}${d.pad}[${bar}] ${scoreStr}${" ".repeat(17)} │`);
        }
        console.log("└───────────────────────────────────────────────────────────────┘");
      }
    }
  } catch (_) {}

  if (!loaded) {
    console.log(`│ [离线基线快照未就绪 - 优雅降级模式]${" ".repeat(26)} │`);
    console.log("└───────────────────────────────────────────────────────────────┘");
  }
' "$ROOT_DIR/auto-refactor/reports/self-audit-baseline.json"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  "$NODE_BIN" -e '
    const fs = require("fs");
    const baselineFile = process.argv[1];
    const failed = process.argv[2] === "1";
    const elapsedSec = process.argv[3];
    const statusHygiene = process.argv[4];
    const statusRules = process.argv[5];
    const statusAr = process.argv[6];
    const statusWt = process.argv[7];
    const statusWg = process.argv[8];
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;

    let compositeScore = "N/A";
    let grade = "";
    let totalDebt = "N/A";
    let autonomyRate = "";
    let tenDims = null;

    try {
      if (fs.existsSync(baselineFile)) {
        const b = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
        const m = b.metrics || {};
        compositeScore = m.compositeScore ?? b.compositeScore ?? "N/A";
        grade = m.grade ? ` (Grade: **${m.grade}**)` : "";
        totalDebt = m.totalIssues ?? m.unsuppressedIssues ?? "N/A";
        if (b.autonomyRate || m.autonomyRate || b.cai) {
          autonomyRate = ` &nbsp;|&nbsp; **自研率**: **${b.autonomyRate || m.autonomyRate || b.cai}%**`;
        }
        tenDims = b.tenDimensions || null;
      }
    } catch (_) {}

    const passBadge = (s) => (s === "PASS" ? "✅ PASS" : "❌ FAIL");
    const globalStatus = failed ? "❌ 检查未通过" : "✅ 检查通过";

    let md = "## 🌐 全工作区跨项目统一审查与十维质量看板\n\n";
    md += "### 📊 审查检查项 / 子系统判定\n\n";
    md += "| 审查检查项 / 子系统 | 判定结果 | 覆盖范围 |\n";
    md += "| :--- | :---: | :--- |\n";
    md += `| **1. 工作区零空文件物理卫生** | ${passBadge(statusHygiene)} | 全仓代码/脚本/配置 |\n`;
    md += `| **2. 单源规则目录一致性 (SSOT)** | ${passBadge(statusRules)} | 单源规则总目录 |\n`;
    md += `| **3. auto-refactor 质量基线** | ${passBadge(statusAr)} | 质量模型 / 并行自审 |\n`;
    md += `| **4. workspace-timing 审查门禁** | ${passBadge(statusWt)} | L0~L5 / 并行门禁 |\n`;
    md += `| **5. WebGames 配置架构审查** | ${passBadge(statusWg)} | 领域配置 / 并行审查 |\n\n`;
    md += `> **耗时**: ${elapsedSec}s &nbsp;|&nbsp; **全局状态**: ${globalStatus}\n\n`;

    md += "### 🎯 全工作区十维工程质量看板\n\n";
    if (tenDims) {
      md += `> **综合健康分**: **${compositeScore}**${grade} &nbsp;|&nbsp; **技术债总量**: **${totalDebt} 项**${autonomyRate}\n\n`;
      md += "| 序号 | 质量维度 | 得分 | 进度可视化 |\n";
      md += "| :---: | :--- | :---: | :--- |\n";
      const dims = [
        { num: "1", name: "架构一致 (Architecture Consistency)", key: "architectureConsistency" },
        { num: "2", name: "语义纯度 (Semantic Purity)", key: "semanticPurity" },
        { num: "3", name: "代码安全 (Code Security)", key: "codeSecurity" },
        { num: "4", name: "性能预算 (Performance Efficiency)", key: "performanceEfficiency" },
        { num: "5", name: "标准化 (Standardization)", key: "standardization" },
        { num: "6", name: "现代化 (Modernity)", key: "modernity" },
        { num: "7", name: "可维护性 (Maintainability)", key: "maintainability" },
        { num: "8", name: "注释质量 (Comment Quality)", key: "commentQuality" },
        { num: "9", name: "重复率 (Duplication)", key: "duplication" },
        { num: "10", name: "技术债风险 (Tech Debt Risk)", key: "techDebtRisk" }
      ];
      for (const d of dims) {
        const score = Number(tenDims[d.key] ?? 0);
        const filled = Math.max(0, Math.min(20, Math.round((score / 100) * 20)));
        const empty = 20 - filled;
        const bar = "█".repeat(filled) + "░".repeat(empty);
        const scoreStr = score % 1 === 0 ? score.toFixed(1) : String(Math.round(score * 100) / 100);
        md += `| ${d.num} | ${d.name} | ${scoreStr} | \`[${bar}]\` |\n`;
      }
    } else {
      md += "> ⚠️ [离线基线快照未就绪 - 优雅降级模式]\n";
    }
    md += "\n";
    try {
      fs.appendFileSync(summaryFile, md, "utf8");
    } catch (_) {}
  ' "$ROOT_DIR/auto-refactor/reports/self-audit-baseline.json" "$FAILED" "$ELAPSED_SEC" "$STATUS_HYGIENE" "$STATUS_RULES" "$STATUS_AR" "$STATUS_WT" "$STATUS_WG" 2>/dev/null || true
fi

# 6. 汇流记录工作区统一质量轨迹
if [[ "$FAILED" -ne 0 ]]; then
    "$NODE_BIN" scripts/common/record-workspace-trajectory.js --failed >/dev/null 2>&1 || true
else
    "$NODE_BIN" scripts/common/record-workspace-trajectory.js >/dev/null 2>&1 || true
fi

if [[ "$FAILED" -ne 0 ]]; then
    echo "❌ 审查中枢检测到未通过项，请排查修复对应项目"
    exit 1
else
    echo "✅ 全工作区审查完成，所有项目健康合规"
    exit 0
fi
