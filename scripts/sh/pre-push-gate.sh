#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 本地推送前置门禁)
# 文件路径: scripts/sh/pre-push-gate.sh
# 架构定位: 本地 Git 推送前置全量回归与质量门禁 (Linux Bash)
# 依赖与触发: 触发方: 本地 CLI / CI 门禁 | 上游: 三项目专属门禁套件 | 下游: 远程主干分支 | 运行时: Bash 4+
# 职责说明: 执行推送前回归检查（智能影响分流、零空文件、规则目录、auto-refactor 回归、timing 审查、账本边界、WebGames 配置、流式提交历史审计，支持 Agent-Native 结构化输出）
# 退出语义与设计依据: 退出码: 0=通过检查, 1=存在未通过项阻断推送 | 设计依据: AGENTS.md 工作区治理总规
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/pre-push-gate.sh
#   bash scripts/sh/pre-push-gate.sh --agent
#   bash scripts/sh/pre-push-gate.sh --view-log
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
PYTHON_BIN=$(command -v python3.12 2>/dev/null || command -v python3 2>/dev/null || command -v python 2>/dev/null || command -v py 2>/dev/null || echo "python3")

AGENT_MODE=0
for arg in "$@"; do
    case "$arg" in
        --view-log|-v)
            exec "$NODE_BIN" "$ROOT_DIR/scripts/common/log-rotator.js" --view
            ;;
        --agent|-a|--json)
            AGENT_MODE=1
            ;;
    esac
done

if [[ "$AGENT_MODE" -eq 0 ]]; then
    echo "================================================================="
    echo "🔒 执行本地 Pre-Push 推送前回归检查 (Bash 版)"
    echo "================================================================="
fi

FAILED=0

AUDIT_LOG_DIR="$ROOT_DIR/.audit-logs"
mkdir -p "$AUDIT_LOG_DIR"
STEP_LOG="$AUDIT_LOG_DIR/pre-push-step.log"

get_step_rule_id() {
    local step_name="$1"
    if [[ "$step_name" =~ "Gate 1" ]]; then echo "HYG-EMP-001"; return; fi
    if [[ "$step_name" =~ "Gate 2" ]]; then echo "GATE-SSOT-001"; return; fi
    if [[ "$step_name" =~ Gate\ 3|auto-refactor ]]; then echo "RCFG-RULE-DRIFT"; return; fi
    if [[ "$step_name" =~ "Gate 4" ]]; then echo "GATE-BUDGET-001"; return; fi
    if [[ "$step_name" =~ "Gate 5" ]]; then echo "GATE-BUDGET-001"; return; fi
    if [[ "$step_name" =~ "Gate 6" ]]; then echo "RCFG-MATRIX"; return; fi
    if [[ "$step_name" =~ "Gate 7" ]]; then echo "ARCH-CFG-001"; return; fi
    if [[ "$step_name" =~ "Gate 8" ]]; then echo "ADV-CFG-001"; return; fi
    if [[ "$step_name" =~ "Gate 9" ]]; then echo "GATE-MSG-001"; return; fi
    echo "GATE-SYS-001"
}

log_gate() {
    if [[ "$AGENT_MODE" -eq 0 ]]; then
        echo "$@"
    fi
}

