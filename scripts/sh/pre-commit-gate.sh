#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 本地提交前置门禁)
# 文件路径: scripts/sh/pre-commit-gate.sh
# 架构定位: 本地 Git 提交前置物理卫生与质量安全门禁 (Linux Bash)
# 依赖与触发: 触发方: .githooks/pre-commit / 本地 CLI 手动触发 | 上游: git commit | 下游: 提交暂存区 | 运行时: Bash 4+
# 职责说明: 执行提交前物理卫生与质量安全检查（挂载 gate-fast-staged.js 极速流式验证 Gates 1-6、规则漂移熔断、精准增量编译、AST 局部切片，支持 Agent-Native 结构化输出）
# 退出语义与设计依据: 退出码: 0=通过门禁, 1=存在卫生或质量违规阻断 | 设计依据: AGENTS.md 跨项目全局通用契约
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/pre-commit-gate.sh
#   bash scripts/sh/pre-commit-gate.sh --agent
#   bash scripts/sh/pre-commit-gate.sh --view-log
# ==============================================================================
set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT_DIR" || exit 1

export GIT_CONFIG_GLOBAL="${GIT_CONFIG_GLOBAL:-NUL}"
export GIT_CONFIG_SYSTEM="${GIT_CONFIG_SYSTEM:-NUL}"
export GIT_CONFIG_NOSYSTEM="${GIT_CONFIG_NOSYSTEM:-1}"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$ROOT_DIR}"

NODE_BIN=$(command -v node 2>/dev/null || command -v node.exe 2>/dev/null || echo "")
NPM_BIN=$(command -v npm 2>/dev/null || command -v npm.cmd 2>/dev/null || echo "")
PYTHON_BIN=$(command -v python3.12 2>/dev/null || command -v python3 2>/dev/null || command -v python 2>/dev/null || command -v py 2>/dev/null || echo "python3")
CARGO_BIN=$(command -v cargo 2>/dev/null || echo "")

if [[ -z "$NODE_BIN" ]]; then
    echo "❌ [BLOCK] 未检测到 Node.js 运行时，提交前门禁无法执行。" >&2
    echo "   修复: 安装 Node.js 20+ 并确保 'node' 在 PATH 中。" >&2
    echo "   该门禁为 fail-closed：缺少运行时不得静默放行 (GUARD-SYS-001)。" >&2
    exit 1
fi

if [[ -z "$NPM_BIN" ]]; then
    echo "❌ [BLOCK] 未检测到 npm 包管理器，提交前门禁无法执行增量编译校验。" >&2
    echo "   修复: 随 Node.js 一并安装 npm，并确保 'npm' 在 PATH 中。" >&2
    exit 1
fi

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

STEP_LOG=$(mktemp)
trap 'rm -f "$STEP_LOG"' EXIT

RUN_ID="$(date -u +%s 2>/dev/null || echo 0)-$$"

STEP_TSV=""
STEP_TOTAL=0

load_step_registry() {
    if [[ -n "$STEP_TSV" ]]; then return 0; fi
    local registry_js="$ROOT_DIR/scripts/common/gate-step-registry.js"
    if [[ ! -f "$registry_js" ]]; then
        echo "✖ BLOCK  单源步骤登记表加载器缺失: $registry_js" >&2
        exit 1
    fi
    STEP_TSV=$("$NODE_BIN" "$registry_js" --entry pre-commit --tsv 2>/dev/null) || {
        echo "✖ BLOCK  单源步骤登记表无法投影 pre-commit 条目" >&2
        exit 1
    }
    STEP_TOTAL=$(grep -c . <<< "$STEP_TSV")
}

# 输出 "序号<TAB>步骤标识<TAB>规则标识<TAB>标题"；未登记标识返回非零。
get_step_meta() {
    local step_id="$1"
    load_step_registry
    local row
    row=$(awk -F'\t' -v id="$step_id" '$2 == id { print; exit }' <<< "$STEP_TSV")
    if [[ -z "$row" ]]; then
        echo "✖ BLOCK  未登记的步骤标识 '$step_id'，请在 scripts/common/gate-step-registry.json 声明" >&2
        return 1
    fi
    printf '%s' "$row"
}

