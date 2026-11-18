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
from pathlib import Path
import re

from gd.gd_common import (
    CLASS_NAME_RE,
    FILE_NAME_RE,
    ROOT,
    SNAKE_RE,
    UPPER_RE,
    GDFileCache,
    get_gd_files,
)
from gd.strict_governance_rules import (
    CLASS_NAME_STRICT_RE,
    check_forbidden_jargon,
    check_strict_class_and_docs,
    check_strict_header,
    check_strict_jargon_and_decls,
    is_strict_governance_target,
)
STYLE_CLASS_NAME_RE = re.compile(r"\bclass_name\s+([A-Za-z_][A-Za-z0-9_]*)")
STYLE_INNER_CLASS_RE = re.compile(r"^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:extends\s+[A-Za-z0-9_]+)?\s*:")
STYLE_FUNC_RE = re.compile(r"^\s*(?:static\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(")
STYLE_VAR_RE = re.compile(r"^\s*(?:static\s+)?var\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:=]")
STYLE_CONST_RE = re.compile(r"^\s*(?:static\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*[:=]")
PENDING_MARKER_RE = re.compile(r"#.*\b(TODO|FIXME|XXX|HACK)\b")
HEADER_MUST = ("文件路径:", "职责")
ALLOWED_SHORT_FUNCS = frozenset({"on", "to", "as", "is", "up", "in"})


def _audit_file_header(rel: Path, lines: list[str], text: str, violations: list[str]) -> None:
    """校验文件头部注释与全局调用禁令。"""
    head = "\n".join(lines[:15])
    rel_posix = rel.as_posix()
    if is_strict_governance_target(rel_posix):
        check_strict_header(rel, rel_posix, head, violations)
    elif not rel_posix.startswith("tests/"):
        for marker in HEADER_MUST:
            if marker not in head:
                violations.append(f"{rel}: 文件头缺少「{marker}」注释")
    if "GameConfig.get_value(" in text:
        violations.append(f"{rel}: 禁止外部调用 GameConfig.get_value（返回 Variant 触发警告即错误）")


def _check_style_identifiers(rel: Path, i: int, ln: str, violations: list[str]) -> None:
    """检查 class_name、内部 class、func、var 的命名规范与长度约束。"""
    # 1. class_name 严格 PascalCase (无下划线) 与 [3, 50] 字符长度
    m = STYLE_CLASS_NAME_RE.search(ln)
    if m:
        cname = m.group(1)
        if not CLASS_NAME_STRICT_RE.match(cname) or "_" in cname:
            violations.append(f"{rel}:{i}: class_name 应为严格 PascalCase（无下划线）（{cname}）")
        elif len(cname) < 3 or len(cname) > 50:
            violations.append(f"{rel}:{i}: class_name 字符长度需在 [3, 50] 区间内（{cname}，当前 {len(cname)} 字符）")

    # 2. 内部 class 严格 PascalCase 与 [3, 50] 字符长度
    m = STYLE_INNER_CLASS_RE.search(ln)
    if m:
        cname = m.group(1)
        if not CLASS_NAME_STRICT_RE.match(cname) or "_" in cname:
            violations.append(f"{rel}:{i}: 内部 class 应为严格 PascalCase（无下划线）（{cname}）")
        elif len(cname) < 3 or len(cname) > 50:
            violations.append(f"{rel}:{i}: 内部 class 字符长度需在 [3, 50] 区间内（{cname}，当前 {len(cname)} 字符）")

    # 3. 函数名 snake_case 与 [3, 50] 字符长度
    m = STYLE_FUNC_RE.search(ln)
    if m:
        fname = m.group(1)
        if not SNAKE_RE.match(fname):
            violations.append(f"{rel}:{i}: 函数名应为 snake_case（{fname}）")
        else:
            core = fname.lstrip("_")
            if len(core) < 3 and core not in ALLOWED_SHORT_FUNCS:
                violations.append(f"{rel}:{i}: 函数名「{fname}」过短（至少 3 字符）")
            elif len(fname) > 50:
                violations.append(f"{rel}:{i}: 函数名「{fname}」长度超出上限（{len(fname)} > 50 字符）")

    # 4. 变量名与属性名 snake_case、禁止 p_ 前缀与 <= 40 字符长度
    m = STYLE_VAR_RE.search(ln)
    if m:
        vname = m.group(1)
        if not SNAKE_RE.match(vname):
            violations.append(f"{rel}:{i}: 变量名应为 snake_case（{vname}）")
        elif vname.startswith("p_"):
            violations.append(f"{rel}:{i}: 变量名「{vname}」禁止使用 C++ 遗留 'p_' 前缀，应使用自然 snake_case 命名")
        elif len(vname) > 40:
            violations.append(f"{rel}:{i}: 变量名「{vname}」字符长度超出上限（{len(vname)} > 40 字符）")


