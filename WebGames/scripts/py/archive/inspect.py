#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 全宗档案治理系统 (Archive · 施工区状态巡检)
# 文件路径: WebGames/scripts/py/archive/inspect.py
# 架构定位: 案卷完整性探测器 (Volume Integrity Inspector)
# 依赖与触发: 触发方: archive_volume.py / 门禁预检 | 上游: docs/路线图/路线图总索引.md | 下游: 案卷巡检 DTO | 运行时: Python 3.10+
# 职责说明: 巡检短期施工区案卷序号连续性、四阶段细则完备性与路线图登记状态，判断封存触发点
# 退出语义与设计依据: 退出码: 纯探测类无独立退出码 | 设计依据: 序号无跳号无越序硬性门禁
# ------------------------------------------------------------------------------
# 用法示例:
#   from archive.inspect import detect_roadmap_status
# ==============================================================================
"""inspect.py — 归档系统巡检报告与总索引布局审查。

负责全宗档案资产聚合、短期/长期区在途状态巡检与路线图总索引布局审查。"""
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from archive.constants import (
    LONG_TERM_DIR,
    ROADMAP_INDEX,
    SHORT_TERM_DIR,
    ST_ARCHIVE_DIR,
)
from archive.keywords import count_archived_inventory
from archive.verify import verify_stage_distinctness

# 常量声明
GLOB_PHASE_DIR = "Phase_*"
RE_NON_WORD = r"[^\w]"
BANNER_EQUAL = "=" * 75
BANNER_DASH = "-" * 75
ARCHIVE_CYCLE_THRESHOLD = 10

# audit_docs 权威规则 → 巡检展示映射（架构不变量：本模块严禁复制规则正则）
_GOVERNANCE_RULE_LABELS = {
    "ROADMAP-README-POLLUTION": "短期施工区制度文档污染",
    "PHASE-VOLUME-STRUCTURE": "案卷文件结构违规",
    "ROADMAP-CYCLE-OVERDUE": "归档周期阈值超限",
}


def load_governance_findings() -> dict[str, list[dict]]:
    """以 subprocess 消费 audit_docs --json 权威审查结果，按巡检相关规则分组返回。

    单一权威收敛：README 污染/案卷结构/周期阈值三处检查的规则正则只存在于
    audit_docs（规则真源 docs_governance_rules.json），本模块仅消费其结构化结论。
    """
    audit_script = Path(__file__).resolve().parent.parent / "audit_docs.py"
    if not audit_script.exists():
        return {}
    try:
        r = subprocess.run(
            [sys.executable, str(audit_script), "--json"],
            capture_output=True, text=True, encoding="utf-8", timeout=300,
        )
        payload = json.loads(r.stdout)
    except (OSError, ValueError) as exc:
        print(f"  ⚠️ [治理检查降级] 无法消费 audit_docs 权威结论（{exc.__class__.__name__}: {exc}），本轮治理类巡检跳过。")
        return {}
    if not isinstance(payload, dict):
        print("  ⚠️ [治理检查降级] audit_docs 输出非结构化对象，本轮治理类巡检跳过。")
        return {}
    grouped: dict[str, list[dict]] = {}
    for finding in payload.get("findings", []):
        rule = finding.get("rule", "")
        if rule in _GOVERNANCE_RULE_LABELS:
            grouped.setdefault(rule, []).append(finding)
    return grouped


def _check_required_outline_sections(text: str) -> list[str]:
    """审查大纲必要三级章节。"""
    required_sections = [
        ("01_短期施工区看板", r"##\s+.*?01_短期施工区看板"),
        ("02_长期演进区看板", r"##\s+.*?02_长期演进区看板"),
        ("全宗已归档案卷索引库", r"##\s+.*?全宗已归档案卷索引库")
    ]
    issues: list[str] = []
    for sec_name, pattern in required_sections:
        if not re.search(pattern, text):
            issues.append(f"缺少必要章节：【{sec_name}】。总索引必须严格保持 短期区 -> 长期演进区 -> 全宗归档索引 三层分流布局！")
    return issues


