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
#   bash scripts/sh/pre-push-gate.sh --json
#   bash scripts/sh/pre-push-gate.sh --view-log
# ==============================================================================
set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT_DIR" || exit 1

# 步骤身份、环境隔离与工具探测由共享运行时库提供，禁止在各门禁内复制实现。
GATE_ROOT_DIR="$ROOT_DIR"
# shellcheck source=scripts/sh/lib/gate-runtime.sh
. "$ROOT_DIR/scripts/sh/lib/gate-runtime.sh"
gate_init_git_isolation "$ROOT_DIR"
gate_resolve_runtime_bins

AGENT_MODE=0
VIEW_LOG=0
PUSHED_SHA=""
REMOTE_SHA=""
REFS_FILE=""
ALLOW_BYPASS=0
STAGGERED_PUSH=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h|-Help)
            echo "用法: bash scripts/sh/pre-push-gate.sh [--agent] [--json] [--view-log] [--staggered-push] [--help]"
            echo "层级流向: 常规推送走 Tier 1 (本地 pre-commit / pre-push) -> Tier 2 (CI)；Tier 1.5 云端预测试机由 --staggered-push 或手工 bash scripts/sh/remote-sandbox-test.sh --slice staged 触发。"
            exit 0
            ;;
        --agent|-a|-Agent|--json|-j|-Json)
            AGENT_MODE=1
            shift
            ;;
        --view-log|-v|-ViewLog)
            VIEW_LOG=1
            shift
            ;;
        --pushed-sha)
            if [[ $# -lt 2 ]]; then
                echo "✖ BLOCK  参数 $1 缺少值。" >&2
                exit 1
            fi
            PUSHED_SHA="$2"
            shift 2
            ;;
        --remote-sha)
            if [[ $# -lt 2 ]]; then
                echo "✖ BLOCK  参数 $1 缺少值。" >&2
                exit 1
            fi
            REMOTE_SHA="$2"
            shift 2
            ;;
        --refs-file)
            if [[ $# -lt 2 ]]; then
                echo "✖ BLOCK  参数 $1 缺少值。" >&2
                exit 1
            fi
            REFS_FILE="$2"
            shift 2
            ;;
        --allow-bypass)
            ALLOW_BYPASS=1
            shift
            ;;
        --staggered-push)
            STAGGERED_PUSH=1
            shift
            ;;
        *)
            shift
            ;;
    esac
done

if [[ -z "$NODE_BIN" ]]; then
    echo "✖ BLOCK  未检测到 Node.js 运行时，推送前门禁无法执行。" >&2
    exit 1
fi

if [[ "$VIEW_LOG" -eq 1 ]]; then
    exec "$NODE_BIN" "$ROOT_DIR/scripts/common/log-rotator.js" --view
fi

if [[ -z "$NPM_BIN" ]]; then
    echo "✖ BLOCK  未检测到 npm 包管理器，推送前门禁无法执行。" >&2
    exit 1
fi

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
trap 'rm -f "$STEP_LOG" 2>/dev/null || true' EXIT

# 步骤身份、显示序号与规则归因只来自单源登记表（scripts/common/gate-step-registry.json）。
# 未知标识直接阻断，绝不静默回落到合成标识：静默回落会把真实失败归因到错误的规则上。
GATE_SUPPRESS="$AGENT_MODE"
gate_init pre-push

# 兼容既有调用点：门禁正文统一使用 log_gate 作为抑制式输出别名。
log_gate() {
    gate_log "$@"
}

record_prepush_failure() {
    local step_id="$1"
    local title="$2"
    local rule_id="$3"
    local status="$4"
    local target_dir="$5"
    local src_log="$6"
    local cmd_str="$7"

    local last_log="$AUDIT_LOG_DIR/last-pre-push.log"
    if [[ -n "$src_log" && -f "$src_log" ]]; then
        cp "$src_log" "$last_log" 2>/dev/null || true
        "$NODE_BIN" "$ROOT_DIR/scripts/common/log-rotator.js" --truncate "$last_log" >/dev/null 2>&1 || true
    fi
    gate_write_failure_envelope \
        --gate pre-push \
        --step-id "$step_id" \
        --step-title "$title" \
        --rule-id "$rule_id" \
        --exit-code "$status" \
        --run-id "$RUN_ID" \
        --command "$cmd_str" \
        --summary "Step $step_id ($title) failed with exit code $status" \
        --verify-cmd "$cmd_str" \
        --fast-recheck "bash scripts/sh/pre-push-gate.sh --agent" \
        --target-file "$target_dir" \
        --log-file ".audit-logs/last-pre-push.log" >/dev/null 2>&1 || true
}

run_gate_step() {
    local step_id="$1"
    local work_dir="$2"
    shift 2

    local row rule_id title timeout_sec
    row=$(get_step_meta "$step_id") || exit 1
    rule_id=$(cut -f3 <<< "$row")
    title=$(cut -f4 <<< "$row")
    timeout_sec=$(get_step_timeout "$step_id" 60)

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
            if [[ "$AGENT_MODE" -eq 0 && -f "$STEP_LOG" ]]; then
                printf '   --- 错误日志摘要 ---\n' >&2
                tail -n 20 "$STEP_LOG" | sed 's/^/   /' >&2
            fi
            write_step_verdict "$step_id" BLOCK "退出码 $status"
        fi
        record_prepush_failure "$step_id" "$title" "$rule_id" "$status" "$work_dir" "$STEP_LOG" "$*"
        return "$status"
    fi
    rm -f "$STEP_LOG" 2>/dev/null || true
    write_step_verdict "$step_id" PASS ""
    return 0
}

run_guard_batch() {
    local group_name="$1"
    local batch_log_dir tsv_out guard_exit=0 batch_failed=0
    batch_log_dir=$(mktemp -d 2>/dev/null || mktemp -d -t 'prepush-guards')
    tsv_out=$("$NODE_BIN" "$ROOT_DIR/scripts/common/run-workspace-guards.js" --group "$group_name" --tsv --log-dir "$batch_log_dir") || guard_exit=$?

    if [[ -z "$tsv_out" ]]; then
        local fallback_step="FEEDBACK-VOCABULARY-23"
        [[ "$group_name" == "prepush-rules" ]] && fallback_step="RULE-CATALOG-04"
        local row rule_id title err_code=1
        row=$(get_step_meta "$fallback_step") || { rm -rf "$batch_log_dir" 2>/dev/null || true; exit 1; }
        rule_id=$(cut -f3 <<< "$row")
        title=$(cut -f4 <<< "$row")
        [[ "$guard_exit" -ne 0 ]] && err_code="$guard_exit"
        record_prepush_failure "$fallback_step" "$title" "$rule_id" "$err_code" "$ROOT_DIR" "" "node scripts/common/run-workspace-guards.js --group $group_name"
        write_step_verdict "$fallback_step" BLOCK "守卫批处理异常 (退出码 $err_code)"
        rm -rf "$batch_log_dir" 2>/dev/null || true
        return 1
    fi

    local step_id guard_id exit_code dur_ms cmd log_file
    while IFS=$'\t' read -r step_id guard_id exit_code dur_ms cmd log_file; do
        [[ -z "$step_id" ]] && continue
        write_step_banner "$step_id"
        if [[ "$exit_code" -eq 0 ]]; then
            write_step_verdict "$step_id" PASS ""
        else
            batch_failed=1
            if [[ "$AGENT_MODE" -eq 0 && -n "$log_file" && -f "$log_file" ]]; then
                printf '   --- 错误日志摘要 (%s) ---\n' "$guard_id" >&2
                tail -n 20 "$log_file" | sed 's/^/   /' >&2
            fi
            local row rule_id title
            row=$(get_step_meta "$step_id") || { rm -rf "$batch_log_dir" 2>/dev/null || true; exit 1; }
            rule_id=$(cut -f3 <<< "$row")
            title=$(cut -f4 <<< "$row")
            record_prepush_failure "$step_id" "$title" "$rule_id" "$exit_code" "$ROOT_DIR" "$log_file" "$cmd"
            write_step_verdict "$step_id" BLOCK "退出码 $exit_code"
        fi
    done <<< "$tsv_out"

    rm -rf "$batch_log_dir" 2>/dev/null || true
    [[ "$guard_exit" -ne 0 ]] && batch_failed=1
    return "$batch_failed"
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
RUN_ALL=1
RUN_AR=1
RUN_WT=1
RUN_WG=1
RUN_FG=1
CHANGED_COUNT=0

IMPACT_ARGS=("$ROOT_DIR/scripts/common/impact-slice-map.js" --resolve-range)
if [[ -n "$RANGE" ]]; then
    IMPACT_ARGS+=("$RANGE")
fi
IMPACT_ARGS+=(--kv)

IMPACT_STATUS=0
IMPACT_KV=$("$NODE_BIN" "${IMPACT_ARGS[@]}" 2>/dev/null) || IMPACT_STATUS=$?
if [[ "$IMPACT_STATUS" -ne 0 || -z "$IMPACT_KV" ]]; then
    echo "✖ BLOCK  无法枚举推送范围 '$RANGE' 的变更文件 (退出码 ${IMPACT_STATUS})。" >&2
    exit 1
fi

while IFS='=' read -r k v; do
    case "$k" in
        CHANGED_COUNT) CHANGED_COUNT="$v" ;;
        TOUCHED_AR) TOUCHED_AR="$v" ;;
        TOUCHED_WT) TOUCHED_WT="$v" ;;
        TOUCHED_WG) TOUCHED_WG="$v" ;;
        TOUCHED_FG) TOUCHED_FG="$v" ;;
        TOUCHED_SHARED) TOUCHED_SHARED="$v" ;;
        PROJECT_COUNT) PROJECT_COUNT="$v" ;;
        RUN_ALL) RUN_ALL="$v" ;;
        RUN_AR) RUN_AR="$v" ;;
        RUN_WT) RUN_WT="$v" ;;
        RUN_WG) RUN_WG="$v" ;;
        RUN_FG) RUN_FG="$v" ;;
    esac
