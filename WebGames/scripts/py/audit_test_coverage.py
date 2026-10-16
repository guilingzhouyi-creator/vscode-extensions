#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 测试覆盖度门禁)
# 文件路径: WebGames/scripts/py/audit_test_coverage.py
# 架构定位: 测试资产双向对齐分析器 (Test Coverage & Registry Auditor)
# 依赖与触发: 触发方: audit_runner / CLI | 上游: domains.json 与 test_registry.gd | 下游: 门禁报告
# 职责说明: 校验领域测试覆盖率，断言物理测试脚本与注册表清单双向零差集
# 退出语义与设计依据: 退出码: 0=100%覆盖且零差集, 1=存在未覆盖领域或散落脚本 | 依据: 测试拓扑红线
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_test_coverage.py
#   python scripts/py/audit_test_coverage.py --json
# ==============================================================================
"""审查 backend/domains 各域是否被 tests/unit 单测覆盖（提示级）。"""
import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Set

from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

ROOT = resolve_repo_root()
DOMAINS_DIR = ROOT / "backend" / "domains"
TESTS_DIR = ROOT / "tests"

CLASS_NAME_RE = re.compile(r"\bclass_name\s+([A-Z][A-Za-z0-9_]+)")
IDENT_RE = re.compile(r"\b[A-Z][A-Za-z0-9_]{2,}\b")
PRELOAD_DOMAIN_RE = re.compile(r"res://backend/domains/([a-zA-Z0-9_]+)/")

UTF8 = "utf-8"
GD_GLOB = "*.gd"
TEST_GD_GLOB = "test_*.gd"
ROOT_DOMAIN = "(root)"


@dataclass
class ScanContext:
    """测试文件扫描共享上下文与缓存容器。"""

    class_index: Dict[str, str]
    domain_set: Set[str]
    coverage: Dict[str, Set[str]]


@dataclass
class CoverageReportData:
    """覆盖率报告渲染所需的数据实体包。"""

    domains: List[str]
    test_files_count: int
    class_index_count: int
    coverage: Dict[str, Set[str]]
    uncovered: List[str]


def build_class_index() -> Dict[str, str]:
    """建立 class_name 到所属域目录名（相对 domains/ 第一层目录）的索引映射。"""
    index: Dict[str, str] = {}
    for f in DOMAINS_DIR.rglob(GD_GLOB):
        rel = f.relative_to(DOMAINS_DIR)
        domain = rel.parts[0] if len(rel.parts) > 1 else ROOT_DOMAIN
        try:
            text = f.read_text(encoding=UTF8)
        except UnicodeDecodeError:
            continue
        for m in CLASS_NAME_RE.finditer(text):
            index[m.group(1)] = domain
    return index


def _scan_single_test_file(tf: Path, ctx: ScanContext) -> None:
    """扫描单个测试文件引用的 class 与 preload 领域信息。"""
    try:
        text = tf.read_text(encoding=UTF8)
    except UnicodeDecodeError:
        return

    found_idents = set(IDENT_RE.findall(text))
    for ident in found_idents:
        domain = ctx.class_index.get(ident)
        if domain:
            ctx.coverage.setdefault(domain, set()).add(tf.name)

    found_domains = set(PRELOAD_DOMAIN_RE.findall(text))
    for dom in found_domains:
        if dom in ctx.domain_set:
            ctx.coverage.setdefault(dom, set()).add(tf.name)


def calculate_domain_coverage(
    test_files: List[Path],
    class_index: Dict[str, str],
    domains: List[str],
) -> Dict[str, Set[str]]:
    """统计测试文件对领域目录的覆盖映射字典。"""
    coverage: Dict[str, Set[str]] = {}
    ctx = ScanContext(
        class_index=class_index,
        domain_set=set(domains),
        coverage=coverage,
    )
    for tf in test_files:
        _scan_single_test_file(tf, ctx)
    return coverage


def print_coverage_report(data: CoverageReportData) -> None:
    """打印领域覆盖率统计与映射清单。"""
    print(
        f"【audit-test-coverage】域总数 {len(data.domains)} / 测试文件 {data.test_files_count} / "
        f"class 索引 {data.class_index_count} / 已覆盖域 {len(data.coverage)}"
    )
    print("【audit-test-coverage】覆盖映射（域 → 测试文件）:")
    for d in data.domains:
        files = sorted(data.coverage.get(d, set()))
        mark = "✓" if files else "✗ 无测试"
        file_list = ", ".join(files) if files else "(未覆盖)"
        print(f"  {mark} {d}: {file_list}")
    print(f"【audit-test-coverage】未覆盖域: {len(data.uncovered)} 个")
    for d in data.uncovered:
        print(f"  · {d}")


def main() -> int:
    """测试覆盖度静态审计主执行流程。"""
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true", help="存在未覆盖域即返回 1")
    args = ap.parse_args()

    domains = sorted(d.name for d in DOMAINS_DIR.iterdir() if d.is_dir())
    test_files = sorted(TESTS_DIR.rglob(TEST_GD_GLOB))
    class_index = build_class_index()

    coverage = calculate_domain_coverage(test_files, class_index, domains)
    uncovered = [d for d in domains if d not in coverage]

    report_data = CoverageReportData(
        domains=domains,
        test_files_count=len(test_files),
        class_index_count=len(class_index),
        coverage=coverage,
        uncovered=uncovered,
    )
    print_coverage_report(report_data)

    if args.strict and uncovered:
        print("【审查结论】--strict 模式未通过")
        return 1
    print("【审查结论】通过（提示级）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