write_step_banner() {
    local step_id="$1"
    local row ordinal title
    row=$(get_step_meta "$step_id") || exit 1
    ordinal=$(cut -f1 <<< "$row")
    title=$(cut -f4 <<< "$row")
    echo "▶ [$ordinal/$STEP_TOTAL] $step_id  $title"
}

write_step_verdict() {
    local step_id="$1"
    local status="$2"
    local detail="${3:-}"
    local glyph
    case "$status" in
        PASS) glyph="✔" ;;
        BLOCK) glyph="✖" ;;
        SKIP) glyph="⚠️" ;;
        WARN) glyph="⚠️" ;;
        *) glyph="·" ;;
    esac
    echo "  $glyph $status  $step_id  $detail"
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
    local step_meta step_id
    step_meta=$(get_step_meta "$step_name") || exit 1
    step_id=$(cut -f2 <<< "$step_meta")

    local diag_dir="$ROOT_DIR/.audit-logs"
    mkdir -p "$diag_dir" 2>/dev/null || true
    local fail_log="$diag_dir/last-pre-commit.log"
    {
        echo "================================================================="
        echo "❌ Pre-Commit 门禁拦截现场快照"
        echo "时间: $(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo 'unknown')"
        echo "步骤: $step_name ($rule_id)"
        echo "说明: $summary"
        if [[ -n "$details" ]]; then
            echo "-----------------------------------------------------------------"
            echo "$details"
        fi
        echo "================================================================="
    } > "$fail_log" 2>/dev/null || true

    local snapshot_json="$diag_dir/last-failure.json"
    cat <<EOF > "$snapshot_json" 2>/dev/null || true
{
  "protocolVersion": "1.0.0",
  "runId": "$RUN_ID",
  "recordedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || echo 'unknown')",
  "status": "BLOCK",
  "gate": "pre-commit",
  "step": "$step_name",
  "stepId": "$step_id",
  "failedCommand": "$verify_cmd",
  "exitCode": 1,
  "summary": "$summary",
  "logFile": ".audit-logs/last-pre-commit.log",
  "violations": [
    {
      "ruleId": "$rule_id",
      "severity": "BLOCK",
      "file": "$target_file",
      "message": "$summary",
      "actionableFix": "$actionable_fix",
      "verificationCommand": "$verify_cmd"
    }
  ],
  "agentDirectives": {
    "targetFiles": ["$target_file"],
    "remediationPriority": ["$rule_id"],
    "verificationCommand": "$verify_cmd",
    "fastRecheckCommand": "bash scripts/sh/pre-commit-gate.sh --agent"
  }
}
EOF
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
        record_pre_commit_failure "STAGED-HYGIENE-01" \
            "$RULE_ID" \
            "$SUMMARY" \
            "$ACTIONABLE_FIX" \
            "node scripts/common/validate-physical-hygiene.js" \
            "$BAD_NAME"
        cat "$ROOT_DIR/.audit-logs/last-failure.json"
        exit 1
    else
        write_step_verdict "STAGED-HYGIENE-01" BLOCK "根目录存在散落脚本或未受控临时脏文件: $BAD_NAME"
        echo "   $ACTIONABLE_FIX"
        exit 1
    fi
fi

# 获取当前暂存区中的文件列表（新增、修改、重命名）
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null || true)

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
    echo "🔒 执行本地 Pre-Commit 质量安全与物理卫生检查"
    echo "================================================================="
fi

FAILED=0

if [[ "$AGENT_MODE" -eq 1 ]]; then
    rm -f "$ROOT_DIR/.audit-logs/last-failure.json" 2>/dev/null || true
fi

