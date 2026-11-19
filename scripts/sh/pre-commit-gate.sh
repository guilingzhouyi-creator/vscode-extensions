#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 本地提交前置门禁)
# 文件路径: scripts/sh/pre-commit-gate.sh
# 架构定位: 本地 Git 提交前置物理卫生与质量安全门禁 (Linux Bash)
# 依赖与触发: 触发方: .githooks/pre-commit / 本地 CLI 手动触发 | 上游: git commit | 下游: 提交暂存区 | 运行时: Bash 4+
# 职责说明: 执行提交前物理卫生与质量安全检查（挂载 gate-fast-staged.js 极速流式验证、规则漂移熔断、精准增量编译、AST 局部切片，支持 Agent/JSON 结构化输出）
# 退出语义与设计依据: 退出码: 0=通过门禁, 1=存在卫生或质量违规阻断 | 设计依据: AGENTS.md 跨项目全局通用契约
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/pre-commit-gate.sh
#   bash scripts/sh/pre-commit-gate.sh --agent
#   bash scripts/sh/pre-commit-gate.sh --json
#   bash scripts/sh/pre-commit-gate.sh --help
# ==============================================================================
set -euo pipefail

AGENT_MODE=0
FAST_MODE=0
VIEW_LOG=0
for arg in "$@"; do
    case "$arg" in
        --help|-h|-Help)
            echo "用法: bash scripts/sh/pre-commit-gate.sh [--agent] [--json] [--fast] [--view-log] [--help]"
            echo "选项:"
            echo "  --agent, -a, -Agent      以 Agent-Native JSON 信封格式输出校验结果"
            echo "  --json, -j, -Json        以 JSON 格式输出校验结果 (与 --agent 等价)"
            echo "  --fast, -f, -Fast        快速模式标记"
            echo "  --view-log, -v, -ViewLog 查看最近一次失败日志"
            echo "  --help, -h, -Help        显示此帮助信息"
            exit 0
            ;;
        --view-log|-v|-ViewLog) VIEW_LOG=1 ;;
        --agent|-a|-Agent|--json|-j|-Json) AGENT_MODE=1 ;;
        --fast|-f|-Fast) FAST_MODE=1 ;;
    esac
done

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT_DIR" || exit 1

# 步骤身份、环境隔离与工具探测由共享运行时库提供，禁止在各门禁内复制实现。
GATE_ROOT_DIR="$ROOT_DIR"
# shellcheck source=scripts/sh/lib/gate-runtime.sh
. "$ROOT_DIR/scripts/sh/lib/gate-runtime.sh"
gate_init_git_isolation "$ROOT_DIR"
gate_resolve_runtime_bins

if [[ -z "$NODE_BIN" ]]; then
    echo "✖ BLOCK  未检测到 Node.js 运行时，提交前门禁无法执行。" >&2
    echo "   修复: 安装 Node.js 20+ 并确保 'node' 在 PATH 中。" >&2
    echo "   该门禁为 fail-closed：缺少运行时不得静默放行 (GUARD-SYS-001)。" >&2
    exit 1
fi

if [[ "$VIEW_LOG" -eq 1 ]]; then
    exec "$NODE_BIN" "$ROOT_DIR/scripts/common/log-rotator.js" --view
fi

if [[ -z "$NPM_BIN" ]]; then
    echo "✖ BLOCK  未检测到 npm 包管理器，提交前门禁无法执行增量编译校验。" >&2
    echo "   修复: 随 Node.js 一并安装 npm，并确保 'npm' 在 PATH 中。" >&2
    exit 1
fi

STEP_LOG=$(mktemp)
STREAM_OUT=""
trap 'rm -f "$STEP_LOG" ${STREAM_OUT:+"$STREAM_OUT"}' EXIT

RUN_ID="$(date -u +%s 2>/dev/null || echo 0)-$$"
GATE_SUPPRESS="$AGENT_MODE"
gate_init pre-commit

log_gate() {
    gate_log "$@"
}

