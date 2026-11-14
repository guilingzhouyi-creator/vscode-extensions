#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · GDScript 严格治理门禁)
# 文件路径: WebGames/scripts/py/gd/strict_governance_rules.py
# 架构定位: 后端与非视图前端 GDScript 严格治理规则集 (Strict Governance Rules)
# 依赖与触发: 触发方: gd/style_rules.py | 上游: backend/**/*.gd, frontend/**/*.gd | 下游: audit_gd.py
# 职责说明: 校验标准六字段题头、res:// 真路径、class_name 对齐、## 文档注释与清晰标识符命名
# 退出语义与设计依据: 退出码: 纯模块供 style_rules 调度 | 设计依据: STRICT-GOVERNANCE-001
# ------------------------------------------------------------------------------
# 用法示例:
#   from gd.strict_governance_rules import is_strict_governance_target
# ==============================================================================
"""GDScript 后端与非视图前端严格治理规则辅助模块。"""

from __future__ import annotations
from pathlib import Path
import re

STRICT_HEADER_FIELDS = (
    "模块归属:",
    "文件路径:",
    "架构定位:",
    "依赖与触发:",
    "职责说明:",
    "退出语义与设计依据:",
)
FORBIDDEN_JARGON_RE = re.compile(
    r"(?:\bR-\d+\b|\bphase[\s_]*\d+\b|\bST\d+\b|\bp\d{2,3}\b|兜底|数据桩|双轨|洗脱|防投毒|速通|防伪|水化|脱水|回灌|施工|案卷)",
    re.IGNORECASE,
)
PERCENTILE_ALLOW_RE = re.compile(r"^p(?:50|95|99)$", re.IGNORECASE)
FOR_ITER_RE = re.compile(r"^\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+")
ABBREV_DECL_SEGMENTS = frozenset({
    "res", "resp", "req", "ctx", "cfg", "acc", "acct", "gw", "pkt", "pk",
    "tok", "cb", "repo", "snap", "cid", "vm", "arr", "cur", "curr", "cal",
    "obj", "val", "msg", "err", "idx", "attr", "src", "seq", "ver",
    "tmp", "temp", "buf", "inst", "prev", "cnt",
})
CLASS_NAME_STRICT_RE = re.compile(r"^[A-Z][A-Za-z0-9]*$")
# 历史归档库 KALAR-DEV-2026-ST07 硬相对链接锚定的物理文件名例外（禁止篡改归档库亦禁止断链）
ARCHIVE_FILENAME_EXEMPT = frozenset({
    "backend/domains/quest_causality/quest_entities.gd",
})


def is_strict_governance_target(rel_posix: str) -> bool:
    """判断路径是否属于后端与非视图前端严格治理域。"""
    return rel_posix.startswith("backend/") or (
        rel_posix.startswith("frontend/") and not rel_posix.startswith("frontend/views/")
    )


def has_preceding_doc_comment(lines: list[str], decl_index: int) -> bool:
    """向上跳过注释与注解，检查声明行紧邻上方是否存在 ## 文档注释。"""
    cursor = decl_index - 1
    while cursor >= 0:
        stripped = lines[cursor].strip()
        if stripped.startswith("@"):
            cursor -= 1
            continue
        return stripped.startswith("##")
    return False


def is_cryptic_decl_identifier(ident: str) -> bool:
    """判定参数、局部变量、循环变量或私有成员名是否含单字母或含糊缩写。"""
    core = ident.strip().lstrip("_")
    if not core:
        return False
    if core == "dto" or len(core) == 1:
        return True
    for part in core.split("_"):
        if not part:
            continue
        if part in ABBREV_DECL_SEGMENTS:
            return True
        if len(part) == 1 and part not in {"x", "y", "z"} and not part.isdigit():
            return True
    return False


def collect_func_param_names(lines: list[str], start_idx: int) -> list[str]:
    """跨行解析 func (...) 参数列表中的所有形参名。"""
    sig = lines[start_idx].strip()
    cursor = start_idx
    while ")" not in sig and cursor + 1 < len(lines):
        cursor += 1
        sig += " " + lines[cursor].strip()
    m_parens = re.search(r"\((.*?)\)", sig)
    if not m_parens:
        return []
    params: list[str] = []
    for raw_part in m_parens.group(1).split(","):
        param_name = raw_part.split(":")[0].split("=")[0].strip()
        if param_name:
            params.append(param_name)
    return params


