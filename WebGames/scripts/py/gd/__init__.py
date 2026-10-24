#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · GDScript 审查子包)
# 文件路径: WebGames/scripts/py/gd/__init__.py
# 架构定位: GDScript 语法、架构与简化审计规则子包入口 (GDScript Audit Package)
# 依赖与触发: 触发方: audit_gd.py | 上游: backend/**/*.gd | 下游: 规则检测器 | 运行时: Python 3.10+
# 职责说明: 声明 GDScript 质量治理规则集合的子命名空间，导出风格、高级架构与简化门禁
# 退出语义与设计依据: 包初始化入口，无独立退出码 | 设计依据: PEP 382 与工作区脚本库统一命名规范
# ------------------------------------------------------------------------------
# 用法示例:
#   import gd
# ==============================================================================
"""GDScript 质量审计规则库子包入口。"""
from gd.advanced_rules import run_advanced_audit
from gd.simplification_rules import run_simplification_audit
from gd.style_rules import run_style_audit

__all__ = [
    "run_advanced_audit",
    "run_simplification_audit",
    "run_style_audit",
]
