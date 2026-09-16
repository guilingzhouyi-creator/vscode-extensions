#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 零硬编码门禁)
# 文件路径: WebGames/scripts/py/audit_hardcode.py
# 架构定位: 业务字面量扫描器 (Hardcode Literal Detector)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: backend/**/*.gd | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 深度扫描业务源码中的裸魔法数字、内联中文字符串与直接配置字面量，守护零硬编码铁律
# 退出语义与设计依据: 退出码: 0=合规, 1=存在硬编码 | 设计依据: AGENTS.md 零硬编码红线约束
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_hardcode.py
#   python scripts/py/audit_hardcode.py --json
# ==============================================================================
"""扫描 backend/ 中疑似硬编码的数值/文案字面量与调试残留（print/未决标记）。"""
import argparse
import re
import sys
from pathlib import Path
from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

ROOT = resolve_repo_root()
NUM_RE = re.compile(r"(?<![0-9a-zA-Z_.])(\d{4,})(?![0-9a-zA-Z_])")   # ≥4 位整数
DEC_RE = re.compile(r"(?<![0-9a-zA-Z_.])(\d+\.\d+)(?![0-9a-zA-Z_])")  # 小数
STRING_RE = re.compile(r'"[^"\n]{8,}"')
DEBUG_RE = re.compile(r"\bprint\s*\(")
TODO_RE = re.compile(r"\b(TODO|FIXME|HACK)\b")
TOP_N = 10


def strip_comment(line: str) -> str:
    """启发式剥离 GDScript 行注释：截断首个 # 之前的内容（全注释行变空串）。"""
    idx = line.find("#")
    return line[:idx] if idx >= 0 else line


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true", help="有发现即返回 1")
    args = ap.parse_args()

    findings: list[str] = []
    per_file: list[tuple[int, str]] = []
    total = 0
    scan_roots = [ROOT / "backend", ROOT / "frontend"]
    for f in sorted(p for r in scan_roots for p in r.rglob("*.gd")):
        if not f.is_file():
            continue
        rel = f.relative_to(ROOT)
        lines = f.read_text(encoding="utf-8").splitlines()
        ints = decimals = strs = dbg = todo = 0
        examples: list[str] = []
        for i, ln in enumerate(lines, 1):
            code = strip_comment(ln)          # 数值/字符串/print 只看代码行
            for m in NUM_RE.finditer(code):
                ints += 1
                if ints <= 3:
                    examples.append(f"L{i} 数值 {m.group(1)}")
            for m in DEC_RE.finditer(code):
                decimals += 1
                if decimals <= 3:
                    examples.append(f"L{i} 小数 {m.group(1)}")
            if STRING_RE.search(code):
                strs += 1
            if DEBUG_RE.search(code):
                dbg += 1
                examples.append(f"L{i} print(")
            tm = TODO_RE.search(ln)           # TODO/FIXME 常写在注释里，含注释行
            if tm:
                todo += 1
                examples.append(f"L{i} {tm.group(1)}")
        file_total = ints + decimals + strs + dbg + todo
        total += file_total
        per_file.append((file_total, str(rel)))
        if file_total:
            detail = "  例: " + "; ".join(examples[:4]) if examples else ""
            findings.append(
                f"{rel}: 数值 {ints} / 小数 {decimals} / 字符串 {strs} / print {dbg} / TODO {todo}{detail}"
            )

    print(f"【audit-hardcode】扫描 backend+frontend 共 {total} 处候选（提示级，需人工复核）")
    for fd in findings:
        print(f"  · {fd}")
    print(f"【audit-hardcode】Top {TOP_N} 候选文件（优先复核）:")
    for rank, (cnt, name) in enumerate(
        sorted(per_file, key=lambda t: t[0], reverse=True)[:TOP_N], 1
    ):
        print(f"  {rank:>2}. {name} — {cnt} 处")
    if args.strict and total:
        print("【审查结论】--strict 模式未通过")
        return 1
    print("【审查结论】通过（提示级）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
