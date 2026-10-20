#!/usr/bin/env bash
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 图表验证体系)
# 文件路径: WebGames/scripts/sh/check-mermaid.sh
# 架构定位: 图表语法 Runner (Linux Bash)
# 依赖与触发: 触发方: audit-all / 本地 CLI | 上游: scripts/js/validate-mermaid.mjs | 下游: 诊断报告 | 运行时: Bash 4+
# 职责说明: 提取文档中所有 Mermaid 图表语法块并调度 Node.js 解析器进行语法完整性校验
# 退出语义与设计依据: 退出码: 0=图表语法无损, 1=存在损坏图表或解析能力缺失（fail-closed） | 设计依据: 文档工程化自检契约
# ------------------------------------------------------------------------------
# 用法示例:
#   bash scripts/sh/check-mermaid.sh
# ==============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 路径归一：Git Bash(MSYS) 下 pwd 产出 POSIX 路径(/c/...)，原生 Windows 程序(python3.exe)无法识别；
# pwd -W 产出 C:/... 形态；非 MSYS 平台 pwd -W 不存在，自动回退 pwd。
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && { pwd -W 2>/dev/null || pwd; })"

# fail-closed：解析能力缺失时不得静默放行，否则本门禁退化为永久通过。
if ! command -v node >/dev/null 2>&1; then
  echo "【check-mermaid】node 缺失，无法执行 Mermaid 真解析（fail-closed）" >&2
  exit 1
fi
if [ ! -d "$ROOT_DIR/scripts/js/node_modules/mermaid" ]; then
  echo "【check-mermaid】scripts/js 依赖未安装，无法执行 Mermaid 真解析（fail-closed）" >&2
  echo "  修复: npm install --prefix WebGames/scripts/js" >&2
  exit 1
fi

cd "$ROOT_DIR"
node scripts/js/validate-mermaid.mjs
exit $?