def _check_style_const_and_marker(rel: Path, i: int, ln: str, violations: list[str]) -> None:
    """检查常量定义风格与未决标记。"""
    m = STYLE_CONST_RE.search(ln)
    if m:
        name = m.group(1)
        if "preload(" in ln:
            if not CLASS_NAME_STRICT_RE.match(name) or "_" in name:
                violations.append(f"{rel}:{i}: preload 常量引用应为严格 PascalCase（{name}）")
            elif len(name) < 3 or len(name) > 50:
                violations.append(f"{rel}:{i}: preload 常量「{name}」长度需在 [3, 50] 字符区间内")
        elif not UPPER_RE.match(name):
            violations.append(f"{rel}:{i}: 常量应为 UPPER_SNAKE_CASE（{name}）")
        elif len(name.lstrip("_")) < 2 or len(name) > 50:
            violations.append(f"{rel}:{i}: 常量「{name}」长度需在 [2, 50] 字符区间内")
    pm = PENDING_MARKER_RE.search(ln)
    if pm:
        violations.append(f"{rel}:{i}: 注释含未决标记「{pm.group(1)}」——须落实为客观技术实现或移除（COMMENT-PENDING-MARKER）")


def _audit_line_style(rel: Path, i: int, ln: str, violations: list[str]) -> None:
    """审查单行 GDScript 的命名风格与未决标记。"""
    _check_style_identifiers(rel, i, ln, violations)
    _check_style_const_and_marker(rel, i, ln, violations)


def audit_file(path: Path, violations: list[str], base_root: Path | None = None) -> None:
    """对单个 .gd 文件进行编码风格与头部注释静态检查。"""
    root_dir = base_root if base_root is not None else ROOT
    rel = path.relative_to(root_dir)
    rel_posix = rel.as_posix()
    if not FILE_NAME_RE.match(path.name):
        violations.append(f"{rel}: 文件名应为 snake_case（{path.name}）")
    try:
        text, lines = GDFileCache.get(path)
    except (UnicodeDecodeError, OSError) as exc:
        violations.append(f"{rel}: 非 UTF-8 编码或读取失败（{exc}）")
        return

    _audit_file_header(rel, lines, text, violations)
    if is_strict_governance_target(rel_posix):
        check_strict_class_and_docs(
            rel, path.name, lines, violations, STYLE_CLASS_NAME_RE, STYLE_FUNC_RE
        )
        check_strict_jargon_and_decls(
            rel, lines, violations, STYLE_FUNC_RE, STYLE_VAR_RE
        )
    elif rel_posix.startswith("tests/"):
        check_forbidden_jargon(rel, lines, violations)

    for i, ln in enumerate(lines, 1):
        _audit_line_style(rel, i, ln, violations)


def _audit_tests_jargon(violations: list[str]) -> None:
    """对 tests/ 目录执行术语净空审查，避免触发非严格域的长度或函数名规范限制。"""
    test_root = ROOT / "tests"
    if not test_root.exists():
        return
    for test_file in sorted(p for p in test_root.rglob("*.gd") if p.is_file()):
        try:
            _, test_lines = GDFileCache.get(test_file)
        except (UnicodeDecodeError, OSError) as exc:
            violations.append(f"{test_file.relative_to(ROOT)}: 非 UTF-8 编码或读取失败（{exc}）")
            continue
        check_forbidden_jargon(test_file.relative_to(ROOT), test_lines, violations)


def run_style_audit(include_tests: bool = False) -> int:
    """执行风格审查主循环。"""
    files = get_gd_files(include_tests)

    violations: list[str] = []
    for f in files:
        audit_file(f, violations)
    if not include_tests:
        _audit_tests_jargon(violations)

    print(f"【audit-gd-style】审查文件: {len(files)} 个")
    if violations:
        print("【audit-gd-style】违规项:")
        for v in violations:
            print(f"  ✗ {v}")
        print("【审查结论】未通过")
        return 1
    print("【审查结论】通过")
    return 0
