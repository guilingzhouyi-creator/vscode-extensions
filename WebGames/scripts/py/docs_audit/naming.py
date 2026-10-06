#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 目录与命名门禁)
# 文件路径: WebGames/scripts/py/docs_audit/naming.py
# 架构定位: 文档目录与文件命名规范检查器 (Naming Discipline Gate)
# 依赖与触发: 触发方: DocsAuditor.check() | 上游: dir_index 与 naming_rules | 下游: Finding 发现项 | 运行时: Python 3.10+
# 职责说明: docs/ 目录与文件命名模式匹配、序号递增与多编号混用检查
# 退出语义与设计依据: 退出码: 纯检查函数无独立退出码 | 设计依据: AGENTS.md 施工细则与文档门禁契约
# ------------------------------------------------------------------------------
# 用法示例:
#   check_naming(docs_dir, dir_index, naming, docs_map, rel_fn, out)
# ==============================================================================
"""docs/ 目录与文件命名模式匹配、序号递增与多编号混用检查。"""
import os
import re
from pathlib import Path
from typing import Callable

from docs_audit.models import CN_NUMERALS, Finding


def check_naming(
    docs_dir: Path,
    dir_index: dict,
    naming: list,
    docs_map: dict,
    rel_fn: Callable,
    out: list,
) -> None:
    """按命名声明矩阵审查全库目录与文件命名。"""
    if not docs_dir.is_dir():
        return
    for rule in naming:
        scope = docs_dir if rule["scope"] == "." else docs_dir / rule["scope"]
        entries = dir_index.get(str(scope))
        if entries is None:
            continue
        if rule.get("sub"):                        # 递归约束 scope 深层全部文件
            scope_prefix = str(scope) + os.sep
            for d, descs in dir_index.items():
                if not d.startswith(scope_prefix):
                    continue
                for p in descs:
                    if p.is_file() and p.parent != scope and rule.get("files") \
                            and not any(re.fullmatch(pat, p.name) for pat in rule["files"]):
                        out.append(Finding("NAMING-FILE", rel_fn(p), 0,
                                           f'文件名「{p.name}」不符合 scope「{rule["scope"]}」声明模式'))
            continue
        for p in entries:
            rel = rel_fn(p)
            if p.is_dir() and rule.get("dirs"):
                if not any(re.fullmatch(pat, p.name) for pat in rule["dirs"]):
                    out.append(Finding("NAMING-DIR", rel, 0,
                                       f'目录名「{p.name}」不符合 scope「{rule["scope"]}」声明模式'))
            elif p.is_file() and rule.get("files"):
                if not any(re.fullmatch(pat, p.name) for pat in rule["files"]):
                    out.append(Finding("NAMING-FILE", rel, 0,
                                       f'文件名「{p.name}」不符合 scope「{rule["scope"]}」声明模式'))
    check_seq(docs_map, rel_fn, out)


def check_seq(docs_map: dict, rel_fn: Callable, out: list) -> None:
    """同前缀文件族混用「无编号」与「中文数字编号」→ 建议补齐最小缺失序号。"""
    by_dir: dict = {}
    for doc in docs_map.values():             # 复用已装载集合，零额外遍历
        by_dir.setdefault(doc.path.parent, []).append(doc.path)
    for d, files in by_dir.items():
        fam: dict = {}
        for p in files:
            m = re.match(r"^(.+?)([一二三四五六七八九十])?\.md$", p.name)
            if m and len(m.group(1)) >= 4:
                fam.setdefault(m.group(1), []).append(m.group(2) or "")
        for prefix, nums in fam.items():
            if len(nums) < 2 or "" not in nums:
                continue
            used = sorted(n for n in nums if n)
            missing = next((c for c in CN_NUMERALS if c not in used), "")
            if missing:
                out.append(Finding("NAMING-SEQ", rel_fn(d / (prefix + ".md")), 0,
                                   f'文件族「{prefix}*」混用无编号与中文编号成员（已有: {"".join(used)}）',
                                   f"重命名 {prefix}.md → {prefix}{missing}.md 并同步全库入链"))

