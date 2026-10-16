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
AGENT_MODE=0

for arg in "$@"; do
    case "$arg" in
        --fast|-f|-Fast) FAST_MODE=1 ;;
        --json|-j|-Json) JSON_MODE=1 ;;
        --agent|-a|-Agent) AGENT_MODE=1 ;;
        --help|-h|-Help)
            echo "用法: bash scripts/sh/audit-all.sh [选项]"
            echo "选项:"
            echo "  --fast, -f, -Fast    快速审查模式 (跳过耗时深层自审)"
            echo "  --json, -j, -Json    以 JSON 格式输出审查摘要"
            echo "  --agent, -a, -Agent  以 Agent-Native JSON 信封格式输出审查结果"
            echo "  --help, -h, -Help    显示此帮助信息"
            exit 0
            ;;
    esac
done

if [[ "$JSON_MODE" -eq 0 && "$AGENT_MODE" -eq 0 ]]; then
    echo "================================================================="
    echo "🌐 全工作区跨项目统一审查中枢 (Unified Workspace Review Engine)"
    echo "================================================================="
fi

FAILED=0
START_TIME=$("$NODE_BIN" -e 'process.stdout.write(Date.now().toString())')

# 1. 物理卫生与零空文件看守
if [[ "$JSON_MODE" -eq 0 && "$AGENT_MODE" -eq 0 ]]; then echo "▶ [1/5] 检查全工作区物理卫生、同构脚本、.gitignore 治理与零空文件..."; fi
CODE_EMPTY=0
"$NODE_BIN" scripts/common/validate-no-empty-files.js >/dev/null 2>&1 || CODE_EMPTY=$?
CODE_ISO=0
"$NODE_BIN" scripts/common/validate-script-isomorphism.js >/dev/null 2>&1 || CODE_ISO=$?
CODE_GI=0
"$NODE_BIN" scripts/common/validate-gitignore-governance.js >/dev/null 2>&1 || CODE_GI=$?
if [[ "$CODE_EMPTY" -ne 0 || "$CODE_ISO" -ne 0 || "$CODE_GI" -ne 0 ]]; then
    STATUS_HYGIENE="FAIL"
    FAILED=1
else
    STATUS_HYGIENE="PASS"
fi

# 2. 单源规则注册表与目录一致性及技能集规范
if [[ "$JSON_MODE" -eq 0 && "$AGENT_MODE" -eq 0 ]]; then echo "▶ [2/5] 聚合与校验全工作区单源规则目录与技能集规范..."; fi
CODE_CATALOG=0
"$NODE_BIN" scripts/common/generate-rule-catalog.js >/dev/null 2>&1 || CODE_CATALOG=$?
CODE_SKILLS=0
"$NODE_BIN" scripts/common/validate-skills.js >/dev/null 2>&1 || CODE_SKILLS=$?
if [[ "$CODE_CATALOG" -ne 0 || "$CODE_SKILLS" -ne 0 ]]; then
    STATUS_RULES="FAIL"
    FAILED=1
else
    STATUS_RULES="PASS"
fi

LOG_WT=$(mktemp)
LOG_WG=$(mktemp)
LOG_AR=$(mktemp)
LOG_AR_SELF=$(mktemp)
trap 'rm -f "$LOG_WT" "$LOG_WG" "$LOG_AR" "$LOG_AR_SELF"' EXIT

# 辅助函数: 带看门狗超时的后台进程等待机制
wait_with_timeout() {
    local pid="$1"
    local timeout="$2"
    local name="$3"
    local log_file="${4:-}"
    local count=0
    while kill -0 "$pid" 2>/dev/null; do
        if [[ "$count" -ge "$timeout" ]]; then
            echo "⚠️ $name 审查执行超时 (${timeout}s，PID: $pid)，强制终止进程..." >&2
            kill -TERM "$pid" 2>/dev/null || true
            sleep 1
            kill -KILL "$pid" 2>/dev/null || true

            local diag_dir="$ROOT_DIR/.audit-logs"
            mkdir -p "$diag_dir" 2>/dev/null || true
            local timestamp
            timestamp=$(date +"%Y%m%d-%H%M%S" 2>/dev/null || echo "unknown")
            local safe_name
            safe_name=$(echo "$name" | tr ' ' '_' | tr '[:upper:]' '[:lower:]')
            local diag_file="$diag_dir/timeout-${safe_name}-${timestamp}.log"
            {
                echo "================================================================================"
                echo "⚠️ WATCHDOG TIMEOUT 诊断快照"
                echo "================================================================================"
                echo "目标模块: $name"
                echo "进程 PID: $pid"
                echo "超时阈值: ${timeout} 秒"
                echo "触发时间: $(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date)"
                echo "处置措施: 看门狗已触发 SIGTERM/SIGKILL 级联终止进程"
                echo "--------------------------------------------------------------------------------"
                echo "【最后捕获的标准输出与错误日志】:"
                if [[ -n "$log_file" && -f "$log_file" ]]; then
                    tail -n 100 "$log_file"
                else
                    echo "(日志内容为空或未指定日志文件)"
                fi
                echo "================================================================================"
            } > "$diag_file" 2>/dev/null || true
            echo "💡 超时诊断快照已落盘至: $diag_file" >&2
            "$NODE_BIN" "$ROOT_DIR/scripts/common/log-rotator.js" --prune >/dev/null 2>&1 || true
            return 124
        fi
        sleep 1
        count=$((count + 1))
    done
    wait "$pid" 2>/dev/null || return $?
    return 0
}