done <<< "$IMPACT_KV"

HEAD_SHA=$(git rev-parse HEAD 2>/dev/null || true)
IS_HISTORICAL_PUSH=0
if [[ -n "$PUSHED_SHA" && -n "$HEAD_SHA" && "$PUSHED_SHA" != "$HEAD_SHA" ]]; then
    IS_HISTORICAL_PUSH=1
fi
IS_STAGGERED=$([[ "${STAGGERED_PUSH:-0}" -eq 1 || "${GATE_STAGGERED_PUSH:-0}" -eq 1 || "$IS_HISTORICAL_PUSH" -eq 1 ]] && echo 1 || echo 0)

if [[ "$IS_STAGGERED" -eq 1 ]]; then
    log_gate "ℹ️  检测到错峰/历史提交推进 (目标: $PUSHED_SHA)，仅审计待推送范围与收据契约"
    write_step_verdict "WORKSPACE-PHYSICAL-01" SKIP "错峰历史推进跳过工作区巡检"
    write_step_verdict "WORKSPACE-GITIGNORE-02" SKIP "错峰历史推进跳过工作区巡检"

    if [[ -n "$RANGE" ]]; then
        run_gate_step "WORKSPACE-DENSITY-03" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-code-density.js --range "$RANGE" || FAILED=1
    else
        run_gate_step "WORKSPACE-DENSITY-03" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-code-density.js || FAILED=1
    fi

    write_step_verdict "RULE-CATALOG-04" SKIP "错峰历史推进跳过工作区规则同步"
    write_step_verdict "RULE-CLOSURE-05" SKIP "错峰历史推进跳过工作区规则闭包"
    write_step_verdict "DOCS-CONSISTENCY-06" SKIP "错峰历史推进跳过工作区文档一致性"
    write_step_verdict "RULE-REACHABILITY-07" SKIP "错峰历史推进跳过工作区规则可达性"

    write_step_verdict "ENGINE-RUST-08" SKIP "错峰历史推进跳过工作区引擎编译"
    write_step_verdict "ENGINE-BUILD-09" SKIP "错峰历史推进跳过工作区引擎构建"
    write_step_verdict "ENGINE-FACADE-10" SKIP "错峰历史推进跳过工作区门面承载"
    write_step_verdict "ENGINE-SELF-11" SKIP "错峰历史推进跳过工作区引擎自审"
    write_step_verdict "ENGINE-TESTS-12" SKIP "错峰历史推进跳过工作区回归套件"
    write_step_verdict "ENGINE-BASELINE-13" SKIP "错峰历史推进跳过工作区质量基线"

    write_step_verdict "EXTENSION-TESTS-14" SKIP "错峰历史推进跳过工作区扩展回归"
    write_step_verdict "EXTENSION-REVIEW-15" SKIP "错峰历史推进跳过工作区扩展审查"
    write_step_verdict "LEDGER-CONSTRAINT-16" SKIP "错峰历史推进跳过工作区账本约束"
    write_step_verdict "DOMAIN-AUDIT-17" SKIP "错峰历史推进跳过工作区领域审计"
    write_step_verdict "DOMAIN-MERMAID-18" SKIP "错峰历史推进跳过工作区图谱校验"
    write_step_verdict "RUST-TAXIS-19" SKIP "错峰历史推进跳过工作区Rust套件"

    run_gate_step "COMMIT-CONTRACT-20" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-commit-guardrail.js || FAILED=1

    if [[ -n "$RANGE" ]]; then
        run_gate_step "COMMIT-HISTORY-21" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-commit-msg.js --range "$RANGE" || FAILED=1
        run_gate_step "CHANGE-ENTROPY-22" "$ROOT_DIR" "$NODE_BIN" scripts/common/evaluate-change-entropy.js --range "$RANGE" --fail-on-diffusion || FAILED=1
    else
        write_step_verdict "COMMIT-HISTORY-21" SKIP "无上游对比基准"
        write_step_verdict "CHANGE-ENTROPY-22" SKIP "无推送范围"
    fi

    write_step_verdict "FEEDBACK-VOCABULARY-23" SKIP "错峰历史推进跳过工作区词汇守卫"
    write_step_verdict "GATE-ORDERING-24" SKIP "错峰历史推进跳过工作区门禁排序"
    write_step_verdict "GATE-PROOF-25" SKIP "错峰历史推进跳过工作区门禁自证"
    write_step_verdict "GATE-COVERAGE-26" SKIP "错峰历史推进跳过工作区判定覆盖"
    write_step_verdict "GATE-COUNT-27" SKIP "错峰历史推进跳过工作区规模计数"
    write_step_verdict "GATE-CHAIN-28" SKIP "错峰历史推进跳过工作区块链合法性"
    write_step_verdict "DOC-METRICS-29" SKIP "错峰历史推进跳过工作区指标同步"
    write_step_verdict "SHELL-PARITY-30" SKIP "错峰历史推进跳过工作区命令面契约"
    write_step_verdict "SUBAGENT-CATALOG-31" SKIP "错峰历史推进跳过工作区专员注册表"
    write_step_verdict "DOC-ANCHORS-32" SKIP "错峰历史推进跳过工作区跨文档引用"
    write_step_verdict "METRIC-COVERAGE-33" SKIP "错峰历史推进跳过工作区指标覆盖"
    write_step_verdict "FAMILY-CONTRACT-34" SKIP "错峰历史推进跳过工作区规则族契约"
    write_step_verdict "DOC-REACH-35" SKIP "错峰历史推进跳过工作区文档可达性"
    write_step_verdict "COMMIT-HISTORY-BASELINE-36" SKIP "错峰历史推进跳过工作区冻结清单审查"
    write_step_verdict "RULE-SOURCE-37" SKIP "错峰历史推进跳过工作区规则源码校验"
    write_step_verdict "DESTRUCTIVE-OPS-38" SKIP "错峰历史推进跳过工作区破坏性操作审查"

    REFS_LINE_COUNT=0
    if [[ -n "$REFS_FILE" && -f "$REFS_FILE" ]]; then
        REFS_LINE_COUNT=$(grep -c '[^[:space:]]' "$REFS_FILE" 2>/dev/null || echo 0)
    fi
    if [[ "$REFS_LINE_COUNT" -gt 0 ]]; then
        run_gate_step "REF-SAFETY-39" "$ROOT_DIR" "$NODE_BIN" scripts/common/gate-receipts.js verify-refs --refs-file "$REFS_FILE" || FAILED=1

        RECEIPT_ARGS=(scripts/common/gate-receipts.js verify-receipts --refs-file "$REFS_FILE")
        [[ "$ALLOW_BYPASS" -eq 1 ]] && RECEIPT_ARGS+=(--allow-bypass)
        run_gate_step "RECEIPT-AUDIT-40" "$ROOT_DIR" "$NODE_BIN" "${RECEIPT_ARGS[@]}" || FAILED=1
    else
        write_step_verdict "REF-SAFETY-39" SKIP "无推送 refs 输入（手动执行门禁）"
        write_step_verdict "RECEIPT-AUDIT-40" SKIP "无推送 refs 输入（手动执行门禁）"
    fi

    write_step_verdict "CASCADE-COHERENCE-41" SKIP "错峰历史推进跳过工作区协同闭合"
    write_step_verdict "ENGINE-FORMAT-42" SKIP "错峰历史推进跳过工作区格式校验"
    write_step_verdict "ENGINE-LINT-43" SKIP "错峰历史推进跳过工作区静态代码检查"
    write_step_verdict "ENGINE-COMMENTS-44" SKIP "错峰历史推进跳过工作区注释契约"
    write_step_verdict "ENGINE-REDUNDANCY-45" SKIP "错峰历史推进跳过工作区冗余治理"
