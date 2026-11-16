#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 跨文件克隆守卫)
# 文件路径: WebGames/scripts/py/audit_code_clones.py
# 架构定位: 跨文件函数与代码块克隆静态检测引擎 (Cross-File Clone Guard)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: backend/**/*.gd & frontend/**/*.gd | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 检测生产脚本间的归一化克隆函数、近克隆函数与连续多行复制代码块，阻断重复域扩散
# 退出语义与设计依据: 退出码: 0=零跨文件克隆, 1=发现阻断级克隆违规, 2=用法或环境异常 | 设计依据: AGENTS.md 单一真源与 DRY 契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_code_clones.py
#   python scripts/py/audit_code_clones.py --json
#   python scripts/py/audit_code_clones.py --slice frontend
# ==============================================================================
"""跨文件代码克隆与重复实现静态守卫（覆盖 Type-1 与 Type-2 归一化函数及块级复制）。"""

from __future__ import annotations

import argparse
import collections
from dataclasses import dataclass
import json
from pathlib import Path
import re
import sys
from typing import Any

from audit_common import CHARSET_UTF8, Finding, ensure_utf8_stdout, print_conclusion, resolve_repo_root

ensure_utf8_stdout()

ROOT = resolve_repo_root()
PRODUCTION_AREAS: tuple[str, ...] = ("backend", "frontend")
MIN_EXACT_FUNC_ELOC = 5
MIN_NEAR_CLONE_ELOC = 14
NEAR_CLONE_JACCARD_THRESHOLD = 0.85
NEAR_CLONE_MAX_LEN_DELTA = 4
BLOCK_WINDOW_LINES = 6
MIN_BLOCK_RAW_CHARS = 100
SEPARATOR_LINE_WIDTH = 80

EXEMPT_BOILERPLATE_FUNCS: frozenset[str] = frozenset({
    "to_dto", "from_dto", "to_dict", "from_dict", "to_dictionary", "from_dictionary",
    "to_save_snapshot", "from_save_snapshot", "serialize", "deserialize",
    "reset_state", "_init", "duplicate", "clone", "_notification", "_ready", "_exit_tree",
})

FUNC_HEADER_RE = re.compile(r"^(\s*)(?:static\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)")
PARAM_IDENT_RE = re.compile(r"\s*([A-Za-z_][A-Za-z0-9_]*)")
VAR_DECL_RE = re.compile(r"^\s*(?:static\s+)?var\s+([A-Za-z_][A-Za-z0-9_]*)")
FOR_LOOP_VAR_RE = re.compile(r"^\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b")
IDENT_RE = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]*\b")
STRING_SPLIT_RE = re.compile(r'("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\')')


@dataclass(slots=True)
class NormalizedFunction:
    """单个 GDScript 函数的归一化切片结构。"""

    rel_path: str
    name: str
    start_line: int
    raw_lines: tuple[str, ...]
    norm_lines: tuple[str, ...]
    line_numbers: tuple[int, ...]
    norm_counter: collections.Counter[str]

    @property
    def eloc(self) -> int:
        """有效代码行数。"""
        return len(self.raw_lines)


def _strip_gd_comment(line: str) -> str:
    """剥离行内 GDScript 注释（保留字符串字面量内的 # 字符）。"""
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
            return line[:idx].rstrip()
    return line.rstrip()


def _leading_indent_width(raw_line: str) -> int:
    """统计行首缩进字符数。"""
    return len(raw_line) - len(raw_line.lstrip("\t "))


def _build_local_symbol_map(params_raw: str, body_lines: list[tuple[int, str]]) -> dict[str, str]:
    """构建参数、局部变量与循环变量的 positional Type-2 映射表。"""
    locals_map: dict[str, str] = {}
    slot = 0

    for part in params_raw.split(","):
        m_param = PARAM_IDENT_RE.match(part)
        if m_param:
            ident = m_param.group(1)
            if ident not in locals_map:
                locals_map[ident] = f"$V{slot}"
                slot += 1

    for _, stmt in body_lines:
        for pattern in (VAR_DECL_RE, FOR_LOOP_VAR_RE):
            m_decl = pattern.match(stmt)
            if m_decl:
                ident = m_decl.group(1)
                if ident not in locals_map:
                    locals_map[ident] = f"$V{slot}"
                    slot += 1
    return locals_map


