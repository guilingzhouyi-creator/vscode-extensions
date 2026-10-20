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
CARGO_BIN=$(command -v cargo 2>/dev/null || command -v cargo.exe 2>/dev/null || echo "")

AGENT_MODE=0
PUSHED_SHA=""
REMOTE_SHA=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --pushed-sha) PUSHED_SHA="${2:-}"; shift 2 ;;
        --remote-sha) REMOTE_SHA="${2:-}"; shift 2 ;;
        *) break ;;
    esac
done

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
RUN_ID="$(date -u +%s 2>/dev/null || echo 0)-$$"

if [[ "$AGENT_MODE" -eq 1 ]]; then
    rm -f "$ROOT_DIR/.audit-logs/last-failure.json" 2>/dev/null || true
fi

AUDIT_LOG_DIR="$ROOT_DIR/.audit-logs"
mkdir -p "$AUDIT_LOG_DIR"
# 步骤日志必须按进程隔离：两个并发门禁共用同一路径会让 rm 失败并吞掉真实诊断输出。
STEP_LOG="$AUDIT_LOG_DIR/pre-push-step-$$.log"

# 步骤身份、显示序号与规则归因只来自单源登记表（scripts/common/gate-step-registry.json）。
# 未知标识直接阻断，绝不静默回落到合成标识：静默回落会把真实失败归因到错误的规则上。
# 步骤身份、四态判定与超时诊断由共享运行时库提供，禁止在各门禁内复制实现。
GATE_ROOT_DIR="$ROOT_DIR"
GATE_NODE_BIN="$NODE_BIN"
GATE_SUPPRESS="$AGENT_MODE"
# shellcheck source=scripts/sh/lib/gate-runtime.sh
. "$ROOT_DIR/scripts/sh/lib/gate-runtime.sh"
gate_init pre-push