else
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
run_gate_step "WORKSPACE-PHYSICAL-01" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-physical-hygiene.js || GATE1_FAIL=1
run_gate_step "WORKSPACE-GITIGNORE-02" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-gitignore-governance.js || GATE1_FAIL=1
if [[ -n "$RANGE" ]]; then
    run_gate_step "WORKSPACE-DENSITY-03" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-code-density.js --range "$RANGE" || GATE1_FAIL=1
else
    run_gate_step "WORKSPACE-DENSITY-03" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-code-density.js || GATE1_FAIL=1
fi
if [[ "$GATE1_FAIL" -ne 0 ]]; then
    FAILED=1
else
    log_gate "  ✔ 全工作区零空文件、.gitignore 治理与五维代码密度校验通过"
fi

# --- 单源规则目录与引用闭包 (有界并发批处理) ---
if ! run_guard_batch "prepush-rules"; then
    FAILED=1
else
    log_gate "  ✔ 全工作区单源规则目录同步与规则 ID 闭包校验通过"
fi

# --- auto-refactor 引擎全量门禁与回归套件 ---
if [[ "$RUN_AR" -eq 1 ]]; then
    # 每个步骤由 run_gate_step 自行产出 PASS/BLOCK：聚合判定会让「哪一步失败」丢失。
    AR_STEPS=(
        "ENGINE-RUST-08|scripts/gate-rust.js"
        "ENGINE-BUILD-09|run build"
        "ENGINE-FACADE-10|scripts/validate-facade-governance.js"
        "ENGINE-SELF-11|scripts/gate-self.js"
        "ENGINE-TESTS-12|scripts/test-parallel.js"
    )
    AR_FAIL=0
    for spec in "${AR_STEPS[@]}"; do
        IFS='|' read -r ar_id ar_cmd <<< "$spec"
        if [[ "$ar_cmd" == "run build" ]]; then
            run_gate_step "$ar_id" "$ROOT_DIR/auto-refactor" "$NPM_BIN" run build || AR_FAIL=1
        else
            run_gate_step "$ar_id" "$ROOT_DIR/auto-refactor" "$NODE_BIN" "$ar_cmd" || AR_FAIL=1
        fi
    done
    if [[ "$AR_FAIL" -ne 0 ]]; then
        FAILED=1
    fi
