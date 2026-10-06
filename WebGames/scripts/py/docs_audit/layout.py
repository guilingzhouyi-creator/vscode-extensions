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
from typing import Any, Callable

from audit_common import KALAR_DEV_PREFIX
from docs_audit.models import (
    Doc,
    FENCE_RE,
    LIST_PREFIX_RE,
    TABLE_ROW_RE,
)


def check_layout(doc: Doc, decode_errors: dict, add_fn: Callable) -> None:
    """审查文档排版规范、结构化标准与表格对齐。"""
    if doc.rel == "" and doc.text == "":
        return
    if str(doc.path) in decode_errors:
        add_fn(doc, "LAYOUT-FENCE-UNCLOSED", 0,
               f"文件解码失败，无法审查: {decode_errors[str(doc.path)]}")
        return

    h1 = [i + 1 for i, (ln, ins) in enumerate(zip(doc.lines, doc.inside))
          if not ins and re.match(r"^#(\s|$)", ln)]
    if len(h1) > 1:
        add_fn(doc, "LAYOUT-H1-MULTI", h1[0],
               f"发现 {len(h1)} 个一级标题（行 {h1[:5]}{'…' if len(h1) > 5 else ''}），应合并为单一 H1")
    elif not h1 and any(ln.strip() for ln in doc.lines):
        add_fn(doc, "LAYOUT-H1-ABSENT", 0, "全文无一级标题")

    if doc.inside and doc.inside[-1]:
        add_fn(doc, "LAYOUT-FENCE-UNCLOSED", len(doc.lines), "文件结尾处存在未闭合代码围栏")

    # 四段式结构标准（仅约束后端需求表：一实体/二求解/三状态机/四验收，对应路线图 4 大标准阶段）
    if re.fullmatch(r"后端架构需求表\d+\.md", os.path.basename(str(doc.path))):
        h2 = [ln for ln, ins in zip(doc.lines, doc.inside) if not ins and ln.startswith("## ")]
        have = {ln[3].strip() for ln in h2 if len(ln) > 3}
        missing = [n for n in "一二三四" if n not in have]
        if missing:
            add_fn(doc, "LAYOUT-SECTION-STD", 0,
                   "缺少标准章节: " + " ".join("## " + n + "、" for n in missing)
                   + "（补齐后归档阶段3/4 真理指针方可指向真实章节）")

    # 归档件头块标准：归档库阶段件前 20 行须含 档号: 与 验收状态（两态生命周期归档时补齐）
    rel_posix = doc.rel
    if "归档库/" in rel_posix and re.search(KALAR_DEV_PREFIX + r"-(RM|FE)\d{2}-\d{3}_阶段\d_", rel_posix):
        head = "\n".join(doc.lines[:20])
        lack = [k for k in ("档号:", "验收状态") if k not in head]
        if lack:
            add_fn(doc, "LAYOUT-ARCHIVE-HEAD", 0,
                   f"归档件缺档案头块字段: {' / '.join(lack)}"
                   "（归档时须补 档号/题名/验收状态/主题词 等键值头）")

    # 表格连续块：列数一致性 + 表前空行
    rows = [i for i, (ln, ins) in enumerate(zip(doc.lines, doc.inside))
            if not ins and TABLE_ROW_RE.match(ln)]
    blocks = []
    for r in rows:
        if blocks and r == blocks[-1][-1] + 1:
            blocks[-1].append(r)
        else:
            blocks.append([r])

    for blk in blocks:
        if len(blk) == 1:
            add_fn(doc, "LAYOUT-TABLE-COLS", blk[0] + 1, "孤立表格行（缺表头/分隔行）")
            continue

        def ncols(ln: str) -> int:
            """单元格数 = 去首尾竖线后剩余未转义竖线数 + 1（兼容省略行尾竖线的行）。"""
            s = re.sub(r"\\\|", "\x00", ln.strip())
            if s.startswith("|"):
                s = s[1:]
            if s.endswith("|"):
                s = s[:-1]
            return s.count("|") + 1

        head = ncols(doc.lines[blk[0]])
        for r in blk:
            c = ncols(doc.lines[r])
            if c != head:
                add_fn(doc, "LAYOUT-TABLE-COLS", r + 1, f"表格行 {c} 列，表头 {head} 列")

        r0 = blk[0]
        if r0 > 0:
            prev = doc.lines[r0 - 1]
            if prev.strip() and not doc.inside[r0 - 1] \
                    and not prev.lstrip().startswith(("#", ">", "|")) \
                    and not LIST_PREFIX_RE.match(prev) and not FENCE_RE.match(prev):
                add_fn(doc, "LAYOUT-TABLE-GAP", r0 + 1,
                       "表格前一行是段落文本，缺空行分隔（GFM 会并入段落）", "在该表格前插入一个空行")