record_pre_commit_failure() {
    local step_name="$1"
    local rule_id="$2"
    local summary="$3"
    local actionable_fix="$4"
    local verify_cmd="$5"
    local target_file="${6:-}"
    local details="${7:-}"
    if [[ -z "$details" && -f "$STEP_LOG" ]]; then
        details=$(cat "$STEP_LOG" 2>/dev/null || true)
    fi

    # 步骤身份只来自单源登记表：未登记标识直接阻断，绝不回落到合成标识。
    local step_meta step_id step_title
    step_meta=$(get_step_meta "$step_name") || exit 1
    step_id=$(cut -f2 <<< "$step_meta")
    step_title=$(cut -f4 <<< "$step_meta")

    local diag_dir="$ROOT_DIR/.audit-logs"
    mkdir -p "$diag_dir" 2>/dev/null || true
    local fail_log="$diag_dir/last-pre-commit.log"
    {
        echo "================================================================="
        echo "❌ Pre-Commit 门禁拦截现场快照"
        echo "时间: $(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo 'unknown')"
        echo "步骤: $step_id ($rule_id)"
        echo "说明: $summary"
        if [[ -n "$details" ]]; then
            echo "-----------------------------------------------------------------"
            echo "$details"
        fi
        echo "================================================================="
    } > "$fail_log" 2>/dev/null || true

    local -a env_args=(
        --gate pre-commit --step-id "$step_id" --step-title "$step_title" --rule-id "$rule_id"
        --exit-code 1 --run-id "$RUN_ID" --command "$verify_cmd" --summary "$summary"
        --actionable-fix "$actionable_fix" --verify-cmd "$verify_cmd"
        --fast-recheck "bash scripts/sh/pre-commit-gate.sh --agent"
        --log-file ".audit-logs/last-pre-commit.log"
    )
    [[ -n "$target_file" ]] && env_args+=(--target-file "$target_file")
    gate_write_failure_envelope "${env_args[@]}" >/dev/null 2>&1 || true
}

fail_pre_commit_step() {
    local step_id="$1" rule_id="$2" summary="$3" actionable_fix="$4" verify_cmd="$5" target_file="${6:-}"
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        record_pre_commit_failure "$step_id" "$rule_id" "$summary" "$actionable_fix" "$verify_cmd" "$target_file"
        cat "$ROOT_DIR/.audit-logs/last-failure.json"
        exit 1
    fi
    tail -n 15 "$STEP_LOG" 2>/dev/null | sed 's/^/   /' || true
    FAILED=1
    return 1
}

run_pre_commit_check() {
    local step_id="$1" rule_id="$2" work_dir="$3" summary="$4" actionable_fix="$5" verify_cmd="$6" target_file="$7"
    shift 7
    if (cd "$work_dir" && "$@") >"$STEP_LOG" 2>&1; then
        return 0
    fi
    fail_pre_commit_step "$step_id" "$rule_id" "$summary" "$actionable_fix" "$verify_cmd" "$target_file"
}

report_streaming_step() {
    local step_id="$1" rule_id="$2" status="$3" summary="$4" detail="$5" target_file="$6"
    if [[ "$status" == "PASS" ]]; then
        return 0
    fi
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        record_pre_commit_failure "$step_id" "$rule_id" "${summary:-${step_id} 审查未通过或未产出数据 (Fail-Closed)}" \
            "${detail:-Run node scripts/common/gate-differential-bounds.js --stream}" \
            "bash scripts/sh/pre-commit-gate.sh --fast" "$target_file" "$detail"
        cat "$ROOT_DIR/.audit-logs/last-failure.json"
        exit 1
    fi
    FAILED=1
    return 1
}