else
    write_step_verdict "ENGINE-RUST-08" SKIP "auto-refactor 未受影响"
    write_step_verdict "ENGINE-BUILD-09" SKIP "auto-refactor 未受影响"
    write_step_verdict "ENGINE-FACADE-10" SKIP "auto-refactor 未受影响"
    write_step_verdict "ENGINE-SELF-11" SKIP "auto-refactor 未受影响"
    write_step_verdict "ENGINE-TESTS-12" SKIP "auto-refactor 未受影响"
fi

# --- auto-refactor 多维自审与质量基线 ---
if [[ "$RUN_AR" -eq 1 ]]; then
    if ! run_gate_step "ENGINE-BASELINE-13" "$ROOT_DIR/auto-refactor" "$NODE_BIN" scripts/validate-self-multidimensional-audit.js; then
        FAILED=1
    else
        log_gate "  ✔ auto-refactor 质量基线与自审达标"
    fi
else
    write_step_verdict "ENGINE-BASELINE-13" SKIP "auto-refactor 未受影响"
fi

# --- workspace-timing 快速单元测试套件 ---
if [[ "$RUN_WT" -eq 1 ]]; then
    if ! run_gate_step "EXTENSION-TESTS-14" "$ROOT_DIR/workspace-timing" "$NPM_BIN" run test:fast; then
        FAILED=1
    else
        log_gate "  ✔ workspace-timing 快速单元测试通过"
    fi