def _normalize_code_segment(segment: str, locals_map: dict[str, str]) -> str:
    """将代码片段中的局部变量标识替换为归一化占位符。"""
    tokens: list[str] = []
    pos = 0
    for match in IDENT_RE.finditer(segment):
        start, end = match.span()
        tokens.append(segment[pos:start])
        ident = match.group(0)
        tokens.append(locals_map.get(ident, ident))
        pos = end
    tokens.append(segment[pos:])
    return "".join(tokens)


def _normalize_statement(stmt: str, locals_map: dict[str, str]) -> str:
    """对单行语句执行 Type-2 归一化（保留字符串字面量与键名）。"""
    parts = STRING_SPLIT_RE.split(stmt)
    for idx in range(0, len(parts), 2):
        parts[idx] = _normalize_code_segment(parts[idx], locals_map)
    return "".join(parts)


def _collect_func_body(lines: list[str], header_idx: int, func_indent: int) -> tuple[list[tuple[int, str]], int]:
    """按缩进边界收集单个函数的有效语句列表与结束行索引。"""
    body: list[tuple[int, str]] = []
    cursor = header_idx + 1
    total = len(lines)
    while cursor < total:
        raw_line = lines[cursor]
        stripped_comment = _strip_gd_comment(raw_line)
        content = stripped_comment.strip()
        if content and _leading_indent_width(raw_line) <= func_indent:
            break
        if content not in ("", "{", "}", "pass"):
            body.append((cursor + 1, content))
        cursor += 1
    return body, cursor


def extract_normalized_functions(path: Path, scan_root: Path) -> list[NormalizedFunction]:
    """解析单个 GDScript 文件并返回全部函数的归一化表征。"""
    try:
        lines = path.read_text(encoding=CHARSET_UTF8).splitlines()
    except OSError:
        return []

    rel_path = path.relative_to(scan_root).as_posix()
    functions: list[NormalizedFunction] = []
    idx = 0
    total = len(lines)
    while idx < total:
        stripped = _strip_gd_comment(lines[idx])
        m_func = FUNC_HEADER_RE.match(stripped)
        if not m_func:
            idx += 1
            continue
        func_indent = len(m_func.group(1))
        func_name = m_func.group(2)
        params_raw = m_func.group(3)
        body, next_idx = _collect_func_body(lines, idx, func_indent)
        locals_map = _build_local_symbol_map(params_raw, body)
        raw_tuple = tuple(stmt for _, stmt in body)
        norm_tuple = tuple(_normalize_statement(stmt, locals_map) for _, stmt in body)
        line_tuple = tuple(ln for ln, _ in body)
        functions.append(
            NormalizedFunction(
                rel_path=rel_path,
                name=func_name,
                start_line=idx + 1,
                raw_lines=raw_tuple,
                norm_lines=norm_tuple,
                line_numbers=line_tuple,
                norm_counter=collections.Counter(norm_tuple),
            )
        )
        idx = next_idx
    return functions


def _make_clone_finding(
    rule: str,
    anchor_file: str,
    anchor_line: int,
    message: str,
    suggestion: str,
    context: dict[str, Any],
) -> Finding:
    """构造克隆违规发现条目。"""
    return Finding(
        rule=rule, file=anchor_file, line=anchor_line, severity="error",
        category="clone", message=message, suggestion=suggestion, context=context,
    )