# 根目录物理防污染与散落脚本前置雷达
ROOT_CLUTTER=$(find "$ROOT_DIR" -maxdepth 1 -type f \( -name "*.log" -o -name "*.tmp" -o -name "*.bak" -o -name "*.actual.json" -o -name "*.js" -o -name "*.ts" -o -name "*.py" -o -name "*.sh" -o -name "*.ps1" -o -name "*.bat" -o -name "*.cmd" \) ! -name ".*" 2>/dev/null || true)
if [[ -n "$ROOT_CLUTTER" ]]; then
    FIRST_BAD=$(echo "$ROOT_CLUTTER" | head -n 1)
    BAD_NAME=$(basename "$FIRST_BAD")
    IS_SCRIPT=0
    case "$BAD_NAME" in
        *.js|*.ts|*.py|*.sh|*.ps1|*.bat|*.cmd) IS_SCRIPT=1 ;;
    esac
    if [[ "$IS_SCRIPT" -eq 1 ]]; then
        RULE_ID="EXT-DIR-001"
        SUMMARY="Root directory contains loose code script '$BAD_NAME', violating Extension-is-Domain rule (EXT-DIR-001)."
        ACTIONABLE_FIX="Move '$BAD_NAME' into scripts/common/, scripts/ps1/, scripts/sh/, or <project>/scripts/py/."
    else
        RULE_ID="HYG-CLT-001"
        SUMMARY="Transient log or clutter file '$BAD_NAME' detected in repository root (HYG-CLT-001)."
        ACTIONABLE_FIX="Delete root temporary file '$BAD_NAME' or run 'node scripts/common/validate-physical-hygiene.js --fix'."
    fi
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        record_pre_commit_failure "STAGED-HYGIENE-01" "$RULE_ID" "$SUMMARY" "$ACTIONABLE_FIX" "node scripts/common/validate-physical-hygiene.js" "$BAD_NAME"
        cat "$ROOT_DIR/.audit-logs/last-failure.json"
        exit 1
    fi
    write_step_verdict "STAGED-HYGIENE-01" BLOCK "根目录存在散落脚本或未受控临时脏文件: $BAD_NAME"
    echo "   $ACTIONABLE_FIX"
    exit 1
fi

# 获取当前暂存区中的文件列表；不可读时 fail-closed，不得回落为空列表。
STAGED_STATUS=0
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null) || STAGED_STATUS=$?
if [[ "${STAGED_STATUS}" -ne 0 ]]; then
    echo "✖ BLOCK  无法读取 Git 暂存区 (git diff --cached 退出码 ${STAGED_STATUS})，pre-commit 不得在未审查的情况下放行。" >&2
    exit 1
fi

if [[ -z "$STAGED_FILES" ]]; then
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        echo '{"protocolVersion":"1.0.0","status":"PASS","gate":"pre-commit","summary":"No staged files to check."}'
        exit 0
    fi
    echo "ℹ️  暂存区无文件变更，跳过 pre-commit 检查。"
    exit 0
fi

if [[ "$AGENT_MODE" -eq 0 ]]; then
    echo "================================================================="
    MODE_TAG=""
    [[ "$FAST_MODE" -eq 1 ]] && MODE_TAG=" [快速模式 --fast]"
    echo "🔒 执行本地 Pre-Commit 质量安全与物理卫生检查${MODE_TAG}"
    echo "================================================================="
fi

FAILED=0
[[ "$AGENT_MODE" -eq 1 ]] && rm -f "$ROOT_DIR/.audit-logs/last-failure.json" 2>/dev/null || true

# --- 暂存区流式物理卫生与安全审查 ---
write_step_banner "STAGED-HYGIENE-01"
if [[ "$AGENT_MODE" -eq 1 ]]; then
    if ! "$NODE_BIN" scripts/common/gate-fast-staged.js --agent >/dev/null 2>&1; then
        [[ -f "$ROOT_DIR/.audit-logs/last-failure.json" ]] && cat "$ROOT_DIR/.audit-logs/last-failure.json"
        exit 1
    fi
    write_step_verdict "STAGED-HYGIENE-01" PASS "暂存区物理卫生与安全审查通过"
elif ! "$NODE_BIN" scripts/common/gate-fast-staged.js; then
    write_step_verdict "STAGED-HYGIENE-01" BLOCK "暂存区物理卫生与安全审查未通过"
    FAILED=1
else
    write_step_verdict "STAGED-HYGIENE-01" PASS "暂存区物理卫生与安全审查通过"
fi

# --- 单源规则漂移熔断 ---
if echo "$STAGED_FILES" | grep -qE "auto-refactor/src/core/rules/|auto-refactor/src/analyzers/"; then
    write_step_banner "RULE-REGISTRY-02"
    if run_pre_commit_check "RULE-REGISTRY-02" "RCFG-RULE-DRIFT" "$ROOT_DIR/auto-refactor" "Auto-refactor rule registry metadata drift detected." "Run 'npm run validate-rules-registry' in auto-refactor to inspect and sync rules." "npm --prefix auto-refactor run validate-rules-registry" "auto-refactor/src/core/rules" "$NPM_BIN" run validate-rules-registry; then
        write_step_verdict "RULE-REGISTRY-02" PASS "规则元数据单源一致"
    else
        write_step_verdict "RULE-REGISTRY-02" BLOCK "规则注册表元数据发生漂移"
    fi