def check_strict_header(rel: Path, rel_posix: str, head: str, violations: list[str]) -> None:
    """校验严格治理域文件头部六字段与真实 res:// 路径。"""
    for marker in STRICT_HEADER_FIELDS:
        if marker not in head:
            violations.append(f"{rel}: 文件头缺少标准六字段「{marker}」(STYLE-HDR-001)")
    expected_res = f"res://{rel_posix}"
    if expected_res not in head:
        violations.append(f"{rel}: 文件头路径未对齐真实路径「{expected_res}」(STYLE-HDR-001)")


def check_strict_class_and_docs(
    rel: Path,
    path_name: str,
    lines: list[str],
    violations: list[str],
    class_name_re: re.Pattern[str],
    func_re: re.Pattern[str],
) -> None:
    """校验 class_name 与文件名 1:1 对齐，以及类与公开方法 ## 文档注释完整性 (STYLE-CLS-001 / STYLE-DOC-001)。"""
    expected_pascal = "".join(word.capitalize() for word in Path(path_name).stem.split("_") if word)
    found_class = False
    for idx, ln in enumerate(lines):
        lineno = idx + 1
        stripped = ln.strip()
        m_cls = class_name_re.search(ln)
        if m_cls and stripped.startswith("class_name "):
            found_class = True
            cname = m_cls.group(1)
            if cname.lower() != expected_pascal.lower() and rel.as_posix() not in ARCHIVE_FILENAME_EXEMPT:
                violations.append(
                    f"{rel}:{lineno}: class_name「{cname}」与文件名「{path_name}」语义未对齐 (STYLE-CLS-001)"
                )
            if not has_preceding_doc_comment(lines, idx):
                violations.append(
                    f"{rel}:{lineno}: 类声明「{cname}」上方缺少 ## 文档注释 (STYLE-DOC-001)"
                )
        m_fn = func_re.match(ln)
        if m_fn:
            fname = m_fn.group(1)
            if not fname.startswith("_") and not has_preceding_doc_comment(lines, idx):
                violations.append(
                    f"{rel}:{lineno}: 公开方法「{fname}」上方缺少 ## 文档注释 (STYLE-DOC-001)"
                )
    if not found_class:
        violations.append(f"{rel}: 缺少 top-level class_name 声明 (STYLE-CLS-001)")


def check_strict_jargon_and_decls(
    rel: Path,
    lines: list[str],
    violations: list[str],
    func_re: re.Pattern[str],
    var_re: re.Pattern[str],
) -> None:
    """校验零内部黑话/批次标签以及参数、局部变量、循环变量与私有字段清晰命名 (STYLE-JRG-001 / STYLE-NAM-002)。"""
    in_func = False
    func_indent = 0
    for idx, ln in enumerate(lines):
        lineno = idx + 1
        for hit in FORBIDDEN_JARGON_RE.findall(ln):
            if PERCENTILE_ALLOW_RE.match(hit):
                continue
            violations.append(f"{rel}:{lineno}: 检测到未清理黑话或过程批次标签「{hit}」(STYLE-JRG-001)")

        stripped = ln.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent_w = len(ln) - len(ln.lstrip())
        if in_func and indent_w <= func_indent and not func_re.match(ln) and not stripped.startswith((")", "]", "}")):
            in_func = False

        if func_re.match(ln):
            in_func = True
            func_indent = indent_w
            for pname in collect_func_param_names(lines, idx):
                if is_cryptic_decl_identifier(pname):
                    violations.append(
                        f"{rel}:{lineno}: 参数名「{pname}」存在单字母或含糊缩写 (STYLE-NAM-002)"
                    )
            continue

        m_var = var_re.match(ln)
        if m_var:
            vname = m_var.group(1)
            if (in_func or vname.startswith("_")) and is_cryptic_decl_identifier(vname):
                violations.append(
                    f"{rel}:{lineno}: 变量名「{vname}」存在单字母或含糊缩写 (STYLE-NAM-002)"
                )

        m_for = FOR_ITER_RE.match(ln)
        if m_for:
            fvar = m_for.group(1)
            if is_cryptic_decl_identifier(fvar):
                violations.append(
                    f"{rel}:{lineno}: 循环变量「{fvar}」存在单字母或含糊缩写 (STYLE-NAM-002)"
                )