run_gate_step() {
    local timeout_sec="$1"
    local step_name="$2"
    local work_dir="$3"
    shift 3

    rm -f "$STEP_LOG"

    (cd "$work_dir" && "$@") > "$STEP_LOG" 2>&1 &
    local pid=$!

    local count=0
    while kill -0 "$pid" 2>/dev/null; do
        if [[ "$count" -ge "$timeout_sec" ]]; then
            if [[ "$AGENT_MODE" -eq 0 ]]; then
                echo "⚠️ $step_name 审查执行超时 (${timeout_sec}s，PID: $pid)，强制终止进程树..." >&2
            fi
            kill -9 "$pid" 2>/dev/null || true

            local timestamp
            timestamp=$(date +"%Y%m%d-%H%M%S")
            local safe_name
            safe_name=$(echo "$step_name" | tr ' /' '__' | tr '[:upper:]' '[:lower:]')
            local diag_file="$AUDIT_LOG_DIR/timeout-prepush-${safe_name}-${timestamp}.log"

            {
                echo "================================================================================"
                echo "⚠️ WATCHDOG TIMEOUT 诊断快照 (Pre-Push Gate Bash)"
                echo "================================================================================"
                echo "目标模块: $step_name"
                echo "工作目录: $work_dir"
                echo "进程 PID: $pid"
                echo "超时阈值: ${timeout_sec} 秒"
                echo "触发时间: $(date)"
                echo "处置措施: 看门狗已触发 kill -9 终止进程"
                echo "--------------------------------------------------------------------------------"
                echo "【最后捕获的标准输出与错误日志】:"
                if [[ -f "$STEP_LOG" ]]; then
                    tail -n 100 "$STEP_LOG"
                else
                    echo "(日志文件不存在或未捕获到输出)"
                fi
                echo "================================================================================"
            } > "$diag_file"
            if [[ "$AGENT_MODE" -eq 0 ]]; then
                echo "💡 超时诊断快照已落盘至: $diag_file" >&2
            fi
            "$NODE_BIN" "$ROOT_DIR/scripts/common/log-rotator.js" --prune >/dev/null 2>&1 || true
            return 124
        fi
        sleep 1
        count=$((count + 1))
    done

    local status=0
    wait "$pid" || status=$?
    if [[ "$status" -ne 0 ]]; then
        if [[ "$AGENT_MODE" -eq 0 ]]; then
            echo "❌ $step_name 失败 (退出码: $status)" >&2
            if [[ -f "$STEP_LOG" ]]; then
                echo "   --- 错误日志摘要 ---" >&2
                tail -n 20 "$STEP_LOG" | sed 's/^/   /' >&2
            fi
        fi
        local last_log="$AUDIT_LOG_DIR/last-pre-push.log"
        cp "$STEP_LOG" "$last_log" 2>/dev/null || true
        "$NODE_BIN" "$ROOT_DIR/scripts/common/log-rotator.js" --truncate "$last_log" >/dev/null 2>&1 || true
        local rule_id
        rule_id=$(get_step_rule_id "$step_name")
        cat <<EOF > "$AUDIT_LOG_DIR/last-failure.json" 2>/dev/null || true
{
  "protocolVersion": "1.0.0",
  "recordedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo 'unknown')",
  "status": "BLOCK",
  "gate": "pre-push",
  "step": "$step_name",
  "failedCommand": "$*",
  "exitCode": $status,
  "summary": "Step $step_name failed with exit code $status",
  "logFile": ".audit-logs/last-pre-push.log",
  "violations": [
    {
      "ruleId": "$rule_id",
      "severity": "BLOCK",
      "file": "$work_dir",
      "message": "Step $step_name failed with exit code $status",
      "verificationCommand": "$*"
    }
  ],
  "agentDirectives": {
    "targetFiles": ["$work_dir"],
    "remediationPriority": ["$rule_id"],
    "verificationCommand": "$*",
    "fastRecheckCommand": "bash scripts/sh/pre-push-gate.sh --agent"
  }
}
EOF
        return "$status"
    fi
    rm -f "$STEP_LOG" 2>/dev/null || true
    return 0
}

# --- 影响域智能分析 (Impact-driven Routing) ---
RANGE=""
if git rev-parse --verify @{u} >/dev/null 2>&1; then
    RANGE="@{u}..HEAD"
elif git rev-parse --verify origin/main >/dev/null 2>&1; then
    RANGE="origin/main..HEAD"
fi

TOUCHED_AR=0
TOUCHED_WT=0
TOUCHED_WG=0
TOUCHED_SHARED=0
PROJECT_COUNT=0

if [[ -n "$RANGE" ]]; then
    CHANGED_FILES=$(git diff --name-only "$RANGE" 2>/dev/null || true)
    if [[ -n "$CHANGED_FILES" ]]; then
        while IFS= read -r f; do
            [[ -z "$f" ]] && continue
            if [[ "$f" =~ ^auto-refactor/ ]]; then
                TOUCHED_AR=1
            elif [[ "$f" =~ ^workspace-timing/ ]]; then
                TOUCHED_WT=1
            elif [[ "$f" =~ ^WebGames/ ]]; then
                TOUCHED_WG=1
            else
                TOUCHED_SHARED=1
            fi
        done <<< "$CHANGED_FILES"
    fi
fi

PROJECT_COUNT=$((TOUCHED_AR + TOUCHED_WT + TOUCHED_WG))

RUN_ALL=0
if [[ -z "$RANGE" || "$TOUCHED_SHARED" -eq 1 || "$PROJECT_COUNT" -gt 1 || -z "${CHANGED_FILES:-}" ]]; then
    RUN_ALL=1
fi