fi

if echo "$STAGED_FILES" | grep -qE '^\.agents/(skills|plugins)/'; then
    write_step_banner "SKILLS-SPEC-03"
    if run_pre_commit_check "SKILLS-SPEC-03" "GUARD-SSOT-001" "$ROOT_DIR" "Workspace skills specification or plugin isomorphism verification failed." "Run 'node scripts/common/validate-skills.js' to inspect and fix skill metadata." "node scripts/common/validate-skills.js" ".agents/skills" "$NODE_BIN" scripts/common/validate-skills.js; then
        write_step_verdict "SKILLS-SPEC-03" PASS "技能集规范与插件同构合规"
    else
        write_step_verdict "SKILLS-SPEC-03" BLOCK "技能集规范或插件同构校验未通过"
    fi
fi

# --- 提交信息规则覆盖清单双向闭包 ---
write_step_banner "COMMIT-MSG-COVERAGE-15"
if run_pre_commit_check "COMMIT-MSG-COVERAGE-15" "FGT-MSG-002" "$ROOT_DIR" "Commit message rule coverage closure does not hold in both directions." "Run node scripts/common/validate-commit-rule-coverage.js to inspect unmapped or zombie rules." "node scripts/common/validate-commit-rule-coverage.js" "scripts/common/commit-rule-coverage.json" "$NODE_BIN" scripts/common/validate-commit-rule-coverage.js; then
    write_step_verdict "COMMIT-MSG-COVERAGE-15" PASS "覆盖清单双向闭包成立"
else
    write_step_verdict "COMMIT-MSG-COVERAGE-15" BLOCK "提交信息规则覆盖清单双向闭包不成立"
fi

# --- 项目增量编译与语法验证 (精准增量触发) ---
TOUCHED_WT_COMPILE=$(echo "$STAGED_FILES" | grep -E '^workspace-timing/(src/.+\.ts|tsconfig.*\.json)' || true)
TOUCHED_AR_COMPILE=$(echo "$STAGED_FILES" | grep -E '^auto-refactor/(src/.+\.ts|tsconfig.*\.json|crates/.+\.rs|crates/.+\.toml|crates/Cargo\.(toml|lock))' || true)
TOUCHED_AR_CRATES=$(echo "$STAGED_FILES" | grep -E '^auto-refactor/crates/.+(\.rs|\.toml)$' || true)
TOUCHED_WG_AUDIT=$(echo "$STAGED_FILES" | grep -E '^WebGames/(config/|scripts/py/audit_config\.py)' || true)
TOUCHED_FG_COMPILE=$(echo "$STAGED_FILES" | grep -E '^fractal-git/(crates/.+\.rs|src/.+\.rs|Cargo\.(toml|lock))' || true)

if [[ -n "$TOUCHED_WT_COMPILE" ]]; then
    write_step_banner "EXTENSION-COMPILE-04"
    if run_pre_commit_check "EXTENSION-COMPILE-04" "L0-COMPILE" "$ROOT_DIR/workspace-timing" "TypeScript compilation failed in workspace-timing." "Run 'npm run compile' in workspace-timing and resolve compiler errors." "npm --prefix workspace-timing run compile" "workspace-timing/src" "$NPM_BIN" run compile; then
        write_step_verdict "EXTENSION-COMPILE-04" PASS "workspace-timing 增量编译通过"
    else
        write_step_verdict "EXTENSION-COMPILE-04" BLOCK "workspace-timing 编译失败"
    fi

    if [[ "$FAILED" -eq 0 ]]; then
        write_step_banner "EXTENSION-TESTS-05"
        if run_pre_commit_check "EXTENSION-TESTS-05" "GUARD-SYS-001" "$ROOT_DIR/workspace-timing" "Unit tests failed in workspace-timing." "Run 'npm run test:fast' in workspace-timing and resolve failing tests." "npm --prefix workspace-timing run test:fast" "workspace-timing/src" "$NPM_BIN" run test:fast; then
            write_step_verdict "EXTENSION-TESTS-05" PASS "快速单元测试通过"
        else
            write_step_verdict "EXTENSION-TESTS-05" BLOCK "workspace-timing 快速单测未通过"
        fi
    fi