# --- 暂存区流式物理卫生与安全审查 ---
if [[ "$AGENT_MODE" -eq 1 ]]; then
    if ! "$NODE_BIN" scripts/common/gate-fast-staged.js --agent >/dev/null 2>&1; then
        if [[ -f "$ROOT_DIR/.audit-logs/last-failure.json" ]]; then
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
        fi
        exit 1
    fi
else
    write_step_banner "STAGED-HYGIENE-01"
    if ! "$NODE_BIN" scripts/common/gate-fast-staged.js; then
        echo "❌ [FAIL] 暂存区物理卫生与安全审查未通过！"
        FAILED=1
    fi
fi

# --- 单源规则漂移熔断 ---
TOUCHED_RULES=$(echo "$STAGED_FILES" | grep -E "auto-refactor/src/core/rules/|auto-refactor/src/analyzers/" || true)
if [[ -n "$TOUCHED_RULES" ]]; then
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        if ! (cd auto-refactor && "$NPM_BIN" run validate-rules-registry) >"$STEP_LOG" 2>&1; then
            record_pre_commit_failure "RULE-REGISTRY-02" \
                "RCFG-RULE-DRIFT" \
                "Auto-refactor rule registry metadata drift detected." \
                "Run 'npm run validate-rules-registry' in auto-refactor to inspect and sync rules." \
                "npm --prefix auto-refactor run validate-rules-registry" \
                "auto-refactor/src/core/rules"
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
            exit 1
        fi
    else
        write_step_banner "RULE-REGISTRY-02"
        if ! (cd auto-refactor && "$NPM_BIN" run validate-rules-registry) >"$STEP_LOG" 2>&1; then
            write_step_verdict "RULE-REGISTRY-02" BLOCK "规则注册表元数据发生漂移"
            tail -n 15 "$STEP_LOG" | sed 's/^/   /'
            FAILED=1
        else
            write_step_verdict "RULE-REGISTRY-02" PASS "规则元数据单源一致"
        fi
    fi
fi

TOUCHED_SKILLS=$(echo "$STAGED_FILES" | grep -E '^\.agents/(skills|plugins)/' || true)
if [[ -n "$TOUCHED_SKILLS" ]]; then
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        if ! "$NODE_BIN" scripts/common/validate-skills.js >"$STEP_LOG" 2>&1; then
            record_pre_commit_failure "SKILLS-SPEC-03" \
                "GUARD-SSOT-001" \
                "Workspace skills specification or plugin isomorphism verification failed." \
                "Run 'node scripts/common/validate-skills.js' to inspect and fix skill metadata." \
                "node scripts/common/validate-skills.js" \
                ".agents/skills"
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
            exit 1
        fi
    else
        write_step_banner "SKILLS-SPEC-03"
        if ! "$NODE_BIN" scripts/common/validate-skills.js; then
            write_step_verdict "SKILLS-SPEC-03" BLOCK "技能集规范或插件同构校验未通过"
            FAILED=1
        else
            write_step_verdict "SKILLS-SPEC-03" PASS "技能集规范与插件同构合规"
        fi
    fi
fi

# --- 项目增量编译与语法验证 (精准增量触发) ---
TOUCHED_WT_COMPILE=$(echo "$STAGED_FILES" | grep -E '^workspace-timing/(src/.+\.ts|tsconfig.*\.json)' || true)
TOUCHED_AR_COMPILE=$(echo "$STAGED_FILES" | grep -E '^auto-refactor/(src/.+\.ts|tsconfig.*\.json)' || true)
TOUCHED_WG_AUDIT=$(echo "$STAGED_FILES" | grep -E '^WebGames/(config/|scripts/py/audit_config\.py)' || true)
TOUCHED_FG_COMPILE=$(echo "$STAGED_FILES" | grep -E '^fractal-git/(crates/.+\.rs|src/.+\.rs|Cargo\.(toml|lock))' || true)