# 3~5. 并行并发调度 workspace-timing、WebGames 与 auto-refactor 三大项目审查
if [[ "$JSON_MODE" -eq 0 && "$AGENT_MODE" -eq 0 ]]; then
    echo "▶ [3/5] 并行调度 workspace-timing 审查 (VS Code 扩展)..."
    echo "▶ [4/5] 并行调度 WebGames 领域配置与架构审查..."
    echo "▶ [5/5] 并行调度 auto-refactor 静态引擎多维自审与质量门禁..."
fi

# 并发拉起三大项目审查任务 (后台异步派发)
(cd workspace-timing && "$NPM_BIN" run review) >"$LOG_WT" 2>&1 &
PID_WT=$!

if [[ "$FAST_MODE" -eq 1 ]]; then
    ("$PYTHON_BIN" WebGames/scripts/py/audit_runner.py --diff) >"$LOG_WG" 2>&1 &
else
    ("$PYTHON_BIN" WebGames/scripts/py/audit_runner.py) >"$LOG_WG" 2>&1 &
fi
PID_WG=$!

if [[ "$FAST_MODE" -eq 1 ]]; then
    (cd auto-refactor && "$NODE_BIN" scripts/validate-self-multidimensional-audit.js) >"$LOG_AR" 2>&1 &
    PID_AR=$!
else
    (cd auto-refactor && "$NODE_BIN" scripts/test-parallel.js) >"$LOG_AR" 2>&1 &
    PID_AR=$!
fi

# 看门狗超时守卫：防止子进程挂起导致审查无限阻塞
TIMEOUT_WT=$([[ "$FAST_MODE" -eq 1 ]] && echo 60 || echo 120)
TIMEOUT_WG=$([[ "$FAST_MODE" -eq 1 ]] && echo 60 || echo 120)
TIMEOUT_AR=$([[ "$FAST_MODE" -eq 1 ]] && echo 90 || echo 240)

STATUS_WT="PASS"
CODE_WT=0
wait_with_timeout "$PID_WT" "$TIMEOUT_WT" "workspace-timing" "$LOG_WT" || CODE_WT=$?
if [[ "$CODE_WT" -ne 0 ]]; then
    STATUS_WT="FAIL"
    FAILED=1
fi

STATUS_WG="PASS"
CODE_WG=0
wait_with_timeout "$PID_WG" "$TIMEOUT_WG" "WebGames" "$LOG_WG" || CODE_WG=$?
if [[ "$CODE_WG" -ne 0 ]]; then
    STATUS_WG="FAIL"
    FAILED=1
fi

STATUS_AR="PASS"
CODE_AR=0
wait_with_timeout "$PID_AR" "$TIMEOUT_AR" "auto-refactor" "$LOG_AR" || CODE_AR=$?
if [[ "$CODE_AR" -ne 0 ]]; then
    STATUS_AR="FAIL"
    FAILED=1
fi

if [[ "$FAST_MODE" -eq 0 && "$STATUS_AR" == "PASS" ]]; then
    CODE_GATE_SELF=0
    (cd auto-refactor && "$NODE_BIN" scripts/gate-self.js) >"$LOG_AR_SELF" 2>&1 || CODE_GATE_SELF=$?
    if [[ "$CODE_GATE_SELF" -ne 0 ]]; then
        STATUS_AR="FAIL"
        FAILED=1
        cat "$LOG_AR_SELF" >> "$LOG_AR"
    fi
fi