elif [[ "$AGENT_MODE" -eq 0 ]] && echo "$STAGED_FILES" | grep -q '^workspace-timing/'; then
    write_step_verdict "EXTENSION-COMPILE-04" SKIP "仅文档或配置变更"
fi

if echo "$STAGED_FILES" | grep -qE '^workspace-timing/(CHANGELOG\.md|README\.md|package\.json)'; then
    write_step_banner "EXTENSION-DOCS-06"
    WT_LAYOUT_READY=1
    if [[ ! -f "workspace-timing/scripts/dist/audit/text-layout.js" ]]; then
        log_gate "  ▶ 构建 workspace-timing 审查脚本产物 (npm run scripts:build)..."
        if ! run_pre_commit_check "EXTENSION-DOCS-06" "L3-DOC-LAYOUT" "$ROOT_DIR/workspace-timing" "workspace-timing scripts:build failed; text-layout artifact is unavailable." "Run 'npm run scripts:build' in workspace-timing and resolve compiler errors." "npm --prefix workspace-timing run scripts:build" "workspace-timing/scripts/audit/text-layout.ts" "$NPM_BIN" run scripts:build; then
            WT_LAYOUT_READY=0
            write_step_verdict "EXTENSION-DOCS-06" BLOCK "审查脚本构建失败"
        fi
    fi
    if [[ "$WT_LAYOUT_READY" -eq 1 ]]; then
        if run_pre_commit_check "EXTENSION-DOCS-06" "L3-DOC-LAYOUT" "$ROOT_DIR/workspace-timing" "workspace-timing text layout or changelog authenticity check failed." "Review CHANGELOG.md / README.md to ensure Keep-a-Changelog compliance." "node workspace-timing/scripts/dist/audit/text-layout.js" "workspace-timing/CHANGELOG.md" "$NODE_BIN" scripts/dist/audit/text-layout.js; then
            write_step_verdict "EXTENSION-DOCS-06" PASS "文档布局与变更日志真实性合规"
        else
            write_step_verdict "EXTENSION-DOCS-06" BLOCK "文档文本布局或变更日志真实性核验未通过"
        fi
    fi
fi

if [[ -n "$TOUCHED_AR_COMPILE" ]]; then
    write_step_banner "ENGINE-COMPILE-07"
    if [[ -n "$TOUCHED_AR_CRATES" ]]; then
        if (cd auto-refactor/crates && cargo check --workspace --all-targets) >"$STEP_LOG" 2>&1; then
            write_step_verdict "ENGINE-COMPILE-07" PASS "auto-refactor Rust 增量编译通过"
        else
            fail_pre_commit_step "ENGINE-COMPILE-07" "L0-COMPILE" \
                "Rust crate compilation failed in auto-refactor." \
                "Run 'cargo check --workspace --all-targets' in auto-refactor/crates and resolve errors." \
                "cargo check --workspace --all-targets" "auto-refactor/crates" || true
            write_step_verdict "ENGINE-COMPILE-07" BLOCK "auto-refactor Rust 编译失败"
        fi
    elif run_pre_commit_check "ENGINE-COMPILE-07" "L0-COMPILE" "$ROOT_DIR/auto-refactor" \
        "TypeScript compilation failed in auto-refactor." \
        "Run 'npm run build' in auto-refactor and resolve compiler errors." \
        "npm --prefix auto-refactor run build" "auto-refactor/src" \
        "$NPM_BIN" run build; then
        write_step_verdict "ENGINE-COMPILE-07" PASS "auto-refactor 增量编译通过"
    else
        write_step_verdict "ENGINE-COMPILE-07" BLOCK "auto-refactor 编译失败"
    fi

    if [[ "$FAILED" -eq 0 ]]; then
        AR_STAGED_TS=$(echo "$STAGED_FILES" | grep -E '^auto-refactor/(src|tests/unit)/.+\.ts$' || true)
        if [[ -n "$AR_STAGED_TS" ]]; then
            AR_REL_FILES=$(echo "$AR_STAGED_TS" | sed 's|^auto-refactor/||' | tr '\n' ' ')
            read -r -a AR_REL_ARGS <<< "$AR_REL_FILES"
            write_step_banner "ENGINE-TESTS-08"
            if run_pre_commit_check "ENGINE-TESTS-08" "GUARD-SYS-001" "$ROOT_DIR/auto-refactor" \
                "Impacted unit tests failed in auto-refactor." \
                "Run 'npx vitest related ... --run --passWithNoTests=false' in auto-refactor." \
                "npx --prefix auto-refactor vitest related \"$AR_REL_FILES\" --run --passWithNoTests=false" "auto-refactor/src" \
                npx vitest related "${AR_REL_ARGS[@]}" --run --passWithNoTests=false; then
                write_step_verdict "ENGINE-TESTS-08" PASS "增量影响单测通过"
            else
                write_step_verdict "ENGINE-TESTS-08" BLOCK "auto-refactor 增量影响单测未通过"
            fi
        fi
    fi