if [[ -n "$TOUCHED_WT_COMPILE" ]]; then
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        if ! (cd workspace-timing && "$NPM_BIN" run compile) >"$STEP_LOG" 2>&1; then
            record_pre_commit_failure "EXTENSION-COMPILE-04" \
                "L0-COMPILE" \
                "TypeScript compilation failed in workspace-timing." \
                "Run 'npm run compile' in workspace-timing and resolve compiler errors." \
                "npm --prefix workspace-timing run compile" \
                "workspace-timing/src"
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
            exit 1
        fi
    else
        write_step_banner "EXTENSION-COMPILE-04"
        if ! (cd workspace-timing && "$NPM_BIN" run compile) >"$STEP_LOG" 2>&1; then
            write_step_verdict "EXTENSION-COMPILE-04" BLOCK "workspace-timing 编译失败"
            tail -n 15 "$STEP_LOG" | sed 's/^/   /'
            FAILED=1
        fi
    fi

    if [[ "$FAILED" -eq 0 ]]; then
        if [[ "$AGENT_MODE" -eq 1 ]]; then
            if ! (cd workspace-timing && "$NPM_BIN" run test:fast) >"$STEP_LOG" 2>&1; then
                record_pre_commit_failure "EXTENSION-TESTS-05" \
                    "GUARD-SYS-001" \
                    "Unit tests failed in workspace-timing." \
                    "Run 'npm run test:fast' in workspace-timing and resolve failing tests." \
                    "npm --prefix workspace-timing run test:fast" \
                    "workspace-timing/src"
                cat "$ROOT_DIR/.audit-logs/last-failure.json"
                exit 1
            fi
        else
            write_step_banner "EXTENSION-TESTS-05"
            if ! (cd workspace-timing && "$NPM_BIN" run test:fast) >"$STEP_LOG" 2>&1; then
                write_step_verdict "EXTENSION-TESTS-05" BLOCK "workspace-timing 快速单测未通过"
                tail -n 15 "$STEP_LOG" | sed 's/^/   /'
                FAILED=1
            else
                write_step_verdict "EXTENSION-TESTS-05" PASS "快速单元测试通过"
            fi
        fi
    fi
elif [[ "$AGENT_MODE" -eq 0 ]] && echo "$STAGED_FILES" | grep -q '^workspace-timing/'; then
    write_step_verdict "EXTENSION-COMPILE-04" SKIP "仅文档或配置变更"
fi

TOUCHED_WT_DOC=$(echo "$STAGED_FILES" | grep -E '^workspace-timing/(CHANGELOG\.md|README\.md|package\.json)' || true)
if [[ -n "$TOUCHED_WT_DOC" ]]; then
    WT_LAYOUT_READY=1
    WT_LAYOUT_ARTIFACT="workspace-timing/scripts/dist/audit/text-layout.js"
    if [[ ! -f "$WT_LAYOUT_ARTIFACT" ]]; then
        echo "  ▶ 构建 workspace-timing 审查脚本产物 (npm run scripts:build)..."
        if ! (cd workspace-timing && "$NPM_BIN" run scripts:build) >"$STEP_LOG" 2>&1; then
            WT_LAYOUT_READY=0
            if [[ "$AGENT_MODE" -eq 1 ]]; then
                record_pre_commit_failure "EXTENSION-DOCS-06" \
                    "L3-DOC-LAYOUT" \
                    "workspace-timing scripts:build failed; text-layout artifact is unavailable." \
                    "Run 'npm run scripts:build' in workspace-timing and resolve compiler errors." \
                    "npm --prefix workspace-timing run scripts:build" \
                    "workspace-timing/scripts/audit/text-layout.ts"
                cat "$ROOT_DIR/.audit-logs/last-failure.json"
                exit 1
            fi
            write_step_verdict "EXTENSION-DOCS-06" BLOCK "审查脚本构建失败"
            tail -n 15 "$STEP_LOG" | sed 's/^/   /'
            FAILED=1
        fi
    fi
    if [[ "$WT_LAYOUT_READY" -eq 1 ]]; then
        if [[ "$AGENT_MODE" -eq 1 ]]; then
            if ! (cd workspace-timing && "$NODE_BIN" scripts/dist/audit/text-layout.js) >"$STEP_LOG" 2>&1; then
                record_pre_commit_failure "EXTENSION-DOCS-06" \
                    "L3-DOC-LAYOUT" \
                    "workspace-timing text layout or changelog authenticity check failed." \
                    "Review CHANGELOG.md / README.md to ensure Keep-a-Changelog compliance." \
                    "node workspace-timing/scripts/dist/audit/text-layout.js" \
                    "workspace-timing/CHANGELOG.md"
                cat "$ROOT_DIR/.audit-logs/last-failure.json"
                exit 1
            fi
        else
            write_step_banner "EXTENSION-DOCS-06"
            if ! (cd workspace-timing && "$NODE_BIN" scripts/dist/audit/text-layout.js) >"$STEP_LOG" 2>&1; then
                write_step_verdict "EXTENSION-DOCS-06" BLOCK "文档文本布局或变更日志真实性核验未通过"
                tail -n 15 "$STEP_LOG" | sed 's/^/   /'
                FAILED=1
            else
                write_step_verdict "EXTENSION-DOCS-06" PASS "文档布局与变更日志真实性合规"
            fi
        fi
    fi
