#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · GDScript 风格门禁)
# 文件路径: WebGames/scripts/py/gd/style_rules.py
# 架构定位: GDScript 基础编码风格与注释规范门禁 (GDScript Style Checker)
# 依赖与触发: 触发方: audit_gd.py | 上游: backend/**/*.gd | 下游: 控制台违规告警 | 运行时: Python 3.10+
# 职责说明: 强校验 GDScript 六字段题头、PascalCase 类名、snake_case 函数与未决注释标记
# 退出语义与设计依据: 退出码: 0=合规, 1=存在风格违规 | 设计依据: 后端注释统一规范与 COMMENT-PENDING-MARKER
# ------------------------------------------------------------------------------
# 用法示例:
#   from gd.style_rules import run_style_audit
# ==============================================================================
"""GDScript 编码风格与基础语法审查规则集。"""

from __future__ import annotations

import re
from pathlib import Path

from gd.gd_common import (
    CLASS_NAME_RE,
    FILE_NAME_RE,
    ROOT,
    SNAKE_RE,
    UPPER_RE,
    GDFileCache,
    get_gd_files,
)

STYLE_CLASS_NAME_RE = re.compile(r"\bclass_name\s+([A-Za-z_][A-Za-z0-9_]*)")
STYLE_FUNC_RE = re.compile(r"^\s*(?:static\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(")
STYLE_VAR_RE = re.compile(r"^\s*(?:static\s+)?var\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:=]")
STYLE_CONST_RE = re.compile(r"^\s*(?:static\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:=]")
PENDING_MARKER_RE = re.compile(r"#.*\b(TODO|FIXME|XXX|HACK)\b")
HEADER_MUST = ("文件路径:", "职责")


def _audit_file_header(rel: Path, lines: list[str], text: str, violations: list[str]) -> None:
    """校验文件头部注释与全局调用禁令。"""
    head = "\n".join(lines[:14])
    rel_posix = rel.as_posix()
    if not rel_posix.startswith("tests/"):
        for marker in HEADER_MUST:
            if marker not in head:
                violations.append(f"{rel}: 文件头缺少「{marker}」注释")
    if "GameConfig.get_value(" in text:
        violations.append(f"{rel}: 禁止外部调用 GameConfig.get_value（返回 Variant 触发警告即错误）")


def _check_style_identifiers(rel: Path, i: int, ln: str, violations: list[str]) -> None:
    """检查 class_name、func、var 的命名规范。"""
    m = STYLE_CLASS_NAME_RE.search(ln)
    if m and not CLASS_NAME_RE.match(m.group(1)):
        violations.append(f"{rel}:{i}: class_name 应为 PascalCase（{m.group(1)}）")
    m = STYLE_FUNC_RE.search(ln)
    if m and not SNAKE_RE.match(m.group(1)):
        violations.append(f"{rel}:{i}: 函数名应为 snake_case（{m.group(1)}）")
    m = STYLE_VAR_RE.search(ln)
    if m and not SNAKE_RE.match(m.group(1)):
        violations.append(f"{rel}:{i}: 变量名应为 snake_case（{m.group(1)}）")


def _check_style_const_and_marker(rel: Path, i: int, ln: str, violations: list[str]) -> None:
    """检查常量定义风格与未决标记。"""
    m = STYLE_CONST_RE.search(ln)
    if m:
        name = m.group(1)
        if "preload(" in ln:
            if not CLASS_NAME_RE.match(name):
                violations.append(f"{rel}:{i}: preload 常量引用应为 PascalCase（{name}）")
        elif not UPPER_RE.match(name):
            violations.append(f"{rel}:{i}: 常量应为 UPPER_SNAKE_CASE（{name}）")
    pm = PENDING_MARKER_RE.search(ln)
    if pm:
        violations.append(f"{rel}:{i}: 注释含未决标记「{pm.group(1)}」——须落实为客观技术实现或移除（COMMENT-PENDING-MARKER）")


def _audit_line_style(rel: Path, i: int, ln: str, violations: list[str]) -> None:
    """审查单行 GDScript 的命名风格与未决标记。"""
    _check_style_identifiers(rel, i, ln, violations)
    _check_style_const_and_marker(rel, i, ln, violations)


def audit_file(path: Path, violations: list[str]) -> None:
    """对单个 .gd 文件进行编码风格与头部注释静态检查。"""
    rel = path.relative_to(ROOT)
    if not FILE_NAME_RE.match(path.name):
        violations.append(f"{rel}: 文件名应为 snake_case（{path.name}）")
    try:
        text, lines = GDFileCache.get(path)
    except (UnicodeDecodeError, OSError) as e:
        violations.append(f"{rel}: 非 UTF-8 编码或读取失败（{e}）")
        return

    _audit_file_header(rel, lines, text, violations)

    for i, ln in enumerate(lines, 1):
        _audit_line_style(rel, i, ln, violations)


def run_style_audit(include_tests: bool = False) -> int:
    """执行风格审查主循环。"""
    files = get_gd_files(include_tests)

    violations: list[str] = []
    for f in files:
        audit_file(f, violations)

    print(f"【audit-gd-style】审查文件: {len(files)} 个")
    if violations:
        print("【audit-gd-style】违规项:")
        for v in violations:
            print(f"  ✗ {v}")
        print("【审查结论】未通过")
        return 1
    print("【审查结论】通过")
    return 0
