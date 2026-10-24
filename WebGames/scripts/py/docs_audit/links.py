#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 链接有效性门禁)
# 文件路径: WebGames/scripts/py/docs_audit/links.py
# 架构定位: 链接与锚点完整性审计器 (Link & Anchor Integrity Auditor)
# 依赖与触发: 触发方: DocsAuditor.check()/fix() | 上游: Doc.lines | 下游: Finding 发现项与相对路径重写 | 运行时: Python 3.10+
# 职责说明: Markdown 相对路径死链、锚点有效性与 file:/// 绝对路径重写
# 退出语义与设计依据: 退出码: 纯检查与链接重写函数无独立退出码 | 设计依据: AGENTS.md 施工细则与文档门禁契约
# ------------------------------------------------------------------------------
# 用法示例:
#   check_links(doc, docs_map, add_fn, get_doc_fn, abs_target_fn, rel_fn)
# ==============================================================================
"""Markdown 相对路径死链、锚点有效性与 file:/// 绝对路径重写。"""
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
import os
import re
import urllib.parse

from docs_audit.models import (
    ABSLINK_RE,
    Doc,
    RELLINK_RE,
    slugify,
)
HASH_SEP = "#"
HYPHEN_SEP = "-"


@dataclass(frozen=True, slots=True)
class LinkAuditContext:
    """链接与锚点审计上下文对象 (GOV-DAT-001)。"""

    docs_map: dict
    add_fn: Callable
    get_doc_fn: Callable
    abs_target_fn: Callable
    rel_fn: Callable


def resolve_abs_target(frag: str, docs_dir: Path) -> str:
    """file:///c:/…/docs/<rest> → 仓库内目标路径；不可解析返回 ''。"""
    frag_u = urllib.parse.unquote(frag)
    m = re.search(r"/docs/(.+)$|/docs$", frag_u)
    if not m:
        return ""
    rest = m.group(1) or ""
    cand = docs_dir.joinpath(*rest.split("/")) if rest else docs_dir
    return str(cand) if cand.exists() else ""


def _check_abs_link_match(
    m: Any,
    line_idx: int,
    doc: Doc,
    ctx: LinkAuditContext,
) -> None:
    frag, _, anchor = m.group()[2:-1].strip().partition(HASH_SEP)
    target = ctx.abs_target_fn(frag)
    if not target:
        ctx.add_fn(doc, "LINK-DEAD", line_idx, f"file:/// 链接目标不存在: {urllib.parse.unquote(frag)[:90]}")
        return
    ctx.add_fn(doc, "LINK-ABS-FILE-URI", line_idx, "file:/// 绝对路径链接（目标可解析，可安全转相对链接）", suggestion=target)
    tpath = Path(target)
    if not (anchor and tpath.suffix == ".md"):
        return
    tdoc = ctx.get_doc_fn(tpath)
    if tdoc is None:
        return
    slug = slugify(urllib.parse.unquote(anchor))
    if slug not in tdoc.heading_slugs:
        tail = slug.rsplit(HYPHEN_SEP, 1)[-1]
        cands = [s for s in tdoc.heading_slugs if s.rsplit(HYPHEN_SEP, 1)[-1] == tail][:3]
        ctx.add_fn(
            doc,
            "LINK-ANCHOR-DEAD",
            line_idx,
            f'锚点失效: #{urllib.parse.unquote(anchor)[:60]}（目标 {tpath.name}）',
            suggestion="候选: " + " | ".join(cands) if cands else "无相近候选，需人工核对目标章节",
        )


def _check_rel_link_match(
    m: Any,
    line_idx: int,
    doc: Doc,
    ctx: LinkAuditContext,
) -> None:
    t = m.group(1)
    if t.startswith(("http://", "https://", "file:///")):
        return
    frag, _, anchor = t.partition(HASH_SEP)
    frag_norm = urllib.parse.unquote(frag).replace("\\", "/")
    dest = doc.path.parent / frag_norm
    dest_key = str(dest)
    if dest_key not in ctx.docs_map and not dest.exists():
        ctx.add_fn(doc, "LINK-DEAD", line_idx, f"相对链接目标不存在: {frag}")
        return
    if not anchor or dest.suffix != ".md":
        return
    target_doc = ctx.get_doc_fn(dest)
    if target_doc is None:
        return
    slug = slugify(urllib.parse.unquote(anchor))
    if slug not in target_doc.heading_slugs:
        tail = slug.rsplit(HYPHEN_SEP, 1)[-1]
        cands = [s for s in target_doc.heading_slugs if s.rsplit(HYPHEN_SEP, 1)[-1] == tail][:3]
        ctx.add_fn(
            doc,
            "LINK-ANCHOR-DEAD",
            line_idx,
            f'锚点失效: #{urllib.parse.unquote(anchor)[:60]}（目标 {ctx.rel_fn(dest)}）',
            suggestion="候选: " + " | ".join(cands) if cands else "无相近候选，需人工核对目标章节",
        )


def check_links(doc: Doc, ctx: LinkAuditContext) -> None:
    """审查文档内的绝对路径、相对路径与目标锚点完整性。"""
    for i, (ln, ins) in enumerate(zip(doc.lines, doc.inside), 1):
        if ins or doc.rel.startswith("docs/模板/"):
            continue

        for m in ABSLINK_RE.finditer(ln):
            _check_abs_link_match(m, i, doc, ctx)

        for m in RELLINK_RE.finditer(ln):
            _check_rel_link_match(m, i, doc, ctx)


def fix_abs_links(text: str, src: Path, abs_target_fn: Callable) -> tuple:
    """重写文档中的 file:/// 绝对链接为干净相对链接。"""
    n = 0

    def repl(m: Any) -> str:
        """正则匹配回调：将匹配到的绝对路径替换为相对路径。"""
        nonlocal n
        inner = m.group()[2:-1].strip()
        frag, _, anchor = inner.partition(HASH_SEP)
        target = abs_target_fn(frag)
        if not target:
            return m.group()
        rel = os.path.relpath(Path(target), src.parent).replace("\\", "/")
        n += 1
        return "](" + rel + (("#" + anchor) if anchor else "") + ")"

    return ABSLINK_RE.sub(repl, text), n
