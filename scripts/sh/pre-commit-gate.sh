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

STEP_LOG=$(mktemp)
trap 'rm -f "$STEP_LOG"' EXIT

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

    local step_id
    case "$step_name" in
        "Gate 7: Rules Registry"*) step_id="PC-03-01" ;;
        "Gate 7: Skills"*) step_id="PC-03-02" ;;
        "Gate 8: workspace-timing Compilation"*) step_id="PC-04-01" ;;
        "Gate 8: workspace-timing Text Layout"*) step_id="PC-04-02" ;;
        "Gate 8: workspace-timing Layout Build"*) step_id="PC-04-02" ;;
        "Gate 8: auto-refactor Compilation"*) step_id="PC-04-03" ;;
        "Gate 8: WebGames"*) step_id="PC-04-04" ;;
        "Gate 9: Dual-Scale Volume"*) step_id="PC-05-02" ;;
        *) step_id="PC-00-00" ;;
    esac

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

if [[ "$AGENT_MODE" -eq 0 ]]; then
    echo "================================================================="
    echo "🔒 执行本地 Pre-Commit 质量安全与物理卫生检查"
    echo "================================================================="
fi

FAILED=0
RUN_ID="$(date -u +%s 2>/dev/null || echo 0)-$$"

if [[ "$AGENT_MODE" -eq 1 ]]; then
    rm -f "$ROOT_DIR/.audit-logs/last-failure.json" 2>/dev/null || true
fi

# --- Gate 1~6: 快速暂存区统一流式审查 ([1/9] 零空文件, [2/9] 换行契约, [3/9] 绝对路径, [4/9] 零黑话, [5/9] 双轨体积, [6/9] 密钥防泄漏) ---
if [[ "$AGENT_MODE" -eq 1 ]]; then
    if ! "$NODE_BIN" scripts/common/gate-fast-staged.js --agent >/dev/null 2>&1; then
        if [[ -f "$ROOT_DIR/.audit-logs/last-failure.json" ]]; then
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
        fi
        exit 1
    fi
else
    echo "[1-6/9] 执行暂存区内存流式物理卫生与质量安全检查..."
    if ! "$NODE_BIN" scripts/common/gate-fast-staged.js; then
        echo "❌ [FAIL] 暂存区物理卫生与安全审查未通过！"
        FAILED=1
    fi
fi

# --- Gate 7: 单源规则漂移熔断 ---
TOUCHED_RULES=$(echo "$STAGED_FILES" | grep -E "auto-refactor/src/core/rules/|auto-refactor/src/analyzers/" || true)
if [[ -n "$TOUCHED_RULES" ]]; then
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        if ! (cd auto-refactor && "$NPM_BIN" run validate-rules-registry) >"$STEP_LOG" 2>&1; then
            record_pre_commit_failure "Gate 7: Rules Registry (RCFG-RULE-DRIFT)" \
                "RCFG-RULE-DRIFT" \
                "Auto-refactor rule registry metadata drift detected." \
                "Run 'npm run validate-rules-registry' in auto-refactor to inspect and sync rules." \
                "npm --prefix auto-refactor run validate-rules-registry" \
                "auto-refactor/src/core/rules"
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
            exit 1
        fi
    else
        echo "[7/9] 校验单源规则元数据一致性..."
        if ! (cd auto-refactor && "$NPM_BIN" run validate-rules-registry) >"$STEP_LOG" 2>&1; then
            echo "❌ [FAIL] Gate 7: 规则注册表元数据发生漂移 (RCFG-RULE-DRIFT)！"
            tail -n 15 "$STEP_LOG" | sed 's/^/   /'
            FAILED=1
        else
            echo "  ✔ [PASS] 规则元数据单源一致性校验通过"
        fi
    fi
fi

TOUCHED_SKILLS=$(echo "$STAGED_FILES" | grep -E '^\.agents/(skills|plugins)/' || true)
if [[ -n "$TOUCHED_SKILLS" ]]; then
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        if ! "$NODE_BIN" scripts/common/validate-skills.js >"$STEP_LOG" 2>&1; then
            record_pre_commit_failure "Gate 7: Skills Specification & Hygiene (GATE-SSOT-001)" \
                "GATE-SSOT-001" \
                "Workspace skills specification or plugin isomorphism verification failed." \
                "Run 'node scripts/common/validate-skills.js' to inspect and fix skill metadata." \
                "node scripts/common/validate-skills.js" \
                ".agents/skills"
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
            exit 1
        fi
    else
        echo "  ▶ 触发工作区技能集规范与插件同构校验..."
        if ! "$NODE_BIN" scripts/common/validate-skills.js; then
            echo "❌ [FAIL] Gate 7: 技能集规范或插件同构校验未通过！"
            FAILED=1
        else
            echo "  ✔ [PASS] 技能集规范与插件同构校验通过"
        fi
    fi
