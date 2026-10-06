#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · Mermaid 门禁)
# 文件路径: WebGames/scripts/py/docs_audit/mermaid.py
# 架构定位: Mermaid 图表解析与自愈引擎 (Mermaid Syntax Guard & Auto-Fixer)
# 依赖与触发: 触发方: DocsAuditor.check()/fix() | 上游: Doc.lines | 下游: Finding 发现项与原位修复 | 运行时: Python 3.10+
# 职责说明: Mermaid 图表语法健康度审查与节点标签特殊符号自动修复
# 退出语义与设计依据: 退出码: 纯检查与自愈函数无独立退出码 | 设计依据: AGENTS.md 施工细则与文档门禁契约
# ------------------------------------------------------------------------------
# 用法示例:
#   check_mermaid(doc, add_fn)
# ==============================================================================
"""Mermaid 图表语法健康度审查与节点标签特殊符号自动修复。"""
import re
from typing import Callable

from docs_audit.models import Doc, FENCE_RE

NODE_RE = re.compile(r"([\w\u4e00-\u9fff])\s*([\[\(\{])")
MERMAID_SKIP_RE = re.compile(
    r"^\s*(%%|subgraph\b|end\s*$|classDef\b|class\s|style\s|linkStyle\b|direction\b|"
    r"graph\s|flowchart\s|sequenceDiagram|stateDiagram|erDiagram|gantt|pie\b)")
SHAPE_CLOSE = {"[": "]", "(": ")", "{": "}"}
SPECIAL_CHARS = set("[]{}()")


def scan_mermaid_line(ln: str) -> list:
    """扫描一行 mermaid 节点定义。

    返回 [(open_col, open_ch, content, end_col)]：内容未整体加引号且含 [ ] { } ( ) 的形状。
    形状识别：ID 后跟 [ ( {，同型括号深度配对取内容（本库无 [( )]/([ ]) 复合形状，已核查）。
    """
    hits, pos = [], 0
    while True:
        m = NODE_RE.search(ln, pos)
        if not m:
            return hits
        open_ch = m.group(2)
        close_ch = SHAPE_CLOSE[open_ch]
        depth, j = 1, m.end()
        while j < len(ln) and depth:
            if ln[j] == open_ch:
                depth += 1
            elif ln[j] == close_ch:
                depth -= 1
            j += 1
        if depth:                        # 本行括号未闭合：交给人工，不在此误报
            return hits
        content = ln[m.end():j - 1]
        if not (content.startswith('"') and content.endswith('"') and len(content) >= 2):
            if any(c in SPECIAL_CHARS for c in content):
                hits.append((m.start(2), open_ch, content, j))
        pos = j


def mermaid_fix_line(ln: str) -> tuple[str, int]:
    """返回 (新行, 修复数)：对命中形状的内容整体加双引号（内容含引号则跳过留人工）。"""
    hits = scan_mermaid_line(ln)
    if not hits:
        return ln, 0
    out, pos, n = [], 0, 0
    for col, open_ch, content, end in hits:
        if '"' in content:
            continue
        out.append(ln[pos:col])
        out.append(open_ch + '"' + content + '"' + SHAPE_CLOSE[open_ch])
        pos = end
        n += 1
    out.append(ln[pos:])
    return "".join(out), n


def check_mermaid(doc: Doc, add_fn: Callable) -> None:
    """审查 mermaid 图表节点合法性。"""
    if not doc.has_mermaid:
        return
    in_mermaid = False
    for i, ln in enumerate(doc.lines, 1):
        if FENCE_RE.match(ln):
            lang = FENCE_RE.match(ln).group(2).lower()
            in_mermaid = (lang == "mermaid") if not in_mermaid else False
            continue
        if not in_mermaid or MERMAID_SKIP_RE.match(ln):
            continue
        for col, open_ch, content, _end in scan_mermaid_line(ln):
            add_fn(doc, "MERMAID-SPECIAL-CHARS", i,
                   f"节点标签含未加引号的特殊字符（{open_ch}…）",
                   f'{open_ch}"{content}"' + SHAPE_CLOSE[open_ch],
                   {"content": content[:80]})

