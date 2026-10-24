#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 文档门禁自测夹具)
# 文件路径: WebGames/scripts/py/docs_audit/selftest.py
# 架构定位: 文档审查引擎内建回归测试器 (Self-Test Runner)
# 依赖与触发: 触发方: audit_docs.py --self-test | 上游: 临时文件夹具 | 下游: 测试通过/失败退出码 | 运行时: Python 3.10+
# 职责说明: 在隔离临时目录中动态构造违规样本文档，验证审查规则、自动修复幂等性与基线棘轮防漂移
# 退出语义与设计依据: 退出码: 0=自测全通, 1=存在断言失败 | 设计依据: 门禁防御与高可靠自愈规范
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_docs.py --self-test
# ==============================================================================
"""docs_audit 审查引擎内建回归测试与夹具自检。"""

from __future__ import annotations
from pathlib import Path
from typing import Any
import shutil
import tempfile

from audit_common import KALAR_DEV_PREFIX
from docs_audit.auditor import DocsAuditor
from docs_audit.models import (
    apply_baseline,
    load_baseline,
    write_baseline,
)
def _populate_test_fixtures(docs: Path) -> None:
    """在临时测试目录中填充用于自测的多样例文档夹具。"""
    (docs / "域A").mkdir(parents=True)
    (docs / "域A" / "表1.md").write_text(
        "# 标题\n\n正文段落\n| a | b |\n| - | - |\n| 1 | 2 |\n", encoding="utf-8"
    )
    (docs / "域A" / "后端架构需求表99.md").write_text(
        "# 后端架构需求表99（第99卷：自测）\n\n## 一、 实体\n\n## 二、 求解器\n",
        encoding="utf-8",
    )
    (docs / "域A" / "坏名.md").write_text("# x\n", encoding="utf-8")
    (docs / "域A" / "玩法设计稿.md").write_text("# x\n", encoding="utf-8")
    (docs / "域A" / "玩法设计稿二.md").write_text("# x\n", encoding="utf-8")
    (docs / "域A" / "链接.md").write_text(
        "# L\n\n[死链](./不存在.md) [绝对](file:///c:/no/such/docs/域A/表1.md) "
        "[死锚](表1.md#无此节) [绝对死](file:///c:/no/such/docs/域A/没了.md) "
        "[绝对死锚](file:///c:/no/such/docs/域A/表1.md#也不存在)\n",
        encoding="utf-8",
    )
    (docs / "域A" / "图.md").write_text(
        "# G\n\n```mermaid\ngraph TD\n    A[矮人大陆 (Kalar)] --> B[快照 alias_slots[]]\n"
        '    C["已引号 (ok)"] --> D{普通}\n```\n',
        encoding="utf-8",
    )
    arch = docs / "归档库" / "01_施工路线图档案卷" / "卷01_测试卷"
    arch.mkdir(parents=True, exist_ok=True)
    (arch / (KALAR_DEV_PREFIX + "-RM01-001_阶段1_测试.md")).write_text(
        "# 施工细则：测试件\n\n正文无档案头块。\n", encoding="utf-8"
    )


def _assert_initial_findings(aud: DocsAuditor, docs: Path, fails: list[str]) -> list[Any]:
    """验证文档静态分析初始检出率与原样保持。"""
    findings = aud.check()
    got_rules = {f.rule for f in findings}
    expect = {
        "LAYOUT-TABLE-GAP",
        "NAMING-FILE",
        "NAMING-SEQ",
        "LINK-DEAD",
        "LINK-ABS-FILE-URI",
        "LINK-ANCHOR-DEAD",
        "MERMAID-SPECIAL-CHARS",
        "LAYOUT-SECTION-STD",
        "LAYOUT-ARCHIVE-HEAD",
    }
    missing = expect - got_rules
    if missing:
        fails.append(f"未检出的规则: {missing}")

    mline = [
        l
        for l in (docs / "域A" / "图.md").read_text(encoding="utf-8").split("\n")
        if "alias_slots" in l
    ]
    if mline and not mline[0].strip().endswith("B[快照 alias_slots[]]"):
        fails.append(f"审查阶段不应改动原文: {mline}")
    if "LAYOUT-H1-MULTI" in got_rules:
        fails.append("单 H1 文件误报多 H1")
    return findings