def _check_board_phase_item(bp: str, actual_active: list[str]) -> str | None:
    """检查活跃看板单个 Phase 项是否存在或冗余。"""
    clean_bp = bp.strip().replace(" ", "_")
    norm_bp = re.sub(RE_NON_WORD, "", clean_bp)
    matched_active = [a for a in actual_active if re.sub(RE_NON_WORD, "", a).startswith(norm_bp[:8])]
    if matched_active:
        return None

    st_archived = [d.name for d in ST_ARCHIVE_DIR.rglob(GLOB_PHASE_DIR)] if ST_ARCHIVE_DIR.exists() else []
    matched_archived = [a for a in st_archived if re.sub(RE_NON_WORD, "", a).startswith(norm_bp[:8])]
    if matched_archived:
        return f"看板未精简：活跃看板仍包含已归档案卷【{bp.strip()}】。应自动清理展开表格，仅在全宗归档指针中登记！"
    return f"看板悬空：活跃看板包含未在文件系统中落地的案卷【{bp.strip()}】。"


def _check_active_board_redundancy(text: str) -> list[str]:
    """检查短期施工区活跃看板去重与精简。"""
    issues: list[str] = []
    m_short = re.search(r"##\s+.*?01_短期施工区看板.*?(?=##\s+.*?02_长期演进区看板|\Z)", text, re.DOTALL)
    if not m_short:
        return issues

    short_section = m_short.group(0)
    board_phases = re.findall(r"###\s+[^\n]*?(Phase[_\s]\d+[^(\n]+)", short_section)
    actual_active = [d.name for d in SHORT_TERM_DIR.glob(GLOB_PHASE_DIR) if d.is_dir()] if SHORT_TERM_DIR.exists() else []

    for bp in board_phases:
        issue = _check_board_phase_item(bp, actual_active)
        if issue:
            issues.append(issue)
    return issues


def _check_archive_index_pointers(text: str) -> list[str]:
    """检查全宗已归档案卷索引库聚合指针完整性。"""
    issues: list[str] = []
    m_archived = re.search(r"##\s+.*?全宗已归档案卷索引库.*", text, re.DOTALL)
    if not m_archived:
        return issues

    arch_section = m_archived.group(0)
    cat_counts, _, _ = count_archived_inventory()
    if cat_counts.get("DEV-RM", 0) > 0 and "01 施工路线图档案卷" not in arch_section:
        issues.append("全宗归档索引缺失【01 施工路线图档案卷 (DEV-RM)】聚合指针！")
    if cat_counts.get("DEV-FE", 0) > 0 and "02 前端施工档案卷" not in arch_section:
        issues.append("全宗归档索引缺失【02 前端施工档案卷 (DEV-FE)】聚合指针！")
    if cat_counts.get("DEV-ST", 0) > 0 and "03 短期施工档案卷" not in arch_section:
        issues.append("全宗归档索引缺失【03 短期施工档案卷 (DEV-ST)】聚合指针！")
    return issues


def audit_roadmap_index_layout() -> tuple[bool, list[str]]:
    """审查路线图总索引 (路线图总索引.md) 的布局结构、章节完整性与看板精简一致性。"""
    if not ROADMAP_INDEX.exists():
        return False, ["路线图总索引文件 (docs/路线图/路线图总索引.md) 不存在！"]

    text = ROADMAP_INDEX.read_text(encoding="utf-8")
    issues: list[str] = []
    issues.extend(_check_required_outline_sections(text))
    issues.extend(_check_active_board_redundancy(text))
    issues.extend(_check_archive_index_pointers(text))
    return len(issues) == 0, issues


def _print_archived_inventory_summary(cat_counts: dict, st_cycles: list[Path]) -> None:
    """输出历史与周期归档库全宗摘要。"""
    print("🏛️ 【历史与周期归档库全宗】已验收封存档案:")
    print(f"  · 01_施工路线图档案卷 (DEV-RM): {cat_counts.get('DEV-RM', 0)} 卷 ({cat_counts.get('DEV-RM', 0)*4} 阶段已封存)")
    print(f"  · 02_前端施工档案卷   (DEV-FE): {cat_counts.get('DEV-FE', 0)} 卷 ({cat_counts.get('DEV-FE', 0)*4} 阶段已封存)")
    print(f"  · 03_短期施工档案卷   (DEV-ST): {len(st_cycles)} 个周期已归档 (共 {cat_counts.get('DEV-ST', 0)} 卷)")
    for c in st_cycles:
        vols_in_cycle = list(c.glob(GLOB_PHASE_DIR))
        print(f"    - {c.name}: {len(vols_in_cycle)} 卷")