fi

# --- Gate 8: 项目增量编译与语法验证 (精准增量触发) ---
if [[ "$AGENT_MODE" -eq 0 ]]; then
    echo "[8/9] 检查相关项目增量编译与语法..."
fi
TOUCHED_WT_COMPILE=$(echo "$STAGED_FILES" | grep -E '^workspace-timing/(src/.+\.ts|tsconfig.*\.json)' || true)
TOUCHED_AR_COMPILE=$(echo "$STAGED_FILES" | grep -E '^auto-refactor/(src/.+\.ts|tsconfig.*\.json)' || true)
TOUCHED_WG_AUDIT=$(echo "$STAGED_FILES" | grep -E '^WebGames/(config/|scripts/py/audit_config\.py)' || true)

if [[ -n "$TOUCHED_WT_COMPILE" ]]; then
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        if ! (cd workspace-timing && "$NPM_BIN" run compile) >"$STEP_LOG" 2>&1; then
            record_pre_commit_failure "Gate 8: workspace-timing Compilation (L0-COMPILE)" \
                "L0-COMPILE" \
                "TypeScript compilation failed in workspace-timing." \
                "Run 'npm run compile' in workspace-timing and resolve compiler errors." \
                "npm --prefix workspace-timing run compile" \
                "workspace-timing/src"
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
            exit 1
        fi
    else
        echo "  ▶ 触发 workspace-timing 增量编译校验..."
        if ! (cd workspace-timing && "$NPM_BIN" run compile) >"$STEP_LOG" 2>&1; then
            echo "❌ [FAIL] Gate 8: workspace-timing 编译失败！"
            tail -n 15 "$STEP_LOG" | sed 's/^/   /'
            FAILED=1
        fi
    fi
elif [[ "$AGENT_MODE" -eq 0 ]] && echo "$STAGED_FILES" | grep -q '^workspace-timing/'; then
    echo "  ✔ [Gate 8] workspace-timing 仅文档/配置变更，跳过增量编译"
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
                record_pre_commit_failure "Gate 8: workspace-timing Layout Build (L3-DOC-LAYOUT)" \
                    "L3-DOC-LAYOUT" \
                    "workspace-timing scripts:build failed; text-layout artifact is unavailable." \
                    "Run 'npm run scripts:build' in workspace-timing and resolve compiler errors." \
                    "npm --prefix workspace-timing run scripts:build" \
                    "workspace-timing/scripts/audit/text-layout.ts"
                cat "$ROOT_DIR/.audit-logs/last-failure.json"
                exit 1
            fi
            echo "❌ [FAIL] Gate 8: workspace-timing 审查脚本构建失败 (npm run scripts:build)！"
            tail -n 15 "$STEP_LOG" | sed 's/^/   /'
            FAILED=1
        fi
    fi
    if [[ "$WT_LAYOUT_READY" -eq 1 ]]; then
        if [[ "$AGENT_MODE" -eq 1 ]]; then
            if ! (cd workspace-timing && "$NODE_BIN" scripts/dist/audit/text-layout.js) >"$STEP_LOG" 2>&1; then
                record_pre_commit_failure "Gate 8: workspace-timing Text Layout (L3-DOC-LAYOUT)" \
                    "L3-DOC-LAYOUT" \
                    "workspace-timing text layout or changelog authenticity check failed." \
                    "Review CHANGELOG.md / README.md to ensure Keep-a-Changelog compliance." \
                    "node workspace-timing/scripts/dist/audit/text-layout.js" \
                    "workspace-timing/CHANGELOG.md"
                cat "$ROOT_DIR/.audit-logs/last-failure.json"
                exit 1
            fi
        else
            echo "  ▶ 触发 workspace-timing 文档布局与变更日志真实性门禁 (L3-DOC-LAYOUT)..."
            if ! (cd workspace-timing && "$NODE_BIN" scripts/dist/audit/text-layout.js) >"$STEP_LOG" 2>&1; then
                echo "❌ [FAIL] Gate 8: workspace-timing 文档文本布局或变更日志真实性核验未通过！"
                tail -n 15 "$STEP_LOG" | sed 's/^/   /'
                FAILED=1
            else
                echo "  ✔ [PASS] workspace-timing 文档布局与变更日志真实性校验通过"
            fi
        fi
    fi