def _assert_dry_run_fix(aud: DocsAuditor, docs: Path, fails: list[str]) -> None:
    """验证 dry-run 预览生成且绝对不写盘。"""
    applied_dry, _ = aud.fix(dry_run=True)
    if not applied_dry:
        fails.append("dry-run 未生成修复计划")
    if 'alias_slots[]"]' in (docs / "域A" / "图.md").read_text(encoding="utf-8"):
        fails.append("dry-run 写盘了（违反幂等约束）")


def _assert_real_fix(aud: DocsAuditor, docs: Path, fails: list[str]) -> list[Any]:
    """验证真实落盘修复与规则闭环。"""
    _, residual = aud.fix(dry_run=False)
    residual_rules = {f.rule for f in residual}
    for r in ("MERMAID-SPECIAL-CHARS", "LINK-ABS-FILE-URI", "LAYOUT-TABLE-GAP"):
        if r in residual_rules:
            fails.append(f"修复后残留: {r}")

    t = (docs / "域A" / "图.md").read_text(encoding="utf-8")
    if 'A["矮人大陆 (Kalar)"]' not in t or 'B["快照 alias_slots[]"]' not in t:
        fails.append("mermaid 引号修复结果不符")
    t2 = (docs / "域A" / "链接.md").read_text(encoding="utf-8")
    if "](表1.md)" not in t2:
        fails.append("file:/// 未转为正确的相对链接")
    if "不存在.md" not in t2:
        fails.append("修复误删死链（死链应只报不改）")
    return residual


def _assert_check_and_fix(
    tmp: Path, docs: Path, naming: list[dict], fails: list[str]
) -> list[Any]:
    """验证审查规则命中率、修复预览不写盘与自动修复幂等性。"""
    aud = DocsAuditor(tmp, naming=naming)
    aud.load()
    findings = _assert_initial_findings(aud, docs, fails)
    _assert_dry_run_fix(aud, docs, fails)
    return _assert_real_fix(aud, docs, fails)


def _assert_baseline_ratchet(
    tmp: Path,
    docs: Path,
    naming: list[dict],
    residual: list[Any],
    fails: list[str],
) -> None:
    """验证基线棘轮机制：接受存量、阻断新增与更新基线闭环。"""
    base_path = tmp / "baseline.json"
    write_baseline(str(base_path), residual)
    base = load_baseline(str(base_path))
    if apply_baseline(residual, base) != 0:
        fails.append("基线快照复检不应产生新增违规")

    # 模拟 Agent 新增一处死链：超出基线 → 必须检出 1 条 is_new
    (docs / "域A" / "表1.md").write_text(
        "# 标题\n\n[新增死链](./没有.md)\n\n正文段落\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
        encoding="utf-8",
    )
    aud2 = DocsAuditor(tmp, naming=naming)
    aud2.load()
    residual2 = aud2.check()
    new_n = apply_baseline(residual2, base)
    new_findings = [f for f in residual2 if f.is_new]
    if new_n != 1 or not new_findings or new_findings[0].rule != "LINK-DEAD":
        fails.append(f"棘轮未精确阻断新增违规（new={new_n}）")
    write_baseline(str(base_path), residual2)
    if apply_baseline(aud2.check(), load_baseline(str(base_path))) != 0:
        fails.append("更新基线后应清零新增")


def cmd_self_test() -> int:
    """运行文档审查引擎内建夹具回归测试。"""
    tmp = Path(tempfile.mkdtemp(prefix="docs_audit_selftest_"))
    fails: list[str] = []
    try:
        docs = tmp / "docs"
        _populate_test_fixtures(docs)
        naming = [{"scope": "域A", "files": [r"表\d+\.md"]}]
        residual = _assert_check_and_fix(tmp, docs, naming, fails)
        _assert_baseline_ratchet(tmp, docs, naming, residual, fails)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    if fails:
        print(f"【audit-docs 自测】失败 {len(fails)} 项:")
        for f in fails:
            print(f"  ✗ {f}")
        return 1
    print("【audit-docs 自测】全部通过（规则检出率/修复幂等/基线棘轮）")
    return 0