else
    write_step_verdict "EXTENSION-TESTS-14" SKIP "workspace-timing 未受影响"
fi

# --- workspace-timing 六层审查门禁 ---
if [[ "$RUN_WT" -eq 1 ]]; then
    if ! run_gate_step "EXTENSION-REVIEW-15" "$ROOT_DIR/workspace-timing" "$NPM_BIN" run review; then
        FAILED=1
    else
        log_gate "  ✔ workspace-timing 审查门禁通过"
    fi
else
    write_step_verdict "EXTENSION-REVIEW-15" SKIP "workspace-timing 未受影响"
fi

# --- auto-refactor 长期轨迹账本物理约束 ---
if [[ "$RUN_AR" -eq 1 ]]; then
    if ! run_gate_step "LEDGER-CONSTRAINT-16" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-trajectory-ledger.js; then
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
    run_gate_step "DOMAIN-AUDIT-17" "$ROOT_DIR" "$PYTHON_BIN" WebGames/scripts/py/audit_runner.py --diff || GATE8_FAIL=1
    # Mermaid 图由真实解析器校验（audit_docs 的字符启发式无法发现语法破损）；
    # 该步骤此前无任何调用方，导致 349 张图的解析能力长期悬空。
    if [[ -f "$ROOT_DIR/WebGames/scripts/sh/check-mermaid.sh" ]]; then
        run_gate_step "DOMAIN-MERMAID-18" "$ROOT_DIR" bash WebGames/scripts/sh/check-mermaid.sh || GATE8_FAIL=1
    else
        write_step_verdict "DOMAIN-MERMAID-18" BLOCK "WebGames/scripts/sh/check-mermaid.sh 缺失，Mermaid 真解析无法执行"
        GATE8_FAIL=1
    fi
    if [[ "$GATE8_FAIL" -ne 0 ]]; then
        FAILED=1
    fi