fi

if [[ -n "$TOUCHED_AR_COMPILE" ]]; then
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        if ! (cd auto-refactor && "$NPM_BIN" run build) >"$STEP_LOG" 2>&1; then
            record_pre_commit_failure "ENGINE-COMPILE-07" \
                "L0-COMPILE" \
                "TypeScript compilation failed in auto-refactor." \
                "Run 'npm run build' in auto-refactor and resolve compiler errors." \
                "npm --prefix auto-refactor run build" \
                "auto-refactor/src"
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
            exit 1
        fi
    else
        write_step_banner "ENGINE-COMPILE-07"
        if ! (cd auto-refactor && "$NPM_BIN" run build) >"$STEP_LOG" 2>&1; then
            write_step_verdict "ENGINE-COMPILE-07" BLOCK "auto-refactor 编译失败"
            tail -n 15 "$STEP_LOG" | sed 's/^/   /'
            FAILED=1
        fi
    fi

    if [[ "$FAILED" -eq 0 ]]; then
        AR_STAGED_TS=$(echo "$STAGED_FILES" | grep -E '^auto-refactor/(src|tests/unit)/.+\.ts$' || true)
        if [[ -n "$AR_STAGED_TS" ]]; then
            AR_REL_FILES=$(echo "$AR_STAGED_TS" | sed 's|^auto-refactor/||' | tr '\n' ' ')
            if [[ "$AGENT_MODE" -eq 1 ]]; then
                if ! (cd auto-refactor && npx vitest related "$AR_REL_FILES" --run) >"$STEP_LOG" 2>&1; then
                    record_pre_commit_failure "ENGINE-TESTS-08" \
                        "GUARD-SYS-001" \
                        "Impacted unit tests failed in auto-refactor." \
                        "Run 'npx vitest related ... --run' in auto-refactor." \
                        "npx --prefix auto-refactor vitest related \"$AR_REL_FILES\" --run" \
                        "auto-refactor/src"
                    cat "$ROOT_DIR/.audit-logs/last-failure.json"
                    exit 1
                fi
            else
                write_step_banner "ENGINE-TESTS-08"
                if ! (cd auto-refactor && npx vitest related "$AR_REL_FILES" --run) >"$STEP_LOG" 2>&1; then
                    write_step_verdict "ENGINE-TESTS-08" BLOCK "auto-refactor 增量影响单测未通过"
                    tail -n 15 "$STEP_LOG" | sed 's/^/   /'
                    FAILED=1
                else
                    write_step_verdict "ENGINE-TESTS-08" PASS "增量影响单测通过"
                fi
            fi
        fi
    fi
