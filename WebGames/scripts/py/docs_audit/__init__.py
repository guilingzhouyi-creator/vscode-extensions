#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 文档质量门禁模块接口层)
# 文件路径: WebGames/scripts/py/docs_audit/__init__.py
# 架构定位: 文档治理包总入口 (Document Audit Package Facade)
# 依赖与触发: 触发方: audit_docs.py / 外部导入 | 上游: docs_audit 子模块 | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 集中导出文档审查调度中枢、领域模型实体、各子域门禁检查器、基线棘轮工具与自测夹具
# 退出语义与设计依据: 退出码: 纯包声明无独立退出码 | 设计依据: AGENTS.md 施工细则与文档门禁契约
# ------------------------------------------------------------------------------
# 用法示例:
#   from docs_audit import DocsAuditor, Finding, Doc
# ==============================================================================
"""docs_audit — 卡拉尔世界引擎全仓设计与施工文档质量审查系统。

集中导出文档审查调度中枢、领域模型实体、各子域门禁检查器、基线棘轮工具与自测夹具。
"""
from docs_audit.auditor import DocsAuditor
from docs_audit.layout import check_layout
from docs_audit.links import check_links, fix_abs_links, resolve_abs_target
from docs_audit.mermaid import check_mermaid, mermaid_fix_line, scan_mermaid_line
from docs_audit.models import (
    DOC_RULES_FILE,
    DOCS_DIR,
    Doc,
    Finding,
    NAMING_RULES,
    RULES,
    SEV_ERROR,
    SEV_WARN,
    apply_baseline,
    load_baseline,
    load_doc_rules,
    slugify,
    split_fences,
    write_baseline,
)
from docs_audit.naming import check_naming, check_seq
from docs_audit.phase import (
    check_formation_date,
    check_phase_governance,
    check_phase_stage_file,
)
from docs_audit.selftest import cmd_self_test

__all__ = [
    "DocsAuditor",
    "Doc",
    "Finding",
    "RULES",
    "NAMING_RULES",
    "DOC_RULES_FILE",
    "DOCS_DIR",
    "SEV_ERROR",
    "SEV_WARN",
    "load_doc_rules",
    "load_baseline",
    "apply_baseline",
    "write_baseline",
    "split_fences",
    "slugify",
    "check_layout",
    "check_mermaid",
    "scan_mermaid_line",
    "mermaid_fix_line",
    "check_links",
    "fix_abs_links",
    "resolve_abs_target",
    "check_naming",
    "check_seq",
    "check_formation_date",
    "check_phase_governance",
    "check_phase_stage_file",
    "cmd_self_test",
]