else
    write_step_verdict "DOMAIN-AUDIT-17" SKIP "WebGames 未受影响"
    write_step_verdict "DOMAIN-MERMAID-18" SKIP "WebGames 未受影响"
fi

# --- fractal-git Rust 门禁 (rustfmt + clippy -D warnings + zero-alloc + test) ---
if [[ "$RUN_FG" -eq 1 ]]; then
    if [[ -z "$CARGO_BIN" ]]; then
        # 缺少原生工具链时不得静默放行：未执行审查与审查通过必须可区分 (GUARD-SYS-001)。
        write_step_verdict "RUST-TAXIS-19" BLOCK "未检测到 cargo 工具链，fractal-git 回归套件无法执行"
        FAILED=1
    elif [[ -f "$ROOT_DIR/fractal-git/scripts/sh/gate-rust.sh" ]]; then
        if ! run_gate_step "RUST-TAXIS-19" "$ROOT_DIR" bash fractal-git/scripts/sh/gate-rust.sh; then
            FAILED=1
        else
            log_gate "  ✔ fractal-git Rust 工业级门禁通过（格式/静态/分配/回归）"
        fi
    else
        if ! run_gate_step "RUST-TAXIS-19" "$ROOT_DIR" "$CARGO_BIN" test --workspace --manifest-path fractal-git/Cargo.toml; then
            FAILED=1
        else
            log_gate "  ✔ fractal-git 10大内核子系统回归测试套件通过（未检测到 gate-rust.sh，仅执行 cargo test）"
        fi
    fi
