#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 零硬编码门禁)
# 文件路径: WebGames/scripts/py/audit_hardcode.py
# 架构定位: 业务字面量高性能扫描器 (High-Performance Hardcode Literal Detector)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: backend/**/*.gd | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 深度扫描业务源码中的裸魔法数字、内联中文字符串与直接配置字面量，守护零硬编码铁律
# 退出语义与设计依据: 退出码: 0=合规, 1=存在硬编码 | 设计依据: AGENTS.md 零硬编码红线与行前置快速过滤漏斗
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_hardcode.py
#   python scripts/py/audit_hardcode.py --json
# ==============================================================================
"""扫描 backend/ 与 frontend/ 中疑似硬编码的数值/文案字面量与调试残留。"""

from __future__ import annotations
from pathlib import Path
import argparse
import re
import sys

from audit_common import ensure_utf8_stdout, resolve_repo_root
ensure_utf8_stdout()

ROOT = resolve_repo_root()

MIN_MAGIC_INTEGER_DIGITS = 4
MIN_BUSINESS_STRING_LENGTH = 4
TOP_N = 10

FORBIDDEN_LORE_TOKENS: tuple[str, ...] = (
    "卡拉尔",
    "瓦尔兰",
    "阿尔托莉雅",
    "official_kalar",
)

_CJK_RE = re.compile(r"[\u4e00-\u9fff]")
_TECH_PREFIXES: tuple[str, ...] = (
    "res://",
    "user://",
    "mod://",
    "godot://",
    "http://",
    "https://",
    "ui.",
    "domains.",
    "infrastructure.",
    "narratives.",
    "frontend.",
    "backend.",
    "mods.",
    "config.",
)
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{3,8}$")
_LOWER_KEY_RE = re.compile(r"^[a-z][a-z0-9_]*$")
_UPPER_CONST_RE = re.compile(r"^[A-Z0-9_]+$")
_DOTTED_OR_PATH_RE = re.compile(r"^[A-Za-z0-9_.\-/]+$")

NUM_RE = re.compile(
    rf"(?<![0-9a-zA-Z_.])(\d{{{MIN_MAGIC_INTEGER_DIGITS},}})(?![0-9a-zA-Z_])"
)
DEC_RE = re.compile(r"(?<![0-9a-zA-Z_.])(\d+\.\d+)(?![0-9a-zA-Z_])")
STRING_RE = re.compile(rf'"([^"\n]{{{MIN_BUSINESS_STRING_LENGTH},}})"')
ALL_STRING_RE = re.compile(r'"([^"\n]*)"')
DEBUG_RE = re.compile(r"\bprint\s*\(")
TODO_RE = re.compile(r"\b(TODO|FIXME|HACK)\b")


def is_benign_technical_string(inner: str) -> bool:
    """判定字符串是否为路径、配置键、i18n 键、协议常量等非业务文案技术标识。"""
    if not inner:
        return True
    if any(tok in inner for tok in FORBIDDEN_LORE_TOKENS):
        return False
    if _CJK_RE.search(inner):
        return False
    if inner.startswith(_TECH_PREFIXES) or _HEX_COLOR_RE.match(inner):
        return True
    if any(ch.isspace() for ch in inner):
        stripped_fmt = re.sub(r"[%{}0-9sfd.,:;\-_/|()\[\]\s]", "", inner)
        return stripped_fmt == ""
    if _LOWER_KEY_RE.match(inner) or _UPPER_CONST_RE.match(inner):
        return True
    if ("/" in inner or "." in inner or "_" in inner) and _DOTTED_OR_PATH_RE.match(inner):
        return True
    stripped_sym = re.sub(r"[%{}0-9.,:;\-_/|()\[\]+*=<>&!@#$^~`?\\]", "", inner)
    return len(stripped_sym) <= 1


def strip_comment(line: str) -> str:
    """引号感知剥离 GDScript 行注释，避免字符串内 `#` 截断同行后续代码。"""
    quote_char = ""
    escaped = False
    for idx, ch in enumerate(line):
        if escaped:
            escaped = False
            continue
        if ch == "\\" and quote_char:
            escaped = True
            continue
        if ch in ('"', "'"):
            if not quote_char:
                quote_char = ch
            elif quote_char == ch:
                quote_char = ""
            continue
        if ch == "#" and not quote_char:
            return line[:idx]
    return line