# 日志输出与清理：子进程失败后回显末尾 15 行日志
if [[ "$STATUS_WT" != "PASS" ]]; then
    if [[ "$JSON_MODE" -eq 0 && "$AGENT_MODE" -eq 0 && -s "$LOG_WT" ]]; then
        echo "❌ workspace-timing 审查未通过:"
        tail -n 15 "$LOG_WT" | sed 's/^/   /'
    fi
fi

if [[ "$STATUS_WG" != "PASS" ]]; then
    if [[ "$JSON_MODE" -eq 0 && "$AGENT_MODE" -eq 0 && -s "$LOG_WG" ]]; then
        echo "❌ WebGames 审查未通过:"
        tail -n 15 "$LOG_WG" | sed 's/^/   /'
    fi
fi

if [[ "$STATUS_AR" != "PASS" ]]; then
    if [[ "$JSON_MODE" -eq 0 && "$AGENT_MODE" -eq 0 && -s "$LOG_AR" ]]; then
        echo "❌ auto-refactor 审查未通过:"
        tail -n 15 "$LOG_AR" | sed 's/^/   /'
    fi
fi

if [[ "$FAILED" -ne 0 ]]; then
    DIAG_DIR="$ROOT_DIR/.audit-logs"
    mkdir -p "$DIAG_DIR" 2>/dev/null || true
    TIMESTAMP=$(date +"%Y%m%d-%H%M%S" 2>/dev/null || echo "unknown")
    [[ "$STATUS_WT" != "PASS" && -s "$LOG_WT" ]] && cp "$LOG_WT" "$DIAG_DIR/fail-workspace-timing-$TIMESTAMP.log" 2>/dev/null || true
    [[ "$STATUS_WG" != "PASS" && -s "$LOG_WG" ]] && cp "$LOG_WG" "$DIAG_DIR/fail-webgames-$TIMESTAMP.log" 2>/dev/null || true
    [[ "$STATUS_AR" != "PASS" && -s "$LOG_AR" ]] && cp "$LOG_AR" "$DIAG_DIR/fail-auto-refactor-$TIMESTAMP.log" 2>/dev/null || true
    echo "💡 失败审查完整日志已保留至: .audit-logs/" >&2
    "$NODE_BIN" "$ROOT_DIR/scripts/common/log-rotator.js" --prune >/dev/null 2>&1 || true
fi

rm -f "$LOG_AR" "$LOG_WT" "$LOG_WG" "$LOG_AR_SELF"