else
    write_step_verdict "RUST-TAXIS-19" SKIP "fractal-git 未受影响"
fi

# --- 待推送提交历史风格与禁词审查 ---
# 提交信息词法、风格仲裁与债务走廊契约自测：基础件一旦回归，下方历史扫描结论即失去依据
if ! run_gate_step "COMMIT-CONTRACT-20" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-commit-guardrail.js; then
    FAILED=1
fi
if [[ -n "$RANGE" ]]; then
    if ! run_gate_step "COMMIT-HISTORY-21" "$ROOT_DIR" "$NODE_BIN" scripts/common/validate-commit-msg.js --range "$RANGE"; then
        FAILED=1
    else
        log_gate "  ✔ 待推送分支提交历史风格与文本约束校验通过"
    fi
else
    write_step_verdict "COMMIT-HISTORY-21" SKIP "无上游对比基准"
fi

# --- CHANGE-ENTROPY-22: 推送集变更熵与跨域扩散审查 (GUARD-ENT-001) ---
if [[ -n "$RANGE" ]]; then
    if ! run_gate_step "CHANGE-ENTROPY-22" "$ROOT_DIR" "$NODE_BIN" scripts/common/evaluate-change-entropy.js --range "$RANGE" --fail-on-diffusion; then
        FAILED=1
    else
        log_gate "  ✔ 推送集变更熵在凝聚阈值内"
    fi
else
    write_step_verdict "CHANGE-ENTROPY-22" SKIP "无推送范围"
fi

# --- 门禁自证与全工作区治理守卫 (有界并发批处理) ---
if ! run_guard_batch "prepush-governance"; then
    FAILED=1
fi

# 推送 ref 安全性：删除受保护分支与历史改写必须在联网前拦截。
# 无 refs 输入时显式写 SKIP，绝不静默零判定（静默零判定会让步骤看似执行过）。
if [[ -n "$REFS_FILE" && -f "$REFS_FILE" && -s "$REFS_FILE" ]]; then
    if ! run_gate_step "REF-SAFETY-39" "$ROOT_DIR" "$NODE_BIN" scripts/common/gate-receipts.js verify-refs --refs-file "$REFS_FILE"; then
        FAILED=1
    fi
else
    write_step_verdict "REF-SAFETY-39" SKIP "无推送 refs 输入（手动执行门禁）"
fi