RUN_AR=$([[ "$RUN_ALL" -eq 1 || "$TOUCHED_AR" -eq 1 ]] && echo 1 || echo 0)
RUN_WT=$([[ "$RUN_ALL" -eq 1 || "$TOUCHED_WT" -eq 1 ]] && echo 1 || echo 0)
RUN_WG=$([[ "$RUN_ALL" -eq 1 || "$TOUCHED_WG" -eq 1 ]] && echo 1 || echo 0)

if [[ "$RUN_ALL" -eq 1 ]]; then
    log_gate "ℹ️  检测到跨项目/共享治理改动或全量基准，执行全量门禁回归"
else
    ACTIVE_PROJ=()
    [[ "$RUN_AR" -eq 1 ]] && ACTIVE_PROJ+=("auto-refactor")
    [[ "$RUN_WT" -eq 1 ]] && ACTIVE_PROJ+=("workspace-timing")
    [[ "$RUN_WG" -eq 1 ]] && ACTIVE_PROJ+=("WebGames")
    log_gate "ℹ️  智能影响路由生效: 仅回归受影响项目 [$(IFS=', '; echo "${ACTIVE_PROJ[*]}") ]"
fi

# --- Gate 1: 全工作区零空文件、物理卫生、.gitignore 治理与五维代码密度守卫 ---
log_gate "[1/9] 校验全工作区零物理空文件、空白脚本、.gitignore 治理与五维代码密度守卫..."
GATE1_FAIL=0
run_gate_step 30 "Gate 1 (零物理空文件)" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-no-empty-files.js || GATE1_FAIL=1
run_gate_step 30 "Gate 1 (.gitignore 治理)" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-gitignore-governance.js || GATE1_FAIL=1
if [[ -n "$RANGE" ]]; then
    run_gate_step 30 "Gate 1 (五维代码密度)" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-code-density.js --range "$RANGE" || GATE1_FAIL=1
else
    run_gate_step 30 "Gate 1 (五维代码密度)" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-code-density.js || GATE1_FAIL=1
fi
if [[ "$GATE1_FAIL" -ne 0 ]]; then
    FAILED=1
else
    log_gate "  ✔ 全工作区零空文件、.gitignore 治理与五维代码密度校验通过"
fi

# --- Gate 2: 规则单源目录一致性同步 ---
log_gate "[2/9] 校验全工作区单源规则目录同步..."
if ! run_gate_step 30 "Gate 2 (单源规则目录)" "$ROOT_DIR" "$NODE_BIN" scripts/common/generate-rule-catalog.js --check-only; then
    FAILED=1
else
    log_gate "  ✔ 全工作区单源规则目录同步通过"
fi

# --- Gate 3: auto-refactor 引擎全量门禁与回归套件 ---
if [[ "$RUN_AR" -eq 1 ]]; then
    log_gate "[3/9] 执行 auto-refactor 全量门禁与回归套件 (Rust/Build/Self/Tests)..."
    AR_FAIL=0
    run_gate_step 60 "auto-refactor Rust Gate" "$ROOT_DIR/auto-refactor" "$NODE_BIN" scripts/gate-rust.js || AR_FAIL=1
    run_gate_step 90 "auto-refactor Build" "$ROOT_DIR/auto-refactor" "$NPM_BIN" run build || AR_FAIL=1
    run_gate_step 60 "auto-refactor Self Gate" "$ROOT_DIR/auto-refactor" "$NODE_BIN" scripts/gate-self.js || AR_FAIL=1
    run_gate_step 180 "auto-refactor Tests" "$ROOT_DIR/auto-refactor" "$NODE_BIN" scripts/test-parallel.js || AR_FAIL=1
    if [[ "$AR_FAIL" -ne 0 ]]; then
        log_gate "❌ Gate 3: auto-refactor 门禁或测试套件未通过"
        FAILED=1
    else
        log_gate "  ✔ auto-refactor 全量门禁与测试套件通过"
    fi
else
    log_gate "  ✔ [Gate 3] auto-refactor 未受影响，智能跳过全量门禁"
fi

# --- Gate 4: auto-refactor 多维自审与质量基线 ---
if [[ "$RUN_AR" -eq 1 ]]; then
    log_gate "[4/9] 执行 auto-refactor 质量基线与多维自审 (LOC预算/熵/密度/BIF)..."
    if ! run_gate_step 60 "Gate 4 (auto-refactor 质量基线)" "$ROOT_DIR/auto-refactor" "$NODE_BIN" scripts/validate-self-multidimensional-audit.js; then
        FAILED=1
    else
        log_gate "  ✔ auto-refactor 质量基线与自审达标"
    fi