fi

if [[ -n "$TOUCHED_AR_COMPILE" ]]; then
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        if ! (cd auto-refactor && "$NPM_BIN" run build) >"$STEP_LOG" 2>&1; then
            record_pre_commit_failure "Gate 8: auto-refactor Compilation (L0-COMPILE)" \
                "L0-COMPILE" \
                "TypeScript compilation failed in auto-refactor." \
                "Run 'npm run build' in auto-refactor and resolve compiler errors." \
                "npm --prefix auto-refactor run build" \
                "auto-refactor/src"
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
            exit 1
        fi
    else
        echo "  ▶ 触发 auto-refactor 增量编译校验..."
        if ! (cd auto-refactor && "$NPM_BIN" run build) >"$STEP_LOG" 2>&1; then
            echo "❌ [FAIL] Gate 8: auto-refactor 编译失败！"
            tail -n 15 "$STEP_LOG" | sed 's/^/   /'
            FAILED=1
        fi
    fi
elif [[ "$AGENT_MODE" -eq 0 ]] && echo "$STAGED_FILES" | grep -q '^auto-refactor/'; then
    echo "  ✔ [Gate 8] auto-refactor 仅文档/配置变更，跳过增量编译"
fi

if [[ -n "$TOUCHED_WG_AUDIT" ]]; then
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        if ! "$PYTHON_BIN" WebGames/scripts/py/audit_config.py --strict >"$STEP_LOG" 2>&1; then
            record_pre_commit_failure "Gate 8: WebGames Config Architecture (ADV-CFG-001)" \
                "ADV-CFG-001" \
                "WebGames configuration architecture review failed." \
                "Run 'python WebGames/scripts/py/audit_config.py --strict' to inspect config issues." \
                "python WebGames/scripts/py/audit_config.py --strict" \
                "WebGames/config"
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
            exit 1
        fi
    else
        echo "  ▶ 触发 WebGames 增量配置架构审查..."
        if ! "$PYTHON_BIN" WebGames/scripts/py/audit_config.py --strict >"$STEP_LOG" 2>&1; then
            echo "❌ [FAIL] Gate 8: WebGames 配置架构审查未通过！"
            tail -n 15 "$STEP_LOG" | sed 's/^/   /'
            FAILED=1
        fi
    fi
fi

# --- Gate 9: 暂存区增量 AST 切片质量与复杂度审查 ---
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
        echo "[9/9] 审查暂存区 AST 切片复杂度与代码稀释 (CC<=15 [分发器<=25], Depth<=4, Noise<=4.0)..."
        if ! "$NODE_BIN" scripts/common/validate-staged-slice.js; then
            echo "❌ [FAIL] Gate 9: 暂存区 AST 切片审查未通过！"
            FAILED=1
        fi
    fi
elif [[ "$AGENT_MODE" -eq 0 ]]; then
    echo "  ✔ [PASS] 无暂存 TS/JS 代码需执行 AST 切片审查"
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
        echo "  ▶ 审查暂存区代码密度与接线载荷 (POR<=60%, tau in [2.5, 20.0])..."
        if ! "$NODE_BIN" scripts/common/validate-code-density.js --staged; then
            echo "❌ [FAIL] Gate 9: 暂存区代码密度与接线载荷审查未通过！"
            FAILED=1
        fi
    fi
fi

if [[ -n "$TOUCHED_AUDITABLE" ]]; then
    if [[ "$AGENT_MODE" -eq 1 ]]; then
        if ! "$NODE_BIN" scripts/common/evaluate-eloc-budget.js --staged --json >"$STEP_LOG" 2>&1; then
            record_pre_commit_failure "Gate 9: Dual-Scale Volume Budget (VOL-ELOC-001)" \
                "VOL-ELOC-001" \
                "Staged code exceeds ELOC/LOC budgets or the 1:3 dynamic envelope." \
                "Run 'node scripts/common/evaluate-eloc-budget.js --staged' and split or densify the offending module." \
                "node scripts/common/evaluate-eloc-budget.js --staged" \
                "scripts"
            cat "$ROOT_DIR/.audit-logs/last-failure.json"
            exit 1
        fi
    else
        echo "  ▶ 审查暂存区双轨体积与 1:3 动态包络 (ELOC<=900, LOC<=1400)..."
        if ! "$NODE_BIN" scripts/common/evaluate-eloc-budget.js --staged; then
            echo "❌ [FAIL] Gate 9: 暂存区双轨体积与动态包络审查未通过！"
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