# 门禁收据审计：每个待推送提交都必须持有本地门禁收据。
# --no-verify 提交在这里被识别为 bypass 并留痕；显式 --allow-bypass 才放行，且写入 bypass.log。
if [[ -n "$REFS_FILE" && -f "$REFS_FILE" && -s "$REFS_FILE" ]]; then
    RECEIPT_ARGS=(scripts/common/gate-receipts.js verify-receipts --refs-file "$REFS_FILE")
    if [[ "$ALLOW_BYPASS" -eq 1 ]]; then
        RECEIPT_ARGS+=(--allow-bypass)
    fi
    if ! run_gate_step "RECEIPT-AUDIT-40" "$ROOT_DIR" "$NODE_BIN" "${RECEIPT_ARGS[@]}"; then
        FAILED=1
    fi
else
    write_step_verdict "RECEIPT-AUDIT-40" SKIP "无推送 refs 输入（手动执行门禁）"
fi

# 四方闭合：技能注册表、原型技能清单、专员模板与 DSH 写路径策略各自自洽却互相矛盾的缺陷，
# 任何单点校验都看不见，必须交叉比对。
if ! run_gate_step "CASCADE-COHERENCE-41" "$ROOT_DIR" "$NODE_BIN" .agents/skills/subagent-orchestration/scripts/validate-cascade-coherence.js; then
    FAILED=1
fi

if [[ "$RUN_AR" -eq 1 ]]; then
    run_gate_step "ENGINE-FORMAT-42" "$ROOT_DIR/auto-refactor" "$NPM_BIN" run format:check || FAILED=1
    run_gate_step "ENGINE-LINT-43" "$ROOT_DIR/auto-refactor" "$NPM_BIN" run lint || FAILED=1
    run_gate_step "ENGINE-COMMENTS-44" "$ROOT_DIR/auto-refactor" "$NODE_BIN" scripts/gate-comments.js || FAILED=1
    run_gate_step "ENGINE-REDUNDANCY-45" "$ROOT_DIR/auto-refactor" "$NODE_BIN" scripts/validate-redundancy-governance.js || FAILED=1
else
    write_step_verdict "ENGINE-FORMAT-42" SKIP "auto-refactor 未受影响"
    write_step_verdict "ENGINE-LINT-43" SKIP "auto-refactor 未受影响"
    write_step_verdict "ENGINE-COMMENTS-44" SKIP "auto-refactor 未受影响"
    write_step_verdict "ENGINE-REDUNDANCY-45" SKIP "auto-refactor 未受影响"
fi
fi

if [[ "$AGENT_MODE" -eq 1 ]]; then
    if [[ "$FAILED" -ne 0 ]]; then
        if [[ -f "$AUDIT_LOG_DIR/last-failure.json" ]]; then
            cat "$AUDIT_LOG_DIR/last-failure.json"
        fi
        exit 1
    else
        complete_gate_telemetry PASS "$CHANGED_COUNT" "" pre-push
        echo '{"protocolVersion":"1.0.0","status":"PASS","gate":"pre-push","summary":"All pre-push quality gates passed."}'
        exit 0
    fi
fi

echo "================================================================="
if [[ "$FAILED" -ne 0 ]]; then
    LAST_LOG="$AUDIT_LOG_DIR/last-pre-push.log"
    RAW_LOG=""
    [[ -f "$LAST_LOG" ]] && RAW_LOG=$(cat "$LAST_LOG" 2>/dev/null || true)
    complete_gate_telemetry BLOCK "$CHANGED_COUNT" "$RAW_LOG" pre-push

    echo "✖ Pre-Push 检查未通过，已阻止推送至远程分支"
    echo "   请在本地修复上述失败项后重试推送。"
    echo "💡 失败诊断快照已保留至: .audit-logs/last-pre-push.log"
    echo "   (可运行 bash scripts/sh/pre-push-gate.sh --view-log 快速查看)"
    echo "   (Agent 消费模式: bash scripts/sh/pre-push-gate.sh --agent)"
    echo "================================================================="
    exit 1
else
    complete_gate_telemetry PASS "$CHANGED_COUNT" "" pre-push
    echo "✔ Pre-Push 检查通过，允许推送至远程"
    echo "================================================================="
    exit 0
fi
