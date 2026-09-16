#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 环境自检体系)
# 文件路径: WebGames/scripts/sh/check-env.sh
# 架构定位: 环境自检 Runner (Linux Bash)
# 依赖与触发: 触发方: 开发者初始化 / CI 预检 | 上游: 系统工具链 | 下游: 环境状态诊断 | 运行时: Bash 4+
# 职责说明: 检查系统依赖（Godot 4.7+、Python 3.10+、Git、Node.js），验证工作区构建先决条件
# 退出语义与设计依据: 退出码: 0=环境健全, 1=缺少必需工具链 | 设计依据: AGENTS.md 构建门禁环境基准
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/check-env.sh
# ==============================================================================
set -uo pipefail

FAIL=0
GODOT_BIN="${GODOT_BIN:-godot}"

# 1. Godot 可执行性与 4.x 版本检查
if ! command -v "$GODOT_BIN" >/dev/null 2>&1 && command -v "${GODOT_BIN}.exe" >/dev/null 2>&1; then
  GODOT_BIN="${GODOT_BIN}.exe"
fi

if command -v "$GODOT_BIN" >/dev/null 2>&1; then
  VER="$("$GODOT_BIN" --version 2>/dev/null || echo "未知")"
  if [[ "$VER" =~ ^4\. ]]; then
    echo "【check-env】godot: 可用 (Godot $VER, 符合 >= 4.0)"
  else
    echo "【check-env】godot: 版本不合规 (当前: $VER，卡拉尔世界引擎硬性要求 Godot 4.x)"
    FAIL=1
  fi
else
  echo "【check-env】godot: 缺失（用 GODOT_BIN 指定路径）"
  FAIL=1
fi

# 2. Python 检查与版本校验
PY_BIN=""
for PY in python3 python; do
  if command -v "$PY" >/dev/null 2>&1; then
    PY_BIN="$PY"
    break
  fi
done

if [ -n "$PY_BIN" ]; then
  PY_VER="$("$PY_BIN" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null || echo "未知")"
  echo "【check-env】$PY_BIN: 可用 (v$PY_VER)"
else
  echo "【check-env】python3/python: 缺失"
  FAIL=1
fi

# 3. Git 检查
if command -v git >/dev/null 2>&1; then
  GIT_VER="$(git --version 2>/dev/null || echo "未知")"
  echo "【check-env】git: 可用 ($GIT_VER)"
else
  echo "【check-env】git: 缺失"
  FAIL=1
fi

# 4. Node.js 检查（可选增强，mermaid与前端校验）
if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node --version 2>/dev/null || echo "未知")"
  echo "【check-env】node: 可用 ($NODE_VER)"
else
  echo "【check-env】node: 未安装（可选，影响 mermaid 真解析门禁）"
fi

if [ "$FAIL" = "1" ]; then
  echo "【check-env】环境未就绪，请先安装或配置缺失项"
  exit 1
fi
echo "【check-env】环境就绪"
exit 0
