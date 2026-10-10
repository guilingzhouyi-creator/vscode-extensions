#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与统一质量治理 (Tooling · 本地推送前置门禁)
# 文件路径: scripts/sh/pre-push-gate.sh
# 架构定位: 本地 Git 推送前置全量回归与质量门禁 (Linux Bash)
# 依赖与触发: 触发方: 本地 CLI / CI 门禁 | 上游: 三项目专属门禁套件 | 下游: 远程主干分支 | 运行时: Bash 4+
# 职责说明: 执行推送前回归检查（智能影响分流、零空文件、规则目录、auto-refactor 回归、timing 审查、账本边界、WebGames 配置、流式提交历史审计）
# 退出语义与设计依据: 退出码: 0=通过检查, 1=存在未通过项阻断推送 | 设计依据: AGENTS.md 工作区治理总规
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/pre-push-gate.sh
# ==============================================================================
set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT_DIR" || exit 1

export GIT_CONFIG_GLOBAL="${GIT_CONFIG_GLOBAL:-NUL}"
export GIT_CONFIG_SYSTEM="${GIT_CONFIG_SYSTEM:-NUL}"
export GIT_CONFIG_NOSYSTEM="${GIT_CONFIG_NOSYSTEM:-1}"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$ROOT_DIR}"

echo "================================================================="
echo "🔒 执行本地 Pre-Push 推送前回归检查 (Bash 版)"
echo "================================================================="

NODE_BIN=$(command -v node 2>/dev/null || command -v node.exe 2>/dev/null || echo "node")
NPM_BIN=$(command -v npm 2>/dev/null || command -v npm.cmd 2>/dev/null || echo "npm")
PYTHON_BIN=$(command -v python3 2>/dev/null || command -v python 2>/dev/null || command -v py 2>/dev/null || echo "python3")

FAILED=0

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
    echo "ℹ️  检测到跨项目/共享治理改动或全量基准，执行全量门禁回归"
else
    ACTIVE_PROJ=()
    [[ "$RUN_AR" -eq 1 ]] && ACTIVE_PROJ+=("auto-refactor")
    [[ "$RUN_WT" -eq 1 ]] && ACTIVE_PROJ+=("workspace-timing")
    [[ "$RUN_WG" -eq 1 ]] && ACTIVE_PROJ+=("WebGames")
    echo "ℹ️  智能影响路由生效: 仅回归受影响项目 [${ACTIVE_PROJ[*]}]"
fi

# --- Gate 1: 全工作区零空文件与物理卫生守卫 ---
echo "[1/9] 校验全工作区零物理空文件与空白脚本守卫..."
if ! "$NODE_BIN" scripts/common/validate-no-empty-files.js >/dev/null 2>&1; then
    echo "❌ Gate 1: 发现物理 0 字节或语义虚空文件"
    FAILED=1
else
    echo "  ✔ 全工作区零空文件校验通过"
fi

# --- Gate 2: 规则单源目录一致性同步 ---
echo "[2/9] 校验全工作区单源规则目录同步..."
if ! "$NODE_BIN" scripts/common/generate-rule-catalog.js >/dev/null 2>&1; then
    echo "❌ Gate 2: 单源规则目录生成失败"
    FAILED=1
else
    echo "  ✔ 全工作区单源规则目录同步通过"
fi

# --- Gate 3: auto-refactor 引擎全量门禁与回归套件 ---
if [[ "$RUN_AR" -eq 1 ]]; then
    echo "[3/9] 执行 auto-refactor 全量门禁与回归套件 (Rust/Build/Self/Tests)..."
    if ! (cd auto-refactor && "$NODE_BIN" scripts/gate-rust.js && "$NPM_BIN" run build && "$NODE_BIN" scripts/gate-self.js && "$NPM_BIN" test >/dev/null 2>&1); then
        echo "❌ Gate 3: auto-refactor 门禁或测试套件未通过"
        FAILED=1
    else
        echo "  ✔ auto-refactor 全量门禁与测试套件通过"
    fi
else
    echo "  ✔ [Gate 3] auto-refactor 未受影响，智能跳过全量门禁"
fi

