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
import argparse
import re
import sys
from pathlib import Path

from audit_common import ensure_utf8_stdout, resolve_repo_root
from audit_common import GD_LOOP_HEAD_RE, GD_GAMECONFIG_GETTER_RE

ensure_utf8_stdout()

ROOT = resolve_repo_root()

LOOP_RE = GD_LOOP_HEAD_RE
CONFIG_IN_LOOP_RE = GD_GAMECONFIG_GETTER_RE
LINEAR_FIND_RE = re.compile(r"\.find\(")
# 字符串构建：`+= "字面量`、`%` 格式化、str()/String() 转换、字符串字面量拼接
# （纯数值累加如 `x += 1`、`sum += int(...)` 不匹配，避免误报）
STRING_BUILD_RE = re.compile(r'(\+= "|%\s*[\[A-Za-z_]|\bstr\(|String\(|"[^"\n]*"\s*\+)')
DEBUG_EMIT_RE = re.compile(r"(print\(|push_warning\(|push_error\(|\.emit\()")
HEAP_ALLOC_RE = re.compile(r"(\.new\(|\.duplicate\(\s*true\s*\))")

CHECKS = {
    "nested": "嵌套循环(O(n²)候选)",
    "config": "循环内配置读取",
    "find": "循环内线性查找",
    "strbuild": "循环内字符串构建",
    "debug": "循环内调试/广播",
    "heap_alloc": "循环内瞬态堆分配(new/duplicate)",
}


def leading_ws(line: str) -> int:
    return len(line) - len(line.lstrip())


def audit_file(path: Path, findings: list[str]) -> None:
    rel = path.relative_to(ROOT)
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except UnicodeDecodeError:
        return

    counts = {k: 0 for k in CHECKS}
    loop_total = 0
    stack: list[int] = []  # 循环行缩进栈
    examples: list[str] = []

    def note(kind: str, lineno: int, snippet: str) -> None:
        counts[kind] += 1
        if len(examples) < 6:
            examples.append(f"L{lineno} {CHECKS[kind]}: {snippet.strip()[:72]}")

    for i, ln in enumerate(lines, 1):
        stripped = ln.lstrip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = leading_ws(ln)

        if LOOP_RE.match(ln):
            loop_total += 1
            while stack and stack[-1] > indent:
                stack.pop()
            # 同缩进的兄弟循环视为并列（先弹掉同层再入栈）
            while stack and stack[-1] == indent:
                stack.pop()
            stack.append(indent)
            if len(stack) >= 2:
                note("nested", i, ln.strip())
            continue

        # 退出循环检测：当前行缩进小于或等于栈顶循环缩进，说明已退出循环体
        while stack and indent <= stack[-1]:
            stack.pop()

        # 循环体内检查：栈顶循环的缩进小于当前行缩进
        if stack and indent > stack[-1]:
            if CONFIG_IN_LOOP_RE.search(ln):
                note("config", i, ln.strip())
            if LINEAR_FIND_RE.search(ln):
                note("find", i, ln.strip())
            if STRING_BUILD_RE.search(ln):
                note("strbuild", i, ln.strip())
            if DEBUG_EMIT_RE.search(ln):
                note("debug", i, ln.strip())
            if HEAP_ALLOC_RE.search(ln):
                note("heap_alloc", i, ln.strip())

    total = sum(counts.values())
    if total or loop_total:
        detail = "  例: " + "; ".join(examples) if examples else ""
        findings.append(
            f"{rel}: 循环 {loop_total} / 嵌套 {counts['nested']} / 配置读取 {counts['config']} "
            f"/ 线性查找 {counts['find']} / 字符串构建 {counts['strbuild']} / 调试广播 {counts['debug']} "
            f"/ 瞬态堆分配 {counts['heap_alloc']}{detail}"
        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true", help="有发现即返回 1")
    args = ap.parse_args()

    files = sorted(p for p in (ROOT / "backend").rglob("*.gd") if p.is_file())
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