elif [[ "$AGENT_MODE" -eq 0 ]] && echo "$STAGED_FILES" | grep -q '^auto-refactor/'; then
    write_step_verdict "ENGINE-COMPILE-07" SKIP "仅文档或配置变更"
fi

if [[ -n "$TOUCHED_WG_AUDIT" ]]; then
    write_step_banner "DOMAIN-CONFIG-09"
    if run_pre_commit_check "DOMAIN-CONFIG-09" "ADV-CFG-001" "$ROOT_DIR" \
        "WebGames configuration architecture review failed." \
        "Run 'python WebGames/scripts/py/audit_config.py --strict' to inspect config issues." \
        "python WebGames/scripts/py/audit_config.py --strict" "WebGames/config" \
        "$PYTHON_BIN" WebGames/scripts/py/audit_config.py --strict; then
        write_step_verdict "DOMAIN-CONFIG-09" PASS "WebGames 配置架构审查通过"
    else
        write_step_verdict "DOMAIN-CONFIG-09" BLOCK "WebGames 配置架构审查未通过"
    fi
fi

if [[ -n "$TOUCHED_FG_COMPILE" ]]; then
    write_step_banner "RUST-COMPILE-10"
    if [[ -n "$CARGO_BIN" ]]; then
        if run_pre_commit_check "RUST-COMPILE-10" "L0-COMPILE" "$ROOT_DIR" \
            "Cargo check compilation failed in fractal-git." \
            "Run 'cargo check --workspace --manifest-path fractal-git/Cargo.toml --all-targets' and resolve compiler errors." \
            "cargo check --workspace --manifest-path fractal-git/Cargo.toml --all-targets" "fractal-git/Cargo.toml" \
            "$CARGO_BIN" check --workspace --manifest-path fractal-git/Cargo.toml --all-targets; then
            write_step_verdict "RUST-COMPILE-10" PASS "增量编译与语法校验通过"
        else
            write_step_verdict "RUST-COMPILE-10" BLOCK "fractal-git 增量编译未通过"
        fi
    else
        if [[ "$AGENT_MODE" -eq 1 ]]; then
            record_pre_commit_failure "RUST-COMPILE-10" "L0-COMPILE" \
                "未检测到 cargo 工具链，fractal-git 本地编译校验无法执行。" \
                "安装 Rust 工具链并确保 cargo 在 PATH 中，然后重新执行 bash scripts/sh/pre-commit-gate.sh --agent。" \
                "cargo --version" "fractal-git/Cargo.toml" \
                "Agent 模式下 cargo 缺失属于空门禁，与 push 阶段 RUST-TAXIS-19 一致 fail-closed。"
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
            exit 1
        fi
        echo "  ⚠️ 未检测到 cargo 命令，fractal-git 本地编译校验无法执行（将在 CI 门禁中强制验证）"
        write_step_verdict "RUST-COMPILE-10" BLOCK "未检测到 cargo 工具链，fractal-git 本地编译校验无法执行"
        FAILED=1
    fi
elif [[ "$AGENT_MODE" -eq 0 ]] && echo "$STAGED_FILES" | grep -q '^fractal-git/'; then
    write_step_verdict "RUST-COMPILE-10" SKIP "仅文档或配置变更"
fi

# --- 暂存区增量 AST 切片、代码密度、体积包络与微分边界流式统一审查 ---
TOUCHED_CODE=$(echo "$STAGED_FILES" | grep -E '\.(ts|js|rs|py|gd)$' | grep -v -E '(\.d\.ts|dist/|out/|fixtures/)' || true)
TOUCHED_AUDITABLE=$(echo "$STAGED_FILES" | grep -E '\.(ts|js|py|gd|rs|go|sh|ps1)$' | grep -v -E '(\.d\.ts|dist/|out/|fixtures/)' || true)