# --- Gate 4: auto-refactor 多维自审与质量基线 ---
if [[ "$RUN_AR" -eq 1 ]]; then
    echo "[4/9] 执行 auto-refactor 质量基线与多维自审 (LOC预算/熵/密度/BIF)..."
    if ! (cd auto-refactor && "$NODE_BIN" scripts/validate-self-multidimensional-audit.js >/dev/null 2>&1); then
        echo "❌ Gate 4: auto-refactor 多维自审或质量基线未达标"
        FAILED=1
    else
        echo "  ✔ auto-refactor 质量基线与自审达标"
    fi
else
    echo "  ✔ [Gate 4] auto-refactor 未受影响，智能跳过质量基线"
fi

# --- Gate 5: workspace-timing 快速单元测试套件 ---
if [[ "$RUN_WT" -eq 1 ]]; then
    echo "[5/9] 执行 workspace-timing 快速单元测试套件..."
    if ! (cd workspace-timing && "$NPM_BIN" run test:fast >/dev/null 2>&1); then
        echo "❌ Gate 5: workspace-timing 单元测试未通过"
        FAILED=1
    else
        echo "  ✔ workspace-timing 快速单元测试通过"
    fi
else
    echo "  ✔ [Gate 5] workspace-timing 未受影响，智能跳过单元测试"
fi

# --- Gate 6: workspace-timing L0~L5 六层审查门禁 ---
if [[ "$RUN_WT" -eq 1 ]]; then
    echo "[6/9] 执行 workspace-timing L0~L5 六层审查门禁..."
    if ! (cd workspace-timing && "$NPM_BIN" run review >/dev/null 2>&1); then
        echo "❌ Gate 6: workspace-timing L0~L5 审查门禁未通过"
        FAILED=1
    else
        echo "  ✔ workspace-timing 审查门禁通过"
    fi
else
    echo "  ✔ [Gate 6] workspace-timing 未受影响，智能跳过审查门禁"
fi

# --- Gate 7: auto-refactor 长期轨迹账本物理约束守卫 ---
if [[ "$RUN_AR" -eq 1 ]]; then
    echo "[7/9] 校验 auto-refactor 长期轨迹账本物理约束 (<350B/条, <=2MB)..."
    if ! "$NODE_BIN" scripts/common/validate-trajectory-ledger.js >/dev/null 2>&1; then
        echo "❌ Gate 7: auto-refactor 轨迹账本物理约束未达标"
        FAILED=1
    else
        echo "  ✔ auto-refactor 长期轨迹账本物理约束通过"
    fi
else
    echo "  ✔ [Gate 7] 长期轨迹账本未受影响，智能跳过"
fi

# --- Gate 8: WebGames 配置架构与必需表一致性审查 ---
if [[ "$RUN_WG" -eq 1 ]]; then
    echo "[8/9] 执行 WebGames 配置架构与必需表一致性审查..."
    if ! "$PYTHON_BIN" WebGames/scripts/py/audit_config.py --strict >/dev/null 2>&1; then
        echo "❌ Gate 8: WebGames 配置架构审查未通过"
        FAILED=1
    else
        echo "  ✔ WebGames 配置架构审查通过"
    fi
else
    echo "  ✔ [Gate 8] WebGames 配置未受影响，智能跳过审查"
fi

# --- Gate 9: 待推送提交历史风格与禁词审查 (validate-commit-msg-style / validate-commit-msg) ---
if [[ -n "$RANGE" ]]; then
    echo "[9/9] 审查待推送提交历史风格与文本约束 (流式扫描: $RANGE)..."
    if ! "$NODE_BIN" scripts/common/validate-commit-msg.js --range "$RANGE"; then
        echo "❌ Gate 9: 待推送分支提交历史存在风格与文本约束违规"
        FAILED=1
    fi
else
    echo "  ✔ [Gate 9] 首次推送或无上游对比基准，跳过历史扫描"
fi

echo "================================================================="
if [[ "$FAILED" -ne 0 ]]; then
    echo "❌ Pre-Push 检查未通过，已阻止推送至远程分支"
    echo "   请在本地修复上述失败项后重试推送。"
    echo "================================================================="
    exit 1
else
    echo "✅ Pre-Push 检查通过，允许推送至远程"
    echo "================================================================="
    exit 0
fi