# 兼容既有调用点：门禁正文统一使用 log_gate 作为抑制式输出别名。
log_gate() {
    gate_log "$@"
}
run_gate_step() {
    local timeout_sec="$1"
    local step_id="$2"
    local work_dir="$3"
    shift 3

    local row rule_id title
    row=$(get_step_meta "$step_id") || exit 1
    rule_id=$(cut -f3 <<< "$row")
    title=$(cut -f4 <<< "$row")

    write_step_banner "$step_id"

    rm -f "$STEP_LOG" 2>/dev/null || true

    (cd "$work_dir" && "$@") > "$STEP_LOG" 2>&1 &
    local pid=$!

    local status=0
    wait_with_timeout "$pid" "$timeout_sec" "$step_id" "$STEP_LOG" "timeout-prepush" || status=$?
    if [[ "$status" -ne 0 ]]; then
        if [[ "$status" -eq 124 ]]; then
            write_step_verdict "$step_id" BLOCK "执行超时（阈值 ${timeout_sec}s）"
        else
            if [[ "$AGENT_MODE" -eq 0 ]]; then
                if [[ -f "$STEP_LOG" ]]; then
                    printf '   --- 错误日志摘要 ---\n' >&2
                    tail -n 20 "$STEP_LOG" | sed 's/^/   /' >&2
                fi
            fi
            write_step_verdict "$step_id" BLOCK "退出码 $status"
        fi
        local last_log="$AUDIT_LOG_DIR/last-pre-push.log"
        cp "$STEP_LOG" "$last_log" 2>/dev/null || true
        "$NODE_BIN" "$ROOT_DIR/scripts/common/log-rotator.js" --truncate "$last_log" >/dev/null 2>&1 || true
        cat <<EOF > "$AUDIT_LOG_DIR/last-failure.json" 2>/dev/null || true
{
  "protocolVersion": "1.0.0",
  "runId": "$RUN_ID",
  "recordedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo 'unknown')",
  "status": "BLOCK",
  "gate": "pre-push",
  "step": "$step_id",
  "stepTitle": "$title",
  "stepId": "$step_id",
  "failedCommand": "$*",
  "exitCode": $status,
  "summary": "Step $step_id ($title) failed with exit code $status",
  "logFile": ".audit-logs/last-pre-push.log",
  "violations": [
    {
      "ruleId": "$rule_id",
      "severity": "BLOCK",
      "file": "$work_dir",
      "message": "Step $step_id ($title) failed with exit code $status",
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
    write_step_verdict "$step_id" PASS ""
    return 0
}

# --- 影响域智能分析 (Impact-driven Routing) ---
RANGE=""
if [[ "$PUSHED_SHA" =~ ^[0-9a-f]{7,40}$ ]]; then
    if [[ "$REMOTE_SHA" =~ ^[0-9a-f]{7,40}$ && ! "$REMOTE_SHA" =~ ^0+$ ]]; then
        RANGE="$REMOTE_SHA..$PUSHED_SHA"
    else
        MERGE_BASE=$(git merge-base "$PUSHED_SHA" origin/main 2>/dev/null || true)
        if [[ -n "$MERGE_BASE" ]]; then
            RANGE="$MERGE_BASE..$PUSHED_SHA"
        else
            RANGE="$PUSHED_SHA~1..$PUSHED_SHA"
        fi
    fi
elif git rev-parse --verify '@{u}' >/dev/null 2>&1; then
    RANGE="@{u}..HEAD"
elif git rev-parse --verify origin/main >/dev/null 2>&1; then
    RANGE="origin/main..HEAD"
fi

TOUCHED_AR=0
TOUCHED_WT=0
TOUCHED_WG=0
TOUCHED_FG=0
TOUCHED_SHARED=0
PROJECT_COUNT=0

if [[ -n "$RANGE" ]]; then
    # 范围不可枚举时必须阻断：静默回落成空列表会让影响域分析把"git 失败"读成"无变更"，
    # 进而以 RUN_ALL 掩盖掉一次没有真正执行的差分。
    CHANGED_STATUS=0
    CHANGED_FILES=$(git diff --name-only "$RANGE" 2>/dev/null) || CHANGED_STATUS=$?
    if [[ "${CHANGED_STATUS}" -ne 0 ]]; then
        echo "✖ BLOCK  无法枚举推送范围 '$RANGE' 的变更文件 (退出码 ${CHANGED_STATUS})。" >&2
        exit 1
    fi
    if [[ -n "$CHANGED_FILES" ]]; then
        while IFS= read -r f; do
            [[ -z "$f" ]] && continue
            if [[ "$f" =~ ^auto-refactor/ ]]; then
                TOUCHED_AR=1
            elif [[ "$f" =~ ^workspace-timing/ ]]; then
                TOUCHED_WT=1
            elif [[ "$f" =~ ^WebGames/ ]]; then
                TOUCHED_WG=1
            elif [[ "$f" =~ ^fractal-git/ ]]; then
                TOUCHED_FG=1
            else
                TOUCHED_SHARED=1
            fi
        done <<< "$CHANGED_FILES"
    fi
fi

PROJECT_COUNT=$((TOUCHED_AR + TOUCHED_WT + TOUCHED_WG + TOUCHED_FG))

RUN_ALL=0
if [[ -z "$RANGE" || "$TOUCHED_SHARED" -eq 1 || "$PROJECT_COUNT" -gt 1 || -z "${CHANGED_FILES:-}" ]]; then
    RUN_ALL=1
fi

RUN_AR=$([[ "$RUN_ALL" -eq 1 || "$TOUCHED_AR" -eq 1 ]] && echo 1 || echo 0)
RUN_WT=$([[ "$RUN_ALL" -eq 1 || "$TOUCHED_WT" -eq 1 ]] && echo 1 || echo 0)
RUN_WG=$([[ "$RUN_ALL" -eq 1 || "$TOUCHED_WG" -eq 1 ]] && echo 1 || echo 0)
RUN_FG=$([[ "$RUN_ALL" -eq 1 || "$TOUCHED_FG" -eq 1 ]] && echo 1 || echo 0)

if [[ "$RUN_ALL" -eq 1 ]]; then
    log_gate "ℹ️  检测到跨项目/共享治理改动或全量基准，执行全量门禁回归"
else
    ACTIVE_PROJ=()
    [[ "$RUN_AR" -eq 1 ]] && ACTIVE_PROJ+=("auto-refactor")
    [[ "$RUN_WT" -eq 1 ]] && ACTIVE_PROJ+=("workspace-timing")
    [[ "$RUN_WG" -eq 1 ]] && ACTIVE_PROJ+=("WebGames")
    [[ "$RUN_FG" -eq 1 ]] && ACTIVE_PROJ+=("fractal-git")
    log_gate "ℹ️  智能影响路由生效: 仅回归受影响项目 [$(IFS=', '; echo "${ACTIVE_PROJ[*]}") ]"
fi

# --- 工作区物理卫生与体积守卫 ---
GATE1_FAIL=0
run_gate_step 30 "WORKSPACE-PHYSICAL-01" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-physical-hygiene.js || GATE1_FAIL=1
run_gate_step 30 "WORKSPACE-GITIGNORE-02" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-gitignore-governance.js || GATE1_FAIL=1
if [[ -n "$RANGE" ]]; then
    run_gate_step 30 "WORKSPACE-DENSITY-03" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-code-density.js --range "$RANGE" || GATE1_FAIL=1
else
    run_gate_step 30 "WORKSPACE-DENSITY-03" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-code-density.js || GATE1_FAIL=1
fi
if [[ "$GATE1_FAIL" -ne 0 ]]; then
    FAILED=1
else
    log_gate "  ✔ 全工作区零空文件、.gitignore 治理与五维代码密度校验通过"
fi

# --- 单源规则目录与引用闭包 ---
if ! run_gate_step 30 "RULE-CATALOG-04" "$ROOT_DIR" "$NODE_BIN" scripts/common/generate-rule-catalog.js --check-only; then
    FAILED=1
elif ! run_gate_step 30 "RULE-CLOSURE-05" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-rule-id-closure.js; then
    FAILED=1
elif ! run_gate_step 30 "DOCS-CONSISTENCY-06" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-docs-consistency.js; then
    FAILED=1
elif ! run_gate_step 60 "RULE-REACHABILITY-07" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-rule-reachability.js; then
    FAILED=1
else
    log_gate "  ✔ 全工作区单源规则目录同步与规则 ID 闭包校验通过"
fi

# --- auto-refactor 引擎全量门禁与回归套件 ---
if [[ "$RUN_AR" -eq 1 ]]; then
    # 每个步骤由 run_gate_step 自行产出 PASS/BLOCK：聚合判定会让「哪一步失败」丢失。
    AR_STEPS=(
        "60|ENGINE-RUST-08|scripts/gate-rust.js"
        "90|ENGINE-BUILD-09|run build"
        "60|ENGINE-FACADE-10|scripts/validate-facade-governance.js"
        "60|ENGINE-SELF-11|scripts/gate-self.js"
        "180|ENGINE-TESTS-12|scripts/test-parallel.js"
    )
    AR_FAIL=0
    for spec in "${AR_STEPS[@]}"; do
        IFS='|' read -r ar_to ar_id ar_cmd <<< "$spec"
        if [[ "$ar_cmd" == "run build" ]]; then
            run_gate_step "$ar_to" "$ar_id" "$ROOT_DIR/auto-refactor" "$NPM_BIN" run build || AR_FAIL=1
        else
            run_gate_step "$ar_to" "$ar_id" "$ROOT_DIR/auto-refactor" "$NODE_BIN" "$ar_cmd" || AR_FAIL=1
        fi
    done
    if [[ "$AR_FAIL" -ne 0 ]]; then
        FAILED=1
    fi
else
    write_step_verdict "ENGINE-RUST-08" SKIP "auto-refactor 未受影响"
fi

# --- auto-refactor 多维自审与质量基线 ---
if [[ "$RUN_AR" -eq 1 ]]; then
        if ! run_gate_step 60 "ENGINE-BASELINE-13" "$ROOT_DIR/auto-refactor" "$NODE_BIN" scripts/validate-self-multidimensional-audit.js; then
        FAILED=1
    else
        log_gate "  ✔ auto-refactor 质量基线与自审达标"
    fi
else
    write_step_verdict "ENGINE-BASELINE-13" SKIP "auto-refactor 未受影响"
fi

# --- workspace-timing 快速单元测试套件 ---
if [[ "$RUN_WT" -eq 1 ]]; then
        if ! run_gate_step 60 "EXTENSION-TESTS-14" "$ROOT_DIR/workspace-timing" "$NPM_BIN" run test:fast; then
        FAILED=1
    else
        log_gate "  ✔ workspace-timing 快速单元测试通过"
    fi
else
    write_step_verdict "EXTENSION-TESTS-14" SKIP "workspace-timing 未受影响"
fi

# --- workspace-timing 六层审查门禁 ---
if [[ "$RUN_WT" -eq 1 ]]; then
        if ! run_gate_step 60 "EXTENSION-REVIEW-15" "$ROOT_DIR/workspace-timing" "$NPM_BIN" run review; then
        FAILED=1
    else
        log_gate "  ✔ workspace-timing 审查门禁通过"
    fi
else
    write_step_verdict "EXTENSION-REVIEW-15" SKIP "workspace-timing 未受影响"
fi

# --- auto-refactor 长期轨迹账本物理约束 ---
if [[ "$RUN_AR" -eq 1 ]]; then
        if ! run_gate_step 30 "LEDGER-CONSTRAINT-16" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-trajectory-ledger.js; then
        FAILED=1
    else
        log_gate "  ✔ auto-refactor 长期轨迹账本物理约束通过"
    fi
else
    write_step_verdict "LEDGER-CONSTRAINT-16" SKIP "账本未受影响"
fi

# --- WebGames 配置架构与必需表一致性 ---
if [[ "$RUN_WG" -eq 1 ]]; then
        GATE8_FAIL=0
    run_gate_step 60 "DOMAIN-AUDIT-17" "$ROOT_DIR" "$PYTHON_BIN" WebGames/scripts/py/audit_runner.py --diff || GATE8_FAIL=1
    # Mermaid 图由真实解析器校验（audit_docs 的字符启发式无法发现语法破损）；
    # 该步骤此前无任何调用方，导致 349 张图的解析能力长期悬空。
    if [[ -f "$ROOT_DIR/WebGames/scripts/sh/check-mermaid.sh" ]]; then
        run_gate_step 120 "DOMAIN-MERMAID-18" "$ROOT_DIR" bash WebGames/scripts/sh/check-mermaid.sh || GATE8_FAIL=1
    else
        write_step_verdict "DOMAIN-MERMAID-18" BLOCK "WebGames/scripts/sh/check-mermaid.sh 缺失，Mermaid 真解析无法执行"
        GATE8_FAIL=1
    fi
    if [[ "$GATE8_FAIL" -ne 0 ]]; then
        FAILED=1
    fi
else
    write_step_verdict "DOMAIN-AUDIT-17" SKIP "WebGames 未受影响"
fi

# --- fractal-git Rust 门禁 (rustfmt + clippy -D warnings + zero-alloc + test) ---
if [[ "$RUN_FG" -eq 1 ]]; then
    if [[ -z "$CARGO_BIN" ]]; then
        # 缺少原生工具链时不得静默放行：未执行审查与审查通过必须可区分 (GUARD-SYS-001)。
        write_step_verdict "RUST-TAXIS-19" BLOCK "未检测到 cargo 工具链，fractal-git 回归套件无法执行"
    elif [[ -f "$ROOT_DIR/fractal-git/scripts/sh/gate-rust.sh" ]]; then
        if ! run_gate_step 300 "RUST-TAXIS-19" "$ROOT_DIR" bash fractal-git/scripts/sh/gate-rust.sh; then
            FAILED=1
        else
            log_gate "  ✔ fractal-git Rust 工业级门禁通过（格式/静态/分配/回归）"
        fi
    else
        if ! run_gate_step 120 "RUST-TAXIS-19" "$ROOT_DIR" "$CARGO_BIN" test --manifest-path fractal-git/Cargo.toml; then
            FAILED=1
        else
            log_gate "  ✔ fractal-git 9大微 Crate 回归测试套件通过（未检测到 gate-rust.sh，仅执行 cargo test）"
        fi
    fi
else
    write_step_verdict "RUST-TAXIS-19" SKIP "fractal-git 未受影响"
fi

# --- 待推送提交历史风格与禁词审查 ---
# 提交信息词法、风格仲裁与债务走廊契约自测：基础件一旦回归，下方历史扫描结论即失去依据
if ! run_gate_step 30 "COMMIT-CONTRACT-20" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-commit-guardrail.js; then
    FAILED=1
fi
if [[ -n "$RANGE" ]]; then
        if ! run_gate_step 30 "COMMIT-HISTORY-21" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-commit-msg.js --range "$RANGE"; then
        FAILED=1
    else
        log_gate "  ✔ 待推送分支提交历史风格与文本约束校验通过"
    fi
else
    write_step_verdict "COMMIT-HISTORY-21" SKIP "无上游对比基准"
fi

# --- CHANGE-ENTROPY-22: 推送集变更熵与跨域扩散审查 (GUARD-ENT-001) ---
if [[ -n "$RANGE" ]]; then
    if ! run_gate_step 30 "CHANGE-ENTROPY-22" "$ROOT_DIR" "$NODE_BIN" scripts/common/evaluate-change-entropy.js --range "$RANGE" --fail-on-diffusion; then
        FAILED=1
    else
        log_gate "  ✔ 推送集变更熵在凝聚阈值内"
    fi
else
    write_step_verdict "CHANGE-ENTROPY-22" SKIP "无推送范围"
fi

# --- FEEDBACK-VOCABULARY-23: 反馈词表语义化与四态状态词闭包 (GUARD-FBK-001) ---
# 该步骤扫描全部门禁脚本，故置于末位：此前的步骤若引入新的词元，必须在本步被拦截。
if ! run_gate_step 30 "FEEDBACK-VOCABULARY-23" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-gate-feedback.js; then
    FAILED=1
else
    log_gate "  ✔ 门禁反馈词表为语义步骤标识与四态状态词闭包"
fi

# --- GATE-ORDERING-24: 门禁助手定义先于调用与判定词表闭包 (GUARD-ORD-001) ---
# 该守卫读取步骤登记表枚举入口脚本，故置于末位：新增入口会自动纳入审查。
if ! run_gate_step 30 "GATE-ORDERING-24" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-gate-ordering.js; then
    FAILED=1
else
    log_gate "  ✔ 门禁助手定义顺序与判定词表闭包通过"
fi

# 守卫的检出能力必须自证：仅靠干净代码上的退出码无法区分「探测器工作」与「探测器从不触发」。
if ! run_gate_step 60 "GATE-PROOF-25" "$ROOT_DIR" "$NODE_BIN" scripts/common/test-gate-guards.js; then
    FAILED=1
fi

# 步骤判定覆盖守卫：登记表中的每个步骤都必须在两个平台可达且能呈现终态判定。
if ! run_gate_step 30 "GATE-COVERAGE-26" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-gate-verdicts.js; then
    FAILED=1
fi

# 规模计数真实性：成功信息里的数字必须来自实测，写死的常量会静默过期。
if ! run_gate_step 30 "GATE-COUNT-27" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-hardcoded-counts.js; then
    FAILED=1
fi

# 块链分支合法性：重复的 else 分支解析器不报错，只在运行时于该行失败。
if ! run_gate_step 30 "GATE-CHAIN-28" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-block-chains.js; then
    FAILED=1
fi

# 文档规模数字真源渲染：治理文档里的规则数、步骤数、技能数必须与真源一致，禁止手写过期字面量。
if ! run_gate_step 30 "DOC-METRICS-29" "$ROOT_DIR" "$NODE_BIN" scripts/common/sync-doc-metrics.js; then
    FAILED=1
fi
# Linux 命令面契约：AGENTS.md 承诺的每个命令都必须真实可绑定，且兼容层同时具备 GNU 与降级两条路径。
if ! run_gate_step 60 "SHELL-PARITY-30" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-shell-parity.js; then
    FAILED=1
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