def _check_digits(code: str, i: int, counts: list[int], examples: list[str]) -> None:
    """提取整型与小数魔法数字。"""
    for m in NUM_RE.finditer(code):
        counts[0] += 1
        if counts[0] <= 3:
            examples.append(f"L{i} 数值 {m.group(1)}")
    for m in DEC_RE.finditer(code):
        counts[1] += 1
        if counts[1] <= 3:
            examples.append(f"L{i} 小数 {m.group(1)}")


def _check_debug_and_todo(code: str, ln: str, i: int, counts: list[int], examples: list[str]) -> None:
    """提取 print 调试与 TODO/FIXME/HACK 标记。"""
    if "print" in ln and DEBUG_RE.search(code):
        counts[3] += 1
        examples.append(f"L{i} print(")

    tm = TODO_RE.search(ln)
    if tm:
        counts[4] += 1
        examples.append(f"L{i} {tm.group(1)}")


def _scan_code_line(
    ln: str, i: int, counts: list[int], examples: list[str]
) -> None:
    """扫描单行代码中的数值、业务字符串、禁忌词元、调试与 TODO 残留。"""
    code = strip_comment(ln)
    if not code:
        return
    _check_digits(code, i, counts, examples)
    if '"' in code:
        for sm in ALL_STRING_RE.finditer(code):
            inner = sm.group(1)
            if any(tok in inner for tok in FORBIDDEN_LORE_TOKENS):
                counts[5] += 1
                if counts[5] <= 3:
                    examples.append(f"L{i} 禁忌词 \"{inner[:28]}\"")
                continue
            if len(inner) >= MIN_BUSINESS_STRING_LENGTH and not is_benign_technical_string(inner):
                counts[2] += 1
                if counts[2] <= 2:
                    examples.append(f"L{i} 字符串 \"{inner[:28]}\"")
    _check_debug_and_todo(code, ln, i, counts, examples)


def _scan_gd_file(f: Path) -> tuple[int, int, str, str | None] | None:
    """扫描单个 GDScript 文件的字面量与残留，返回 (file_total, strict_total, rel_path, summary_line)。"""
    rel = f.relative_to(ROOT)
    try:
        content = f.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return None

    counts = [0, 0, 0, 0, 0, 0]  # ints, decimals, strs, dbg, todo, lore
    examples: list[str] = []
    for i, ln in enumerate(content.splitlines(), 1):
        _scan_code_line(ln, i, counts, examples)

    file_total = sum(counts)
    strict_total = counts[3] + counts[4] + counts[5] + counts[2]
    if not file_total:
        return 0, 0, str(rel), None

    ints, decimals, strs, dbg, todo, lore = counts
    detail = "  例: " + "; ".join(examples[:4]) if examples else ""
    summary = f"{rel}: 数值 {ints} / 小数 {decimals} / 业务串 {strs} / print {dbg} / TODO {todo} / 禁忌 {lore}{detail}"
    return file_total, strict_total, str(rel), summary


def main() -> int:
    """CLI 入口。"""
    ap = argparse.ArgumentParser(description="业务源码字面量与调试残留扫描器")
    ap.add_argument("--strict", action="store_true", help="存在 print/TODO/禁忌词或业务硬编码串时返回 1")
    args = ap.parse_args()

    findings: list[str] = []
    per_file: list[tuple[int, str]] = []
    total = 0
    strict_total = 0
    scan_roots = [ROOT / "backend", ROOT / "frontend"]

    for f in sorted(p for r in scan_roots for p in r.rglob("*.gd")):
        if not f.is_file():
            continue
        res = _scan_gd_file(f)
        if res is None:
            continue
        file_total, file_strict, rel_str, summary = res
        total += file_total
        strict_total += file_strict
        per_file.append((file_total, rel_str))
        if summary:
            findings.append(summary)

    print(
        f"【audit-hardcode】扫描 backend+frontend 共 {total} 处候选（严格项 {strict_total}，提示级需人工复核）"
    )
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
