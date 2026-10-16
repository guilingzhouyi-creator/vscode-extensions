#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 文档排版门禁)
# 文件路径: WebGames/scripts/py/docs_audit/layout.py
# 架构定位: Markdown 布局与表格结构检查器 (Markdown Layout & Table Inspector)
# 依赖与触发: 触发方: DocsAuditor.check() | 上游: Doc.lines | 下游: Finding 发现项 | 运行时: Python 3.10+
# 职责说明: Markdown 标题规范、代码围栏闭合、后端需求表标准章节与表格排版门禁审查
# 退出语义与设计依据: 退出码: 纯检查函数无独立退出码 | 设计依据: AGENTS.md 施工细则与文档门禁契约
# ------------------------------------------------------------------------------
# 用法示例:
#   check_layout(doc, decode_errors, add_fn)
# ==============================================================================
"""Markdown 标题规范、代码围栏闭合、后端需求表标准章节与表格排版门禁。"""
import os
import re
from typing import Any, Callable, Dict, List

from audit_common import KALAR_DEV_PREFIX
from docs_audit.models import (
    Doc,
    FENCE_RE,
    LIST_PREFIX_RE,
    TABLE_ROW_RE,
)

RULE_LAYOUT_FENCE = "LAYOUT-FENCE-UNCLOSED"
RULE_LAYOUT_H1_MULTI = "LAYOUT-H1-MULTI"
RULE_LAYOUT_H1_ABSENT = "LAYOUT-H1-ABSENT"
RULE_LAYOUT_SECTION_STD = "LAYOUT-SECTION-STD"
RULE_LAYOUT_ARCHIVE_HEAD = "LAYOUT-ARCHIVE-HEAD"
RULE_LAYOUT_TABLE_COLS = "LAYOUT-TABLE-COLS"
RULE_LAYOUT_TABLE_GAP = "LAYOUT-TABLE-GAP"

ARCHIVE_REQ_HEAD_KEYS = ("档号:", "验收状态")
STD_SECTIONS = "一二三四"


def _check_h1_and_fence(doc: Doc, add_fn: Callable) -> None:
    """审查文档一级标题单一性与末尾代码围栏闭合性。"""
    h1 = [
        i + 1
        for i, (ln, ins) in enumerate(zip(doc.lines, doc.inside))
        if not ins and re.match(r"^#(\s|$)", ln)
    ]
    if len(h1) > 1:
        ellipsis_mark = "…" if len(h1) > 5 else ""
        add_fn(
            doc,
            RULE_LAYOUT_H1_MULTI,
            h1[0],
            f"发现 {len(h1)} 个一级标题（行 {h1[:5]}{ellipsis_mark}），应合并为单一 H1",
        )
    elif not h1 and any(ln.strip() for ln in doc.lines):
        add_fn(doc, RULE_LAYOUT_H1_ABSENT, 0, "全文无一级标题")

    if doc.inside and doc.inside[-1]:
        add_fn(doc, RULE_LAYOUT_FENCE, len(doc.lines), "文件结尾处存在未闭合代码围栏")


def _check_backend_section_std(doc: Doc, add_fn: Callable) -> None:
    """审查后端架构需求表四段式标准章节结构完整性。"""
    filename = os.path.basename(str(doc.path))
    if not re.fullmatch(r"后端架构需求表\d+\.md", filename):
        return

    h2 = [ln for ln, ins in zip(doc.lines, doc.inside) if not ins and ln.startswith("## ")]
    have = {ln[3].strip() for ln in h2 if len(ln) > 3}
    missing = [n for n in STD_SECTIONS if n not in have]
    if missing:
        missing_str = " ".join(f"## {n}、" for n in missing)
        add_fn(
            doc,
            RULE_LAYOUT_SECTION_STD,
            0,
            f"缺少标准章节: {missing_str}（补齐后归档阶段3/4 真理指针方可指向真实章节）",
        )


def _check_archive_head(doc: Doc, add_fn: Callable) -> None:
    """审查归档库阶段件前 20 行是否规范声明档号与验收状态。"""
    rel_posix = doc.rel
    pattern = rf"{KALAR_DEV_PREFIX}-(RM|FE)\d{{2}}-\d{{3}}_阶段\d_"
    if "归档库/" not in rel_posix or not re.search(pattern, rel_posix):
        return

    head = "\n".join(doc.lines[:20])
    lack = [k for k in ARCHIVE_REQ_HEAD_KEYS if k not in head]
    if lack:
        add_fn(
            doc,
            RULE_LAYOUT_ARCHIVE_HEAD,
            0,
            f"归档件缺档案头块字段: {' / '.join(lack)}（归档时须补 档号/题名/验收状态/主题词 等键值头）",
        )


def _count_table_cols(line: str) -> int:
    """计算表格行单元格列数（兼容省略行尾竖线的行）。"""
    s = re.sub(r"\\\|", "\x00", line.strip())
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return s.count("|") + 1


def _check_single_table_block(blk: List[int], doc: Doc, add_fn: Callable) -> None:
    """审查单个连续表格块的列数对齐与前置空行。"""
    if len(blk) == 1:
        add_fn(doc, RULE_LAYOUT_TABLE_COLS, blk[0] + 1, "孤立表格行（缺表头/分隔行）")
        return

    head_cols = _count_table_cols(doc.lines[blk[0]])
    for r in blk:
        cols = _count_table_cols(doc.lines[r])
        if cols != head_cols:
            add_fn(doc, RULE_LAYOUT_TABLE_COLS, r + 1, f"表格行 {cols} 列，表头 {head_cols} 列")

    r0 = blk[0]
    if r0 > 0:
        prev = doc.lines[r0 - 1]
        is_isolated = (
            prev.strip()
            and not doc.inside[r0 - 1]
            and not prev.lstrip().startswith(("#", ">", "|"))
            and not LIST_PREFIX_RE.match(prev)
            and not FENCE_RE.match(prev)
        )
        if is_isolated:
            add_fn(
                doc,
                RULE_LAYOUT_TABLE_GAP,
                r0 + 1,
                "表格前一行是段落文本，缺空行分隔（GFM 会并入段落）",
                "在该表格前插入一个空行",
            )


def _check_table_blocks(doc: Doc, add_fn: Callable) -> None:
    """聚合与分析连续表格块结构。"""
    rows = [
        i
        for i, (ln, ins) in enumerate(zip(doc.lines, doc.inside))
        if not ins and TABLE_ROW_RE.match(ln)
    ]
    blocks: List[List[int]] = []
    for r in rows:
        if blocks and r == blocks[-1][-1] + 1:
            blocks[-1].append(r)
        else:
            blocks.append([r])

    for blk in blocks:
        _check_single_table_block(blk, doc, add_fn)


def check_layout(doc: Doc, decode_errors: Dict[str, Any], add_fn: Callable) -> None:
    """审查文档排版规范、结构化标准与表格对齐。"""
    if doc.rel == "" and doc.text == "":
        return
    if str(doc.path) in decode_errors:
        add_fn(
            doc,
            RULE_LAYOUT_FENCE,
            0,
            f"文件解码失败，无法审查: {decode_errors[str(doc.path)]}",
        )
        return

    _check_h1_and_fence(doc, add_fn)
    _check_backend_section_std(doc, add_fn)
    _check_archive_head(doc, add_fn)
    _check_table_blocks(doc, add_fn)
