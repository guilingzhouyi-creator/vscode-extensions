#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 性能热点门禁)
# 文件路径: WebGames/scripts/py/audit_perf_hotspots.py
# 架构定位: 静态性能反模式检测器 (Performance Hotspot Linter)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: backend/**/*.gd | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 静态检测高频循环内 .new() 分配、.duplicate(true) 浅拷贝违规与六维转换反模式
# 退出语义与设计依据: 退出码: 0=合规, 1=存在性能隐患 | 设计依据: ADV-PRF-002 与 ADV-POOL-001
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_perf_hotspots.py
#   python scripts/py/audit_perf_hotspots.py --json
# ==============================================================================
"""扫描 backend/ GDScript 的静态性能热点（提示级，供人工复核）。"""
from __future__ import annotations
from pathlib import Path
from typing import Any
import argparse
import re
import sys

from audit_common import GD_LOOP_HEAD_RE, GD_GAMECONFIG_GETTER_RE
from audit_common import ensure_utf8_stdout, resolve_repo_root
ensure_utf8_stdout()

ROOT = resolve_repo_root()

LOOP_RE = GD_LOOP_HEAD_RE
CONFIG_IN_LOOP_RE = GD_GAMECONFIG_GETTER_RE
LINEAR_FIND_RE = re.compile(r"\.find\(")
# 字符串构建：`+= "字面量`、`%` 格式化、str()/String() 转换、字符串字面量拼接
# （纯数值累加如 `x += 1`、`sum += int(...)` 不匹配，避免误报）
STRING_BUILD_RE = re.compile(r'(\+= "|%\s*[\[A-Za-z_]|\bstr\(|String\(|"[^"\n]*"\s*\+)')
DEBUG_EMIT_RE = re.compile(r"(print\(|push_warning\(|push_error\(|\.emit\()")
HEAP_ALLOC_RE = re.compile(
    r"(\.new\(|\.duplicate\(\s*true\s*\)|RegEx\.create_from_string\s*\(|(?:AESContext|Crypto|HashingContext)\.new\s*\()"
)

CHECKS = {
    "nested": "嵌套循环(O(n²)候选)",
    "config": "循环内配置读取",
    "find": "循环内线性查找",
    "strbuild": "循环内字符串构建",
    "debug": "循环内调试/广播",
    "heap_alloc": "循环内瞬态堆分配(new/duplicate)",
}


def leading_ws(line: str) -> int:
    """计算行首缩进空格数。"""
    return len(line) - len(line.lstrip())


def _check_in_loop_patterns(ln: str, i: int, note_fn: Any) -> None:
    """检查循环体内的热点反模式。"""
    if CONFIG_IN_LOOP_RE.search(ln):
        note_fn("config", i, ln.strip())
    if LINEAR_FIND_RE.search(ln):
        note_fn("find", i, ln.strip())
    if STRING_BUILD_RE.search(ln):
        note_fn("strbuild", i, ln.strip())
    if DEBUG_EMIT_RE.search(ln):
        note_fn("debug", i, ln.strip())
    if HEAP_ALLOC_RE.search(ln):
        note_fn("heap_alloc", i, ln.strip())


def _handle_loop_header(ln: str, indent: int, i: int, stack: list[int], note_fn: Any) -> None:
    """处理循环语句头并维护缩进栈。"""
    while stack and stack[-1] >= indent:
        stack.pop()
    stack.append(indent)
    if len(stack) >= 2:
        note_fn("nested", i, ln.strip())


def _process_code_line(
    ln: str, i: int, stack: list[int], note: Callable[[str, int, str], None]
) -> int:
    """处理单行代码并追踪循环栈与热点。"""
    indent = leading_ws(ln)
    if LOOP_RE.match(ln):
        _handle_loop_header(ln, indent, i, stack, note)
        return 1

    while stack and indent <= stack[-1]:
        stack.pop()

    if stack and indent > stack[-1]:
        _check_in_loop_patterns(ln, i, note)
    return 0


def _record_hotspot_findings(
    rel: Path, loop_total: int, counts: dict[str, int], examples: list[str], findings: list[str]
) -> None:
    """组装并记录性能热点汇总行。"""
    total = sum(counts.values())
    if not (total or loop_total):
        return
    detail = "  例: " + "; ".join(examples) if examples else ""
    findings.append(
        f"{rel}: 循环 {loop_total} / 嵌套 {counts['nested']} / 配置读取 {counts['config']} "
        f"/ 线性查找 {counts['find']} / 字符串构建 {counts['strbuild']} / 调试广播 {counts['debug']} "
        f"/ 瞬态堆分配 {counts['heap_alloc']}{detail}"
    )


def audit_file(path: Path, findings: list[str]) -> None:
    """扫描单个 GDScript 文件中的循环与热点模式。"""
    rel = path.relative_to(ROOT)
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (UnicodeDecodeError, OSError):
        return

    counts = {k: 0 for k in CHECKS}
    loop_total = 0
    stack: list[int] = []
    examples: list[str] = []

    def note(kind: str, lineno: int, snippet: str) -> None:
        """记录热点统计与前 6 处样例。"""
        counts[kind] += 1
        if len(examples) < 6:
            examples.append(f"L{lineno} {CHECKS[kind]}: {snippet.strip()[:72]}")

    for i, ln in enumerate(lines, 1):
        stripped = ln.lstrip()
        if stripped and not stripped.startswith("#"):
            loop_total += _process_code_line(ln, i, stack, note)

    _record_hotspot_findings(rel, loop_total, counts, examples, findings)


def main() -> int:
    """CLI 入口：扫描 backend/**/*.gd 与 frontend/**/*.gd 循环内热点反模式。"""
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true", help="有发现即返回 1")
    args = ap.parse_args()

    files = sorted(
        p
        for sub in ("backend", "frontend")
        if (ROOT / sub).exists()
        for p in (ROOT / sub).rglob("*.gd")
        if p.is_file()
    )
    findings: list[str] = []
    for f in files:
        audit_file(f, findings)

    with_hotspots = sum(1 for fd in findings if "例:" in fd)
    print(f"【audit-perf-hotspots】审查文件: {len(files)} 个 / 含热点候选: {with_hotspots} 个（提示级）")
    for fd in findings:
        print(f"  · {fd}")
    if args.strict and with_hotspots:
        print("【审查结论】--strict 模式未通过")
        return 1
    print("【审查结论】通过（提示级）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