def _detect_exact_function_clones(functions: list[NormalizedFunction]) -> list[Finding]:
    """检出跨文件完全同构（Type-1 / Type-2）的重复函数实现。"""
    buckets: dict[tuple[str, ...], list[NormalizedFunction]] = collections.defaultdict(list)
    for fn in functions:
        if fn.eloc >= MIN_EXACT_FUNC_ELOC and fn.name not in EXEMPT_BOILERPLATE_FUNCS:
            buckets[fn.norm_lines].append(fn)

    findings: list[Finding] = []
    for norm_body, group in buckets.items():
        if len({fn.rel_path for fn in group}) < 2:
            continue
        anchor = group[0]
        peers = ", ".join(f"{fn.rel_path}:{fn.start_line} ({fn.name})" for fn in group[1:])
        findings.append(_make_clone_finding(
            "CLN-FUNC-001", anchor.rel_path, anchor.start_line,
            f"函数 {anchor.name} ({anchor.eloc} ELOC) 与跨文件实现完全同构: {peers}",
            "将共享逻辑下沉至所属域公共基类、接口层或共享工具模块。",
            {"peer_count": len(group) - 1, "norm_lines": len(norm_body)},
        ))
    return findings


def _detect_block_clones(functions: list[NormalizedFunction]) -> list[Finding]:
    """检出函数体内跨文件连续多行逻辑块复制。"""
    window_index: dict[tuple[str, ...], list[tuple[NormalizedFunction, int]]] = collections.defaultdict(list)
    for fn in functions:
        if fn.name in EXEMPT_BOILERPLATE_FUNCS:
            continue
        for start_idx in range(max(0, fn.eloc - BLOCK_WINDOW_LINES + 1)):
            raw_slice = fn.raw_lines[start_idx : start_idx + BLOCK_WINDOW_LINES]
            if sum(len(line) for line in raw_slice) >= MIN_BLOCK_RAW_CHARS:
                window_index[fn.norm_lines[start_idx : start_idx + BLOCK_WINDOW_LINES]].append(
                    (fn, fn.line_numbers[start_idx])
                )

    reported_pairs: set[tuple[str, str]] = set()
    findings: list[Finding] = []
    for locs in window_index.values():
        if len({fn.rel_path for fn, _ in locs}) < 2:
            continue
        first_fn, first_line = locs[0]
        for peer_fn, peer_line in locs[1:]:
            if peer_fn.rel_path == first_fn.rel_path:
                continue
            pair = (first_fn.rel_path, peer_fn.rel_path)
            canonical = (min(pair), max(pair))
            if canonical in reported_pairs:
                continue
            reported_pairs.add(canonical)
            findings.append(_make_clone_finding(
                "CLN-BLK-001", first_fn.rel_path, first_line,
                f"{first_fn.name} L{first_line} 存在与 {peer_fn.rel_path}:{peer_line} ({peer_fn.name}) 连续 {BLOCK_WINDOW_LINES} 行同构代码块",
                "抽取跨模块共享辅助函数，消除复制粘贴片段。",
                {"peer_file": peer_fn.rel_path, "peer_line": peer_line},
            ))
    return findings


def _multiset_jaccard(left: collections.Counter[str], right: collections.Counter[str]) -> float:
    """计算多重集合 Type-2 语句相似度。"""
    inter = sum((left & right).values())
    union = sum((left | right).values())
    return (inter / union) if union else 0.0


def _detect_near_function_clones(functions: list[NormalizedFunction]) -> list[Finding]:
    """检出较大函数体间的高重合近似克隆（Type-2 多重集合 Jaccard）。"""
    candidates = [
        fn for fn in functions
        if fn.eloc >= MIN_NEAR_CLONE_ELOC and fn.name not in EXEMPT_BOILERPLATE_FUNCS
    ]
    findings: list[Finding] = []
    total = len(candidates)
    for idx_a in range(total):
        fn_a = candidates[idx_a]
        for idx_b in range(idx_a + 1, total):
            fn_b = candidates[idx_b]
            if fn_a.rel_path == fn_b.rel_path or abs(fn_a.eloc - fn_b.eloc) > NEAR_CLONE_MAX_LEN_DELTA:
                continue
            if fn_a.norm_lines == fn_b.norm_lines:
                continue
            sim = _multiset_jaccard(fn_a.norm_counter, fn_b.norm_counter)
            if sim < NEAR_CLONE_JACCARD_THRESHOLD:
                continue
            findings.append(_make_clone_finding(
                "CLN-FUNC-JACCARD-001", fn_a.rel_path, fn_a.start_line,
                f"函数 {fn_a.name} ({fn_a.eloc} ELOC) 与 {fn_b.rel_path}:{fn_b.start_line} ({fn_b.name}, {fn_b.eloc} ELOC) Type-2 相似度达 {sim:.2f}",
                "统一参数化差异或抽取共享基座求解器，消除近似双份逻辑。",
                {"similarity": round(sim, 4), "peer_file": fn_b.rel_path},
            ))
    return findings