STREAM_PASSED=0
STREAM_DATA_OK=0
S11_STATUS="BLOCK"; S11_SUMMARY=""; S11_DETAIL=""
S12_STATUS="BLOCK"; S12_SUMMARY=""; S12_DETAIL=""
S13_STATUS="BLOCK"; S13_SUMMARY=""; S13_DETAIL=""
S14_STATUS="BLOCK"; S14_SUMMARY=""; S14_DETAIL=""

if [[ -n "$TOUCHED_CODE" || -n "$TOUCHED_AUDITABLE" ]]; then
    STREAM_OUT=$(mktemp)
    STREAM_EXIT=0
    "$NODE_BIN" scripts/common/gate-differential-bounds.js --stream >"$STREAM_OUT" 2>&1 || STREAM_EXIT=$?
    STREAM_PARSED=$("$NODE_BIN" -e '
const fs = require("fs");
const raw = fs.readFileSync(process.argv[1], "utf8");
const line = raw.split(/\r?\n/).find((l) => /^\{.*"steps":/.test(l));
if (!line) process.exit(2);
const data = JSON.parse(line);
const clean = (s) => String(s || "").replace(/[\r\n\x1f]+/g, " ").trim();
const ids = ["STAGED-SLICE-11", "STAGED-DENSITY-12", "STAGED-VOLUME-13", "STAGED-DIFF-14"];
process.stdout.write(`META\x1f${data.passed ? "1" : "0"}\n`);
for (const id of ids) {
  const st = data.steps && data.steps[id] ? data.steps[id] : {};
  process.stdout.write(`${id}\x1f${clean(st.status || "BLOCK")}\x1f${clean(st.summary || st.detail)}\x1f${clean(st.detail)}\n`);
}
' "$STREAM_OUT" 2>/dev/null) && STREAM_DATA_OK=1 || STREAM_DATA_OK=0

    if [[ "$STREAM_DATA_OK" -eq 1 ]]; then
        while IFS=$'\x1f' read -r key f1 f2 f3; do
            case "$key" in
                META) STREAM_PASSED="$f1" ;;
                STAGED-SLICE-11) S11_STATUS="$f1"; S11_SUMMARY="$f2"; S11_DETAIL="$f3" ;;
                STAGED-DENSITY-12) S12_STATUS="$f1"; S12_SUMMARY="$f2"; S12_DETAIL="$f3" ;;
                STAGED-VOLUME-13) S13_STATUS="$f1"; S13_SUMMARY="$f2"; S13_DETAIL="$f3" ;;
                STAGED-DIFF-14) S14_STATUS="$f1"; S14_SUMMARY="$f2"; S14_DETAIL="$f3" ;;
            esac
        done <<< "$STREAM_PARSED"
    fi

    if [[ "$STREAM_DATA_OK" -eq 0 || ( "$STREAM_EXIT" -ne 0 && "$STREAM_PASSED" -eq 1 ) ]]; then
        if [[ "$AGENT_MODE" -eq 1 ]]; then
            STREAM_RAW=$(cat "$STREAM_OUT" 2>/dev/null || true)
            record_pre_commit_failure "STAGED-DIFF-14" "FGT-GAT-001" \
                "Differential stream gate execution failed with exit code ${STREAM_EXIT}" \
                "Run 'node scripts/common/gate-differential-bounds.js --stream' to inspect output" \
                "bash scripts/sh/pre-commit-gate.sh --fast" "${TOUCHED_AUDITABLE%%$'\n'*}" "$STREAM_RAW"
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
            exit 1
        fi
        echo "✖ BLOCK  流式质量安全门禁异常退出 (ExitCode: ${STREAM_EXIT})"
        FAILED=1
    fi
fi

if [[ -n "$TOUCHED_CODE" ]]; then
    write_step_banner "STAGED-SLICE-11"
    if report_streaming_step "STAGED-SLICE-11" "GUARD-AST-001" "$S11_STATUS" "$S11_SUMMARY" "$S11_DETAIL" "${TOUCHED_CODE%%$'\n'*}"; then
        write_step_verdict "STAGED-SLICE-11" PASS "${S11_DETAIL:-暂存区 AST 切片复杂度合规}"
    else
        write_step_verdict "STAGED-SLICE-11" BLOCK "${S11_DETAIL:-暂存区 AST 切片审查未通过}"
    fi
