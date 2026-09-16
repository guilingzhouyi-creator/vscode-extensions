#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 样式规范门禁)
# 文件路径: WebGames/scripts/py/audit_gd_style.py
# 架构定位: 代码风格审查器 (Code Style Checker)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: backend/**/*.gd | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 审查 GDScript 缩进、操作符空格、空行规范与行宽，确保全局代码风格统一老练
# 退出语义与设计依据: 退出码: 0=合规, 1=风格违规 | 设计依据: GD老练风格硬性规范标准
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_gd_style.py
#   python scripts/py/audit_gd_style.py --fix
# ==============================================================================
"""legacy 占位存根：质量门禁基准 三合一后仅保留兼容入口，实际逻辑见 audit_gd.py。"""

import sys


def main() -> int:
    print("【audit_gd_style.py】legacy 占位：已于 质量门禁基准 并入 audit_gd.py（Style 节）。", file=sys.stderr)
    print("请改用：python scripts/py/audit_gd.py 或 audit-all task gd。", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