def collect_target_files(scan_root: Path, slice_filter: str) -> list[Path]:
    """收集指定扫描根目录与切片下的全量生产 GDScript 源文件。"""
    needle = slice_filter.strip().lower()
    files: list[Path] = []
    for area in PRODUCTION_AREAS:
        base_dir = scan_root / area
        if not base_dir.is_dir():
            continue
        for gd_path in sorted(base_dir.rglob("*.gd")):
            if not gd_path.is_file():
                continue
            rel_lower = gd_path.relative_to(scan_root).as_posix().lower()
            if needle and needle not in rel_lower:
                continue
            files.append(gd_path)
    return files


def run_clone_audit(scan_root: Path, slice_filter: str = "") -> tuple[list[Path], list[NormalizedFunction], list[Finding]]:
    """执行跨文件代码克隆审计全流程，返回 (扫描文件, 函数列表, 违规发现)。"""
    files = collect_target_files(scan_root, slice_filter)
    functions: list[NormalizedFunction] = []
    for gd_path in files:
        functions.extend(extract_normalized_functions(gd_path, scan_root))

    findings: list[Finding] = []
    findings.extend(_detect_exact_function_clones(functions))
    findings.extend(_detect_block_clones(functions))
    findings.extend(_detect_near_function_clones(functions))
    findings.sort(key=lambda item: (item.rule, item.file, item.line))
    return files, functions, findings


def _emit_json_report(files_count: int, funcs_count: int, findings: list[Finding]) -> None:
    """输出结构化 JSON 审查报告。"""
    payload: dict[str, Any] = {
        "schema": "code-clones-audit/v1",
        "summary": {
            "files_scanned": files_count,
            "functions_analyzed": funcs_count,
            "violations": len(findings),
        },
        "findings": [item.to_dict() for item in findings],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def main() -> int:
    """CLI 入口。"""
    parser = argparse.ArgumentParser(
        description="WebGames 跨文件代码克隆与重复逻辑域静态检测门禁"
    )
    parser.add_argument("--json", action="store_true", help="输出结构化 JSON 报告")
    parser.add_argument("--slice", type=str, default="", help="仅审查路径匹配的切片")
    parser.add_argument("--root", type=str, default="", help="覆盖扫描根目录（测试用）")
    args = parser.parse_args()

    scan_root = Path(args.root).resolve() if args.root else ROOT
    if not scan_root.is_dir():
        print(f"扫描根目录不存在: {scan_root}", file=sys.stderr)
        return 2

    files, functions, findings = run_clone_audit(scan_root, args.slice)
    if args.json:
        _emit_json_report(len(files), len(functions), findings)
        return 1 if findings else 0

    print("=" * SEPARATOR_LINE_WIDTH)
    print("🧬 卡拉尔世界引擎：跨文件代码克隆与重复实现静态守卫")
    print("=" * SEPARATOR_LINE_WIDTH)
    print(f"扫描文件数: {len(files)} 个 | 分析函数数: {len(functions)} 个")
    violation_lines = [
        f"[{item.rule}] {item.file}:{item.line} — {item.message}" for item in findings
    ]
    return print_conclusion(violation_lines, [], "跨文件代码克隆守卫")


if __name__ == "__main__":
    sys.exit(main())