# 统一合并执行报告、十维质量看板与步骤摘要生成（消除多进程重复启动）
"$NODE_BIN" -e '
  const fs = require("fs");
  const path = require("path");
  const startTime = Number(process.argv[1]);
  const failed = process.argv[2] === "1";
  const jsonMode = process.argv[3] === "1";
  const agentMode = process.argv[15] === "1";
  const statusHygiene = process.argv[4];
  const statusRules = process.argv[5];
  const statusAr = process.argv[6];
  const statusWt = process.argv[7];
  const statusWg = process.argv[8];
  const rootDir = process.argv[9];
  const codeEmpty = Number(process.argv[10] || 0);
  const codeIso = Number(process.argv[11] || 0);
  const codeCatalog = Number(process.argv[12] || 0);
  const codeSkills = Number(process.argv[13] || 0);
  const baselineFile = path.join(rootDir, "auto-refactor", "reports", "self-audit-baseline.json");
  const wtReportFile = path.join(rootDir, "workspace-timing", "reports", "review", "report-latest.json");
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);

  let compositeScore = null;
  let grade = null;
  let totalDebt = null;
  let autonomyRate = null;
  let tenDimensions = null;
  let qualityVector = null;

  try {
    if (fs.existsSync(baselineFile)) {
      const b = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
      const m = b.metrics || {};
      compositeScore = m.compositeScore ?? b.compositeScore ?? null;
      grade = m.grade || null;
      totalDebt = m.totalIssues ?? m.unsuppressedIssues ?? null;
      autonomyRate = b.autonomyRate ?? m.autonomyRate ?? b.cai ?? null;
      if (b.tenDimensions) {
        tenDimensions = b.tenDimensions;
        qualityVector = b.tenDimensions;
      }
    }
  } catch (_) {}

  const SCORE_FLOOR = 15.0;

  // 1. 物理卫生基石得分（动态判定：零空文件/跳板与同构脚本对双项全合规 100.0，按违规项比例连续度量）
  let hygienePassedCount = 0;
  if (codeEmpty === 0) hygienePassedCount += 1;
  if (codeIso === 0) hygienePassedCount += 1;
  const scoreHygiene = hygienePassedCount === 2 ? 100.0 : Math.max(SCORE_FLOOR, Number((100.0 * (hygienePassedCount / 2.0)).toFixed(1)));

  // 2. 单源规则目录基石得分（基于 SSOT 规则目录一致性与技能文档字节等价比对动态判定）
  const ruleCatalogPath = path.join(rootDir, "scripts", "common", "rule-catalog.json");
  let catalogRuleCount = 0;
  try {
    if (fs.existsSync(ruleCatalogPath)) {
      const catalogObj = JSON.parse(fs.readFileSync(ruleCatalogPath, "utf8"));
      if (catalogObj && catalogObj.totalRules) {
        catalogRuleCount = Number(catalogObj.totalRules);
      }
    }
  } catch (_) {
    catalogRuleCount = 0;
  }

  const expectedRuleBaseline = Math.max(420, catalogRuleCount);
  let scoreRules = SCORE_FLOOR;
  if (statusRules === "PASS" && catalogRuleCount >= expectedRuleBaseline) {
    scoreRules = 100.0;
  } else if (statusRules === "PASS" && catalogRuleCount > 0) {
    scoreRules = Math.max(SCORE_FLOOR, Number((100.0 * (catalogRuleCount / expectedRuleBaseline)).toFixed(1)));
  } else {
    let rulesPassedCount = 0;
    if (codeCatalog === 0) rulesPassedCount += 1;
    if (codeSkills === 0) rulesPassedCount += 1;
    scoreRules = Math.max(SCORE_FLOOR, Number((100.0 * (rulesPassedCount / 2.0)).toFixed(1)));
  }

  // 3. auto-refactor 质量基线得分（基于自审综合基线动态读取，门禁失败动态连续衰减）
  const baseAr = compositeScore !== null ? Number(compositeScore) : 100.0;
  const scoreAr = statusAr === "PASS" ? baseAr : Math.max(SCORE_FLOOR, Number((baseAr - 60.0).toFixed(1)));

  // 4. workspace-timing 审查门禁得分（基于 report-latest.json 真实 checks/pass/warn 连续计算，移除硬编码 94.6）
  let baseWt = null;
  try {
    if (fs.existsSync(wtReportFile)) {
      const wtJson = JSON.parse(fs.readFileSync(wtReportFile, "utf8"));
      if (wtJson && wtJson.summary && wtJson.summary.checks > 0) {
        const totalChecks = Number(wtJson.summary.checks);
        const passChecks = wtJson.summary.byStatus?.PASS ? Number(wtJson.summary.byStatus.PASS) : 0;
        const warnCount = wtJson.summary.bySeverity?.warning ? Number(wtJson.summary.bySeverity.warning) : 0;
        const errCount = wtJson.summary.bySeverity?.error ? Number(wtJson.summary.bySeverity.error) : 0;
        if (totalChecks > 0) {
          const ratio = passChecks / totalChecks;
          const rawWt = (100.0 * ratio) - (warnCount * 0.035) - (errCount * 5.0);
          baseWt = Math.max(SCORE_FLOOR, Number(rawWt.toFixed(1)));
        }
      }
    }
  } catch (_) {
    baseWt = null;
  }

  if (baseWt === null) {
    baseWt = statusWt === "PASS" ? 100.0 : SCORE_FLOOR;
  }
  const scoreWt = statusWt === "PASS" ? baseWt : Math.max(SCORE_FLOOR, Number((baseWt - 60.0).toFixed(1)));

  // 5. WebGames 配置架构得分（基于 audit-latest.json 真实 checks/pass/warn 连续客观计算，彻底消融阶跃硬编码）
  let baseWg = null;
  try {
    const wgReportPath = path.join(repoRoot, "WebGames", "reports", "audit-latest.json");
    if (fs.existsSync(wgReportPath)) {
      const wgData = JSON.parse(fs.readFileSync(wgReportPath, "utf8"));
      if (wgData && wgData.summary && wgData.summary.checks > 0) {
        const totalChecksWg = Number(wgData.summary.checks);
        const passChecksWg = wgData.summary.byStatus && wgData.summary.byStatus.PASS ? Number(wgData.summary.byStatus.PASS) : 0;
        const warnCountWg = wgData.summary.bySeverity && wgData.summary.bySeverity.warning ? Number(wgData.summary.bySeverity.warning) : 0;
        const errCountWg = wgData.summary.bySeverity && wgData.summary.bySeverity.error ? Number(wgData.summary.bySeverity.error) : 0;
        if (totalChecksWg > 0) {
          const ratioWg = passChecksWg / totalChecksWg;
          const rawWg = (100.0 * ratioWg) - (warnCountWg * 0.035) - (errCountWg * 5.0);
          baseWg = Math.max(SCORE_FLOOR, Number(rawWg.toFixed(1)));
        }
      }
    }
  } catch (_) {
    baseWg = null;
  }

  if (baseWg === null) {
    baseWg = statusWg === "PASS" ? 100.0 : SCORE_FLOOR;
  }
  const scoreWg = statusWg === "PASS" ? baseWg : Math.max(SCORE_FLOOR, Number((baseWg - 60.0).toFixed(1)));

  // 全工作区综合健康分（五大核心子系统基石分平权加权各占 20%：0.2 * (Hygiene + Rules + AR + WT + WG)）
  const workspaceHealthScore = Number((0.2 * (scoreHygiene + scoreRules + scoreAr + scoreWt + scoreWg)).toFixed(2));
  const wsHealthStr = workspaceHealthScore % 1 === 0 ? workspaceHealthScore.toFixed(1) : String(workspaceHealthScore);

  function getGradeTag(score) {
    if (score >= 95.0) return "[A+]";
    if (score >= 90.0) return "[A ]";
    if (score >= 85.0) return "[B+]";
    if (score >= 80.0) return "[B ]";
    if (score >= 75.0) return "[C+]";
    if (score >= 70.0) return "[C ]";
    if (score >= 60.0) return "[D ]";
    return "[F ]";
  }

  function getGradeFromScore(score) {
    return getGradeTag(score).replace("[", "").replace("]", "").trim();
  }

  const wsGrade = getGradeFromScore(workspaceHealthScore);

  const summary = {
    protocolVersion: "1.0.0",
    timestamp: new Date().toISOString(),
    gitRevision: (function() {
      try {
        const { execSync } = require("child_process");
        return execSync("git rev-parse --short HEAD", { cwd: rootDir, encoding: "utf8" }).trim().slice(0, 8);
      } catch (_) { return "00000000"; }
    })(),
    fastMode: process.argv[14] === "1",
    status: failed ? "FAIL" : "PASS",
    exitCode: failed ? 1 : 0,
    elapsedSeconds: Number(elapsedSec),
    workspaceHealthScore,
    compositeScore: workspaceHealthScore,
    grade: wsGrade,
    autonomyRate: autonomyRate != null ? Number(autonomyRate) : null,
    polyglotIndex: polyglotIndex != null ? Number(polyglotIndex) : null,
    totalDebt: totalDebt != null ? Number(totalDebt) : null,
    catalogRuleCount: catalogRuleCount || null,
    projects: {
      hygiene: statusHygiene,
      rulesCatalog: statusRules,
      autoRefactor: statusAr,
      workspaceTiming: statusWt,
      webGames: statusWg
    },
    projectScores: {
      hygiene: scoreHygiene,
      rulesCatalog: scoreRules,
      autoRefactor: scoreAr,
      workspaceTiming: scoreWt,
      webGames: scoreWg
    },
    arCompositeScore: compositeScore,
    tenDimensions,
    qualityVector
  };

  try {
    const { recordAuditRun } = require(path.join(rootDir, "scripts", "common", "record-workspace-audit.js"));
    recordAuditRun(summary);
  } catch (_) {}

  if (jsonMode) {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  }

  if (agentMode) {
    const subsystemsStatus = {
      hygiene: statusHygiene,
      rules: statusRules,
      autoRefactor: statusAr,
      workspaceTiming: statusWt,
      webGames: statusWg
    };
    const failedSubsystems = [];
    if (statusHygiene !== "PASS") failedSubsystems.push("hygiene");
    if (statusRules !== "PASS") failedSubsystems.push("rules");
    if (statusAr !== "PASS") failedSubsystems.push("auto-refactor");
    if (statusWt !== "PASS") failedSubsystems.push("workspace-timing");
    if (statusWg !== "PASS") failedSubsystems.push("WebGames");

    const envelope = {
      protocolVersion: "1.0.0",
      recordedAt: new Date().toISOString(),
      status: failed ? "FAIL" : "PASS",
      gate: "audit-all",
      exitCode: failed ? 1 : 0,
      summary: failed
        ? `Unified workspace review failed with violations in: ${failedSubsystems.join(", ")}.`
        : "All workspace quality checks passed across 5 core subsystems.",
      compositeHealth: workspaceHealthScore,
      grade: wsGrade,
      subsystems: subsystemsStatus,
      agentDirectives: {
        targetFiles: [],
        remediationPriority: failedSubsystems,
        verificationCommand: "bash scripts/sh/audit-all.sh --fast",
        fastRecheckCommand: "bash scripts/sh/audit-all.sh --fast"
      }
    };
    console.log(JSON.stringify(envelope, null, 2));
    process.exit(failed ? 1 : 0);
  }

  function isWide(code) {
    if (code >= 0x2500 && code <= 0x259f) return false;
    if (code >= 0x4e00 && code <= 0x9fff) return true;
    if (code >= 0x3400 && code <= 0x4dbf) return true;
    if (code >= 0x2e80 && code <= 0x2fff) return true;
    if (code >= 0xf900 && code <= 0xfaff) return true;
    if (code >= 0xff01 && code <= 0xff60) return true;
    if (code >= 0xffe0 && code <= 0xffe6) return true;
    if (code >= 0x20000 && code <= 0x2a6df) return true;
    if (code >= 0x1f300 && code <= 0x1f9ff) return true;
    if (code === 0x2705 || code === 0x274c) return true;
    return false;
  }

  function strWidth(str) {
    let w = 0;
    for (const ch of str) {
      const code = ch.codePointAt(0);
      w += isWide(code) ? 2 : 1;
    }
    return w;
  }

  function alignCell(text, width, align = "left") {
    const dw = strWidth(text);
    const pad = Math.max(0, width - dw);
    if (align === "right") {
      return " ".repeat(pad) + text;
    } else if (align === "center") {
      const left = Math.floor(pad / 2);
      const right = pad - left;
      return " ".repeat(left) + text + " ".repeat(right);
    }
    return text + " ".repeat(pad);
  }

  function formatDashboardRow(content = "", targetWidth = 71) {
    const dw = strWidth(content);
    const pad = Math.max(0, targetWidth - dw);
    return "│" + content + " ".repeat(pad) + "│";
  }

  function makeBar(score, blocks = 20) {
    const filled = Math.max(0, Math.min(blocks, Math.round((score / 100) * blocks)));
    const empty = blocks - filled;
    return "█".repeat(filled) + "░".repeat(empty);
  }

  const targetWidth = 71;
  const borderTop = "┌" + "─".repeat(targetWidth) + "┐";
  const borderMid = "├" + "─".repeat(targetWidth) + "┤";
  const borderBot = "└" + "─".repeat(targetWidth) + "┘";

  const sepTitle1 = "─ [全工作区五大核心子系统基石得分] ";
  const sep1 = "├" + sepTitle1 + "─".repeat(targetWidth - strWidth(sepTitle1)) + "┤";

  const sepTitle2 = "─ [auto-refactor 静态引擎十维工程质量全景指数] ";
  const sep2 = "├" + sepTitle2 + "─".repeat(targetWidth - strWidth(sepTitle2)) + "┤";

  console.log("");
  console.log(borderTop);
  const titleText = "全工作区统一工程审查与质量全景看板";
  const titlePad = Math.floor((targetWidth - strWidth(titleText)) / 2);
  console.log(formatDashboardRow(" ".repeat(titlePad) + titleText, targetWidth));
  console.log(borderMid);

  let polyglotIndex = null;
  try {
    if (fs.existsSync(baselineFile)) {
      const b = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
      const m = b.metrics || {};
      const polyData = b.polyglotGeneralization || m.polyglotGeneralization || null;
      if (polyData && polyData.index != null) polyglotIndex = Number(polyData.index);
    }
  } catch (_) {}
  if (polyglotIndex === null && scoreAr > 0 && scoreWg > 0) {
    const lScores = [scoreAr, scoreWg, 100.0];
    const lMean = (scoreAr + scoreWg + 100.0) / 3.0;
    const lVar = lScores.reduce((acc, s) => acc + Math.pow(s - lMean, 2), 0) / 3.0;
    const lStd = Math.sqrt(lVar);
    polyglotIndex = Math.round(lMean * Math.max(0.0, 1.0 - (lStd / 100.0)) * 100) / 100;
  }

  let summaryText = `综合健康分: ${wsHealthStr} (${wsGrade})`;
  if (autonomyRate != null) summaryText += ` | 自研率: ${Number(autonomyRate).toFixed(2)}%`;
  if (polyglotIndex != null) summaryText += ` | 语言均衡: ${Number(polyglotIndex).toFixed(2)}`;
  console.log(formatDashboardRow(" " + summaryText, targetWidth));

  console.log(sep1);

  const sysDefinitions = [
    { num: " 1.", name: "工作区物理卫生",   score: scoreHygiene, note: "(零空文件/同构)" },
    { num: " 2.", name: "单源规则目录",     score: scoreRules,   note: `(${catalogRuleCount}规则/SSOT)` },
    { num: " 3.", name: "auto-refactor",    score: scoreAr,      note: "(CLI静态引擎基线)" },
    { num: " 4.", name: "workspace-timing", score: scoreWt,      note: "(VSCode扩展门禁)" },
    { num: " 5.", name: "WebGames配置架构", score: scoreWg,      note: "(卡拉尔领域配置)" }
  ];

  for (const sys of sysDefinitions) {
    const bar = makeBar(sys.score, 20);
    const scoreStr = (Number.isInteger(sys.score) ? sys.score.toFixed(1) : String(Math.round(sys.score * 100) / 100)).padStart(6);
    const col1 = sys.num.padEnd(4);
    const col2 = alignCell(sys.name, 17);
    const col3 = bar;
    const col4 = scoreStr;
    const col5 = " " + sys.note;
    const rowContent = col1 + col2 + col3 + " " + col4 + col5;
    console.log(formatDashboardRow(rowContent, targetWidth));
  }

  console.log(sep2);

  const dimDefinitions = [
    { num: " 1.", name: "架构一致", key: "architectureConsistency", desc: "分层边界解耦", labelEn: "架构一致 (Architecture Consistency)" },
    { num: " 2.", name: "语义纯度", key: "semanticPurity", desc: "纯函数数据流", labelEn: "语义纯度 (Semantic Purity)" },
    { num: " 3.", name: "代码安全", key: "codeSecurity", desc: "输入安全防御", labelEn: "代码安全 (Code Security)" },
    { num: " 4.", name: "性能预算", key: "performanceEfficiency", desc: "零循环堆分配", labelEn: "性能预算 (Performance Efficiency)" },
    { num: " 5.", name: "标准化",   key: "standardization", desc: "命名契约标准", labelEn: "标准化 (Standardization)" },
    { num: " 6.", name: "现代化",   key: "modernity", desc: "现代语法API", labelEn: "现代化 (Modernity)" },
    { num: " 7.", name: "可维护性", key: "maintainability", desc: "控制流复杂度", labelEn: "可维护性 (Maintainability)" },
    { num: " 8.", name: "注释质量", key: "commentQuality", desc: "JSDoc契约完备", labelEn: "注释质量 (Comment Quality)" },
    { num: " 9.", name: "重复率",   key: "duplication", desc: "DRY原则去重", labelEn: "重复率 (Duplication)" },
    { num: "10.", name: "技术债风险", key: "techDebtRisk", desc: "零高危债务防线", labelEn: "技术债风险 (Tech Debt Risk)" }
  ];

  if (tenDimensions && compositeScore !== null) {
    for (const d of dimDefinitions) {
      const rawScore = tenDimensions[d.key];
      const parsedScore = Number(rawScore ?? 0);
      const isNotEvaluated = rawScore == null || isNaN(parsedScore) || parsedScore <= 0;
      let bar = " ".repeat(20);
      let scoreStr = "   N/A";
      let gradeTag = "[N/A]";
      if (!isNotEvaluated) {
        bar = makeBar(parsedScore, 20);
        scoreStr = (Number.isInteger(parsedScore) ? parsedScore.toFixed(1) : String(Math.round(parsedScore * 100) / 100)).padStart(6);
        gradeTag = getGradeTag(parsedScore);
      }
      const col1 = d.num.padEnd(4);
      const col2 = alignCell(d.name, 17);
      const col3 = bar;
      const col4 = scoreStr;
      const col5 = " " + gradeTag + " " + d.desc;
      const rowContent = col1 + col2 + col3 + " " + col4 + col5;
      console.log(formatDashboardRow(rowContent, targetWidth));
    }
  } else {
    console.log(formatDashboardRow(" [离线基线快照未就绪 - 优雅降级模式]", targetWidth));
  }

  console.log(borderMid);

  const globalStatus = failed ? "❌ 存在违规异常" : "✅ 全域健康达标";
  const bottomSummary = ` 耗时: ${elapsedSec}s${totalDebt !== null ? `  |  技术债: ${totalDebt}项` : ""}  |  全局状态: ${globalStatus}`;
  console.log(formatDashboardRow(bottomSummary, targetWidth));
  console.log(borderBot);
  console.log("💡 统一审查快照已落盘至: .audit-logs/audit-latest.json | audit-latest.md");
  console.log("💡 质量历史轨迹已追加至: .audit-logs/audit-history.jsonl");

  if (summaryFile) {
    const passBadge = (s) => (s === "PASS" ? "✅ PASS" : "❌ FAIL");
    let md = "## 🌐 全工作区跨项目统一审查与十维质量全景看板\n\n";
    const gStr = ` (Grade: **${wsGrade}**)`;
    const aStr = autonomyRate ? ` &nbsp;|&nbsp; **自研率**: **${autonomyRate}%**` : "";
    const pStr = polyglotIndex !== null ? ` &nbsp;|&nbsp; **语言均衡**: **${polyglotIndex}**` : "";
    const dStr = totalDebt !== null ? ` &nbsp;|&nbsp; **技术债总量**: **${totalDebt} 项**` : "";
    md += `> **综合健康分**: **${wsHealthStr}**${gStr}${aStr}${pStr}${dStr}\n\n`;
    md += "### 📊 全工作区五大核心子系统基石得分\n\n";
    md += "| 序号 | 核心子系统 | 判定结果 | 归一化得分 | 进度可视化 | 覆盖说明 |\n";
    md += "| :---: | :--- | :---: | :---: | :--- | :--- |\n";
    md += `| 1 | 工作区物理卫生 | ${passBadge(statusHygiene)} | ${scoreHygiene.toFixed(1)} | \`[${makeBar(scoreHygiene, 20)}]\` | 全仓零空文件/同构契约 |\n`;
    md += `| 2 | 单源规则目录 | ${passBadge(statusRules)} | ${scoreRules.toFixed(1)} | \`[${makeBar(scoreRules, 20)}]\` | ${catalogRuleCount}规则/SSOT一致性 |\n`;
    md += `| 3 | auto-refactor | ${passBadge(statusAr)} | ${scoreAr.toFixed(1)} | \`[${makeBar(scoreAr, 20)}]\` | CLI静态引擎质量基线 |\n`;
    md += `| 4 | workspace-timing | ${passBadge(statusWt)} | ${scoreWt.toFixed(1)} | \`[${makeBar(scoreWt, 20)}]\` | VSCode扩展审查门禁 |\n`;
    md += `| 5 | WebGames配置架构 | ${passBadge(statusWg)} | ${scoreWg.toFixed(1)} | \`[${makeBar(scoreWg, 20)}]\` | 卡拉尔领域配置审查 |\n\n`;
    md += `> **耗时**: ${elapsedSec}s &nbsp;|&nbsp; **全局状态**: ${globalStatus}\n\n`;

    md += "### 🎯 auto-refactor 静态引擎十维工程质量全景指数\n\n";
    if (tenDimensions && compositeScore !== null) {
      md += "| 序号 | 质量维度 | 得分 | 进度可视化 |\n";
      md += "| :---: | :--- | :---: | :--- |\n";
      for (const d of dimDefinitions) {
        const rawScore = tenDimensions[d.key];
        const parsedScore = Number(rawScore ?? 0);
        const isNotEvaluated = rawScore == null || isNaN(parsedScore) || parsedScore <= 0;
        let bar = " ".repeat(20);
        let scoreStr = "N/A";
        if (!isNotEvaluated) {
          bar = makeBar(parsedScore, 20);
          scoreStr = parsedScore % 1 === 0 ? parsedScore.toFixed(1) : String(Math.round(parsedScore * 100) / 100);
        }
        md += `| ${d.num.trim().replace(".", "")} | ${d.labelEn} | ${scoreStr} | \`[${bar}]\` |\n`;
      }
    } else {
      md += "> ⚠️ [离线基线快照未就绪 - 优雅降级模式]\n";
    }
    md += "\n";
    try {
      fs.appendFileSync(summaryFile, md, "utf8");
    } catch (_) {}
  }
' "$START_TIME" "$FAILED" "$JSON_MODE" "$STATUS_HYGIENE" "$STATUS_RULES" "$STATUS_AR" "$STATUS_WT" "$STATUS_WG" "$ROOT_DIR" "$CODE_EMPTY" "$CODE_ISO" "$CODE_CATALOG" "$CODE_SKILLS" "$FAST_MODE" "$AGENT_MODE"

if [[ "$JSON_MODE" -eq 1 || "$AGENT_MODE" -eq 1 ]]; then
    exit "$FAILED"
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