elif [[ "$AGENT_MODE" -eq 0 ]] && echo "$STAGED_FILES" | grep -q '^auto-refactor/'; then
    write_step_verdict "ENGINE-COMPILE-07" SKIP "仅文档或配置变更"
fi

if [[ -n "$TOUCHED_WG_AUDIT" ]]; then
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        if ! "$PYTHON_BIN" WebGames/scripts/py/audit_config.py --strict >"$STEP_LOG" 2>&1; then
            record_pre_commit_failure "DOMAIN-CONFIG-09" \
                "ADV-CFG-001" \
                "WebGames configuration architecture review failed." \
                "Run 'python WebGames/scripts/py/audit_config.py --strict' to inspect config issues." \
                "python WebGames/scripts/py/audit_config.py --strict" \
                "WebGames/config"
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
            exit 1
        fi
    else
        write_step_banner "DOMAIN-CONFIG-09"
        if ! "$PYTHON_BIN" WebGames/scripts/py/audit_config.py --strict >"$STEP_LOG" 2>&1; then
            write_step_verdict "DOMAIN-CONFIG-09" BLOCK "WebGames 配置架构审查未通过"
            tail -n 15 "$STEP_LOG" | sed 's/^/   /'
            FAILED=1
        fi
    fi
fi

if [[ -n "$TOUCHED_FG_COMPILE" ]]; then
    if [[ "$AGENT_MODE" -eq 0 ]]; then
        write_step_banner "RUST-COMPILE-10"
    fi
    if [[ -n "$CARGO_BIN" ]]; then
        if [[ "$AGENT_MODE" -eq 1 ]]; then
            if ! "$CARGO_BIN" check --manifest-path fractal-git/Cargo.toml --all-targets >"$STEP_LOG" 2>&1; then
                record_pre_commit_failure "RUST-COMPILE-10" \
                    "L0-COMPILE" \
                    "Cargo check compilation failed in fractal-git." \
                    "Run 'cargo check --manifest-path fractal-git/Cargo.toml --all-targets' and resolve compiler errors." \
                    "cargo check --manifest-path fractal-git/Cargo.toml --all-targets" \
                    "fractal-git/Cargo.toml"
                cat "$ROOT_DIR/.audit-logs/last-failure.json"
                exit 1
            fi
        else
            if ! "$CARGO_BIN" check --manifest-path fractal-git/Cargo.toml --all-targets >"$STEP_LOG" 2>&1; then
                write_step_verdict "RUST-COMPILE-10" BLOCK "fractal-git 增量编译未通过"
                tail -n 15 "$STEP_LOG" | sed 's/^/   /'
                FAILED=1
            else
                write_step_verdict "RUST-COMPILE-10" PASS "增量编译与语法校验通过"
            fi
        fi
    else
        if [[ "$AGENT_MODE" -eq 0 ]]; then
            echo "  ⚠️ 未检测到 cargo 命令，跳过 fractal-git 本地编译校验（将在 CI 门禁中强制验证）"
        fi
    fi
elif [[ "$AGENT_MODE" -eq 0 ]] && echo "$STAGED_FILES" | grep -q '^fractal-git/'; then
    write_step_verdict "RUST-COMPILE-10" SKIP "仅文档或配置变更"
fi

# --- 暂存区增量 AST 切片质量与复杂度审查 ---
TOUCHED_CODE=$(echo "$STAGED_FILES" | grep -E '\.(ts|js)$' | grep -v -E '(\.d\.ts|dist/|out/|fixtures/)' || true)
if [[ -n "$TOUCHED_CODE" ]]; then
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        if ! "$NODE_BIN" scripts/common/validate-staged-slice.js --agent >/dev/null 2>&1; then
            if [[ -f "$ROOT_DIR/.audit-logs/last-failure.json" ]]; then
                cat "$ROOT_DIR/.audit-logs/last-failure.json"
            fi
            exit 1
        fi
    else
        write_step_banner "STAGED-SLICE-11"
        if ! "$NODE_BIN" scripts/common/validate-staged-slice.js; then
            write_step_verdict "STAGED-SLICE-11" BLOCK "暂存区 AST 切片审查未通过"
            FAILED=1
        fi
    fi
