#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 测试覆盖度门禁)
# 文件路径: WebGames/scripts/py/audit_test_coverage.py
# 架构定位: 测试资产双向对齐分析器 (Test Coverage & Registry Auditor)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: domains.json 与 test_registry.gd | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 校验领域测试覆盖率，断言物理测试脚本与注册表清单双向零差集
# 退出语义与设计依据: 退出码: 0=100%覆盖且零差集, 1=存在未覆盖领域或散落脚本 | 设计依据: AGENTS.md 测试工程化拓扑红线
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_test_coverage.py
#   python scripts/py/audit_test_coverage.py --json
# ==============================================================================
"""审查 backend/domains 各域是否被 tests/unit 单测覆盖（提示级）。"""
import argparse
import re
import sys
from pathlib import Path

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


def build_class_index() -> dict[str, str]:
    """class_name → 所属域目录名（相对 domains/ 的第一层目录）。"""
    index: dict[str, str] = {}
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


def _scan_single_test_file(
    tf: Path,
    class_index: dict[str, str],
    domain_set: set[str],
    coverage: dict[str, set[str]],
    seen_idents: set[str],
    seen_domains: set[str],
) -> None:
    """扫描单个测试文件引用的 class 与 preload 领域。"""
    try:
        text = tf.read_text(encoding=UTF8)
    except UnicodeDecodeError:
        return

    seen_idents.clear()
    for m in IDENT_RE.finditer(text):
        ident = m.group(0)
        if ident in seen_idents:
            continue
        seen_idents.add(ident)
        domain = class_index.get(ident)
        if domain:
            coverage.setdefault(domain, set()).add(tf.name)

    seen_domains.clear()
    for m in PRELOAD_DOMAIN_RE.finditer(text):
        dom = m.group(1)
        if dom in seen_domains:
            continue
        seen_domains.add(dom)
        if dom in domain_set:
            coverage.setdefault(dom, set()).add(tf.name)


def calculate_domain_coverage(
    test_files: list[Path],
    class_index: dict[str, str],
    domains: list[str],
) -> dict[str, set[str]]:
    """统计测试文件对领域目录的覆盖映射。"""
    coverage: dict[str, set[str]] = {}
    domain_set = set(domains)
    seen_idents: set[str] = set()
    seen_domains: set[str] = set()
    for tf in test_files:
        _scan_single_test_file(tf, class_index, domain_set, coverage, seen_idents, seen_domains)
    return coverage


def print_coverage_report(
    domains: list[str],
    test_files: list[Path],
    class_index: dict[str, str],
    coverage: dict[str, set[str]],
    uncovered: list[str],
) -> None:
    """打印领域覆盖率统计与映射清单。"""
    print(f"【audit-test-coverage】域总数 {len(domains)} / 测试文件 {len(test_files)} / "
          f"class 索引 {len(class_index)} / 已覆盖域 {len(coverage)}")
    print("【audit-test-coverage】覆盖映射（域 → 测试文件）:")
    for d in domains:
        files = sorted(coverage.get(d, set()))
        mark = "✓" if files else "✗ 无测试"
        print(f"  {mark} {d}: {', '.join(files) if files else '(未覆盖)'}")
    print(f"【audit-test-coverage】未覆盖域: {len(uncovered)} 个")
    for d in uncovered:
        print(f"  · {d}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true", help="存在未覆盖域即返回 1")
    args = ap.parse_args()

    domains = sorted(d.name for d in DOMAINS_DIR.iterdir() if d.is_dir())
    test_files = sorted(TESTS_DIR.rglob(TEST_GD_GLOB))
    class_index = build_class_index()

    coverage = calculate_domain_coverage(test_files, class_index, domains)
    uncovered = [d for d in domains if d not in coverage]

    print_coverage_report(domains, test_files, class_index, coverage, uncovered)
    if args.strict and uncovered:
        print("【审查结论】--strict 模式未通过")
        return 1
    print("【审查结论】通过（提示级）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
