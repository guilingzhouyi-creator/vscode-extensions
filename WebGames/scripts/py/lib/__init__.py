#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · Python 支持库)
# 文件路径: WebGames/scripts/py/lib/__init__.py
# 架构定位: WebGames 审计脚本库共享支持包入口 (Auditor Shared Library Package)
# 依赖与触发: 触发方: scripts/py/*.py | 上游: 无 | 下游: 内部共享模块 | 运行时: Python 3.10+
# 职责说明: 声明 WebGames Python 工具集与门禁审计器的共享支持库命名空间
# 退出语义与设计依据: 包初始化入口，无独立退出码 | 设计依据: PEP 382 与工作区脚本库统一命名规范
# ------------------------------------------------------------------------------
# 用法示例:
#   import lib
# ==============================================================================
"""WebGames Python 审计与工具库通用共享支持库包入口。"""
from lib.mod_sdk_shared import check_contract_drift, extract_destiny_capabilities
from lib.runner_reporter import finalize_audit_outputs
from lib.runner_scheduler import execute_audit_pipeline

__all__ = [
    "check_contract_drift",
    "extract_destiny_capabilities",
    "finalize_audit_outputs",
    "execute_audit_pipeline",
]