elif [[ "$AGENT_MODE" -eq 0 ]]; then
    write_step_verdict "STAGED-SLICE-11" SKIP "无暂存 TS/JS 代码"
fi

TOUCHED_AUDITABLE=$(echo "$STAGED_FILES" | grep -E '\.(ts|js|py|gd|rs|go|sh|ps1)$' | grep -v -E '(\.d\.ts|dist/|out/|fixtures/)' || true)
if [[ -n "$TOUCHED_AUDITABLE" ]]; then
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        if ! "$NODE_BIN" scripts/common/validate-code-density.js --staged --agent >/dev/null 2>&1; then
            if [[ -f "$ROOT_DIR/.audit-logs/last-failure.json" ]]; then
                cat "$ROOT_DIR/.audit-logs/last-failure.json"
            fi
            exit 1
        fi
    else
        write_step_banner "STAGED-DENSITY-12"
        if ! "$NODE_BIN" scripts/common/validate-code-density.js --staged; then
            write_step_verdict "STAGED-DENSITY-12" BLOCK "暂存区代码密度与接线载荷审查未通过"
            FAILED=1
        fi
    fi
fi

if [[ -n "$TOUCHED_AUDITABLE" ]]; then
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        if ! "$NODE_BIN" scripts/common/evaluate-eloc-budget.js --staged --json >"$STEP_LOG" 2>&1; then
            record_pre_commit_failure "STAGED-VOLUME-13" \
                "VOL-ELOC-001" \
                "Staged code exceeds ELOC/LOC budgets or the 1:3 dynamic envelope." \
                "Run 'node scripts/common/evaluate-eloc-budget.js --staged' and split or densify the offending module." \
                "node scripts/common/evaluate-eloc-budget.js --staged" \
                "scripts"
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
            exit 1
        fi
    else
        write_step_banner "STAGED-VOLUME-13"
        if ! "$NODE_BIN" scripts/common/evaluate-eloc-budget.js --staged; then
            write_step_verdict "STAGED-VOLUME-13" BLOCK "暂存区双轨体积与动态包络审查未通过"
            FAILED=1
        fi
    fi
fi

if [[ "$AGENT_MODE" -eq 1 ]]; then
    echo '{"protocolVersion":"1.0.0","status":"PASS","gate":"pre-commit","summary":"All pre-commit hygiene and quality gates passed."}'
    exit 0
fi

echo "================================================================="
if [[ "$FAILED" -ne 0 ]]; then
    DIAG_DIR="$ROOT_DIR/.audit-logs"
    mkdir -p "$DIAG_DIR" 2>/dev/null || true
    FAIL_LOG="$DIAG_DIR/last-pre-commit.log"
    {
        echo "================================================================="
        echo "❌ Pre-Commit 门禁拦截现场快照"
        echo "时间: $(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo 'unknown')"
        echo "暂存文件列表:"
        echo "$STAGED_FILES" | sed 's/^/  - /'
        echo "================================================================="
    } > "$FAIL_LOG" 2>/dev/null || true

    echo "❌ 【门禁结论】Pre-Commit 检查未通过，已阻断提交！请根据上方提示修复后重试。"
    echo "💡 失败诊断快照已保留至: .audit-logs/last-pre-commit.log"
    echo "   (可运行 bash scripts/sh/pre-commit-gate.sh --view-log 快速查看)"
    echo "   (Agent 消费模式: bash scripts/sh/pre-commit-gate.sh --agent)"
    echo "================================================================="
    exit 1
else
    echo "✅ Pre-Commit 检查通过"
    echo "================================================================="
    exit 0
fi
