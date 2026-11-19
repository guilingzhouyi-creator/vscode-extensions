#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 静态架构规则共享助手)
# 文件路径: WebGames/scripts/py/lib/arch_guard_common.py
# 架构定位: 架构护栏源码扫描与字面量脱敏共享助手
# 依赖与触发: 触发方: arch_guard_rules* | 上游: backend/ 与 frontend/ | 下游: 静态规则断言 | 运行时: Python 3.10+
# 职责说明: 提供 .gd 源码统一遍历与字符串字面量脱敏扫描工具，避免规则子模块重复遍历磁盘
# 退出语义与设计依据: 工具库模块，无进程退出码 | 设计依据: 架构护栏静态扫描单一真源原则
# ------------------------------------------------------------------------------
# 用法示例:
#   from lib.arch_guard_common import RES_PREFIX, iter_gd_sources, strip_string_contents
# ==============================================================================
"""架构护栏静态扫描公共助手：源码迭代与字符串字面量遮蔽。"""

from __future__ import annotations
from pathlib import Path
from typing import Any, Callable
import re

RES_PREFIX = "res://"
_STRING_TOKEN_RE = re.compile(r'("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\')')


def strip_string_contents(comment_stripped: str) -> str:
    """将注释已剥离的源码中的字符串字面量内部替换为空格，保留行偏移与引号边界。"""

    def repl(m: re.Match[str]) -> str:
        s = m.group(0)
        return s[0] + (" " * (len(s) - 2)) + s[-1]

    return _STRING_TOKEN_RE.sub(repl, comment_stripped)


def iter_gd_sources(
    ctx: Any,
    strip_comments: Callable[[str], str],
) -> list[tuple[str, str]]:
    """遍历 backend 与 frontend 全量 .gd 源码并返回 (relative_posix, comment_stripped_code)。"""
    entries: list[tuple[str, str]] = []
    for sub in ("backend", "frontend"):
        root_dir: Path = ctx.root / sub
        if not root_dir.exists():
            continue
        for gd_file in sorted(root_dir.rglob("*.gd")):
            rel_posix = gd_file.relative_to(ctx.root).as_posix()
            cached = ctx.gd_sources.get(gd_file)
            if cached is not None:
                entries.append((rel_posix, cached[1]))
            else:
                raw = gd_file.read_text(encoding="utf-8")
                entries.append((rel_posix, strip_comments(raw)))
    return entries