elif [[ "$AGENT_MODE" -eq 0 ]]; then
    write_step_verdict "STAGED-SLICE-11" SKIP "无暂存代码"
fi

if [[ -n "$TOUCHED_AUDITABLE" ]]; then
    FIRST_AUDITABLE="${TOUCHED_AUDITABLE%%$'\n'*}"
    write_step_banner "STAGED-DENSITY-12"
    if report_streaming_step "STAGED-DENSITY-12" "VOL-DIL-001" "$S12_STATUS" "$S12_SUMMARY" "$S12_DETAIL" "$FIRST_AUDITABLE"; then
        write_step_verdict "STAGED-DENSITY-12" PASS "${S12_DETAIL:-暂存区代码密度与接线载荷合规}"
    else
        write_step_verdict "STAGED-DENSITY-12" BLOCK "${S12_DETAIL:-暂存区代码密度与接线载荷审查未通过}"
    fi

    write_step_banner "STAGED-VOLUME-13"
    if report_streaming_step "STAGED-VOLUME-13" "VOL-ELOC-001" "$S13_STATUS" "$S13_SUMMARY" "$S13_DETAIL" "$FIRST_AUDITABLE"; then
        write_step_verdict "STAGED-VOLUME-13" PASS "${S13_DETAIL:-暂存区双轨体积与动态包络合规}"
    else
        write_step_verdict "STAGED-VOLUME-13" BLOCK "${S13_DETAIL:-暂存区双轨体积与动态包络审查未通过}"
    fi

    write_step_banner "STAGED-DIFF-14"
    if report_streaming_step "STAGED-DIFF-14" "FGT-GAT-001" "$S14_STATUS" "$S14_SUMMARY" "$S14_DETAIL" "$FIRST_AUDITABLE"; then
        write_step_verdict "STAGED-DIFF-14" PASS "${S14_DETAIL:-暂存区加权有效代码微分边界与准入周转合规}"
    else
        write_step_verdict "STAGED-DIFF-14" BLOCK "${S14_DETAIL:-暂存区加权有效代码微分边界或准入周转未达标}"
    fi
elif [[ "$AGENT_MODE" -eq 0 ]]; then
    write_step_verdict "STAGED-DENSITY-12" SKIP "无暂存可审计代码"
    write_step_verdict "STAGED-VOLUME-13" SKIP "无暂存可审计代码"
    write_step_verdict "STAGED-DIFF-14" SKIP "无暂存可审计代码"
fi

STAGED_COUNT=$(echo "$STAGED_FILES" | grep -c . || echo 0)
if [[ "$AGENT_MODE" -eq 1 ]]; then
    complete_gate_telemetry PASS "$STAGED_COUNT" "" pre-commit
    echo '{"protocolVersion":"1.0.0","status":"PASS","gate":"pre-commit","summary":"All pre-commit hygiene and quality gates passed."}'
    exit 0
fi

echo "================================================================="
if [[ "$FAILED" -ne 0 ]]; then
    FAIL_LOG="$ROOT_DIR/.audit-logs/last-pre-commit.log"
    RAW_LOG=""
    [[ -f "$FAIL_LOG" ]] && RAW_LOG=$(cat "$FAIL_LOG" 2>/dev/null || true)
    complete_gate_telemetry BLOCK "$STAGED_COUNT" "$RAW_LOG" pre-commit

    echo "✖ 【门禁结论】Pre-Commit 检查未通过，已阻断提交！请根据上方提示修复后重试。"
    echo "💡 失败诊断快照已保留至: .audit-logs/last-pre-commit.log"
    echo "   (可运行 bash scripts/sh/pre-commit-gate.sh --view-log 快速查看)"
    echo "   (Agent 消费模式: bash scripts/sh/pre-commit-gate.sh --agent)"
    echo "================================================================="
    exit 1
fi
complete_gate_telemetry PASS "$STAGED_COUNT" "" pre-commit
echo "✔ Pre-Commit 检查通过"
echo "================================================================="
exit 0