else
    log_gate "  ✔ [Gate 4] auto-refactor 未受影响，智能跳过质量基线"
fi

# --- Gate 5: workspace-timing 快速单元测试套件 ---
if [[ "$RUN_WT" -eq 1 ]]; then
    log_gate "[5/9] 执行 workspace-timing 快速单元测试套件..."
    if ! run_gate_step 60 "Gate 5 (workspace-timing 快速单元测试)" "$ROOT_DIR/workspace-timing" "$NPM_BIN" run test:fast; then
        FAILED=1
    else
        log_gate "  ✔ workspace-timing 快速单元测试通过"
    fi
else
    log_gate "  ✔ [Gate 5] workspace-timing 未受影响，智能跳过单元测试"
fi

# --- Gate 6: workspace-timing L0~L5 六层审查门禁 ---
if [[ "$RUN_WT" -eq 1 ]]; then
    log_gate "[6/9] 执行 workspace-timing L0~L5 六层审查门禁..."
    if ! run_gate_step 60 "Gate 6 (workspace-timing 审查门禁)" "$ROOT_DIR/workspace-timing" "$NPM_BIN" run review; then
        FAILED=1
    else
        log_gate "  ✔ workspace-timing 审查门禁通过"
    fi
else
    log_gate "  ✔ [Gate 6] workspace-timing 未受影响，智能跳过审查门禁"
fi

# --- Gate 7: auto-refactor 长期轨迹账本物理约束守卫 ---
if [[ "$RUN_AR" -eq 1 ]]; then
    log_gate "[7/9] 校验 auto-refactor 长期轨迹账本物理约束 (<350B/条, <=2MB)..."
    if ! run_gate_step 30 "Gate 7 (长期轨迹账本约束)" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-trajectory-ledger.js; then
        FAILED=1
    else
        log_gate "  ✔ auto-refactor 长期轨迹账本物理约束通过"
    fi
else
    log_gate "  ✔ [Gate 7] 长期轨迹账本未受影响，智能跳过"
fi

# --- Gate 8: WebGames 配置架构与必需表一致性审查 ---
if [[ "$RUN_WG" -eq 1 ]]; then
    log_gate "[8/9] 执行 WebGames 全域质量门禁与配置架构审查..."
    if ! run_gate_step 60 "Gate 8 (WebGames 全域质量门禁)" "$ROOT_DIR" "$PYTHON_BIN" WebGames/scripts/py/audit_runner.py --diff; then
        FAILED=1
    else
        log_gate "  ✔ WebGames 全域质量门禁与配置架构审查通过"
    fi
else
    log_gate "  ✔ [Gate 8] WebGames 配置未受影响，智能跳过审查"
fi

# --- Gate 9: 待推送提交历史风格与禁词审查 (validate-commit-msg-style / validate-commit-msg) ---
if [[ -n "$RANGE" ]]; then
    log_gate "[9/9] 审查待推送提交历史风格与文本约束 (流式扫描: $RANGE)..."
    if ! run_gate_step 30 "Gate 9 (待推送提交历史风格与禁词审查)" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-commit-msg.js --range "$RANGE"; then
        FAILED=1
    else
        log_gate "  ✔ 待推送分支提交历史风格与文本约束校验通过"
    fi
else
    log_gate "  ✔ [Gate 9] 首次推送或无上游对比基准，跳过历史扫描"
fi

if [[ "$AGENT_MODE" -eq 1 ]]; then
    if [[ "$FAILED" -ne 0 ]]; then
        if [[ -f "$AUDIT_LOG_DIR/last-failure.json" ]]; then
            cat "$AUDIT_LOG_DIR/last-failure.json"
        fi
        exit 1
    else
        echo '{"protocolVersion":"1.0.0","status":"PASS","gate":"pre-push","summary":"All pre-push quality gates passed."}'
        exit 0
    fi
fi

echo "================================================================="
if [[ "$FAILED" -ne 0 ]]; then
    echo "❌ Pre-Push 检查未通过，已阻止推送至远程分支"
    echo "   请在本地修复上述失败项后重试推送。"
    echo "💡 失败诊断快照已保留至: .audit-logs/last-pre-push.log"
    echo "   (可运行 bash scripts/sh/pre-push-gate.sh --view-log 快速查看)"
    echo "   (Agent 消费模式: bash scripts/sh/pre-push-gate.sh --agent)"
    echo "================================================================="
    exit 1
else
    echo "✅ Pre-Push 检查通过，允许推送至远程"
    echo "================================================================="
    exit 0
fi