def _print_short_term_vols_summary(short_term_vols: list[Path]) -> int:
    """输出短期施工区在途案卷状态并返回合规完备的案卷数。"""
    print(f"\n📁 01_短期施工区（默认区）当前在途案卷: {len(short_term_vols)} 卷")
    completed_count = 0
    for sv in short_term_vols:
        stages = sorted([f for f in sv.glob("*.md") if "阶段" in f.name])
        ok, msg = verify_stage_distinctness(stages)
        status_icon = "✅" if ok else "⚠️"
        if ok:
            completed_count += 1
        print(f"  · {status_icon} [{sv.name}] 阶段数: {len(stages)}/4 ({msg})")
    return completed_count


def _print_governance_findings_summary() -> None:
    """输出审计治理规则 findings 报告。"""
    governance = load_governance_findings()
    for rule, label in _GOVERNANCE_RULE_LABELS.items():
        for finding in governance.get(rule, []):
            print(f"  ❌ [{label}] ({rule}) {finding.get('file', '')}: {finding.get('message', '')}")


def _print_cycle_progress_summary(completed_count: int, st_cycles: list[Path]) -> None:
    """输出 10 卷归档周期进度。"""
    cycle_index = len(st_cycles) + 1
    print(f"\n📦 短期施工区归档周期进度 (每 10 卷一个归档周期):")
    print(f"  · 当前归档周期: 第 {cycle_index:02d} 期")
    if completed_count >= ARCHIVE_CYCLE_THRESHOLD:
        print(f"  · 周期积累进度: [10/10 案卷] (当前已累积 {completed_count} 卷，已达到并超出 10 卷归档阈值)")
        print("  🎉 【就绪】当前周期已累积满 10 个完整案卷！可执行 python scripts/py/archive_volume.py --cycle --apply 进行周期归档。")
    else:
        needed_vols = ARCHIVE_CYCLE_THRESHOLD - completed_count
        print(f"  · 周期积累进度: [{completed_count}/10 案卷] (总完成: {completed_count} 卷)")
        print(f"  ⏳ 需再完成 {needed_vols} 个完整施工案卷达到当前周期归档触发阈值。")


def _print_long_term_summary() -> None:
    """输出长期演进区主题状态。"""
    long_term_vols = sorted([d for d in LONG_TERM_DIR.glob("演进_*") if d.is_dir()]) if LONG_TERM_DIR.exists() else []
    print(f"\n🔮 02_长期演进区（授权区）在途演进主题: {len(long_term_vols)} 卷")
    for lv in long_term_vols:
        stages = sorted([f for f in lv.glob("*.md") if "阶段" in f.name])
        print(f"  · 🛡️ [{lv.name}] 阶段数: {len(stages)}/4 (已获授权立项)")


def _print_layout_audit_summary() -> None:
    """输出路线图总索引布局健康度审查。"""
    print("\n" + BANNER_DASH)
    print("📐 【路线图总索引布局与精简健康度审查】:")
    layout_ok, layout_issues = audit_roadmap_index_layout()
    if layout_ok:
        print("  ✅ 路线图总索引布局合理、三层架构清晰、活跃看板已精准精简（0 冗余）！")
    else:
        print("  ⚠️ 【提醒 Agent / 开发者修正】路线图总索引存在以下布局异常或精简不彻底问题:")
        for idx, issue in enumerate(layout_issues, 1):
            print(f"    {idx}. {issue}")
        print("  👉 修复指引：请依据分层路线图体系，确保已归档案卷仅在全宗索引中留存指针，活跃看板仅展示在途案卷！")


def detect_roadmap_status() -> dict[str, Any]:
    """扫描路线图工作区与归档库的整体状态与 10 卷归档周期进度。"""
    print(BANNER_EQUAL)
    print("🔍 卡拉尔施工路线图体系与国家标准技术档案库巡检报告")
    print(BANNER_EQUAL)

    cat_counts, _, _ = count_archived_inventory()
    st_cycles = sorted(ST_ARCHIVE_DIR.glob("第*期_*")) if ST_ARCHIVE_DIR.exists() else []

    _print_archived_inventory_summary(cat_counts, st_cycles)

    print("\n" + BANNER_DASH)
    print("🚀 【分层施工路线图体系】当前活跃在途施工看板:")

    short_term_vols = sorted([d for d in SHORT_TERM_DIR.glob(GLOB_PHASE_DIR) if d.is_dir()]) if SHORT_TERM_DIR.exists() else []
    completed_count = _print_short_term_vols_summary(short_term_vols)
    _print_governance_findings_summary()
    _print_cycle_progress_summary(completed_count, st_cycles)
    _print_long_term_summary()
    _print_layout_audit_summary()

    print(BANNER_EQUAL)
    return {}
