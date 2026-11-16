#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 文案系统门禁)
# 文件路径: WebGames/scripts/py/audit_copywriting.py
# 架构定位: 文案合规校验器 (Copywriting Validator)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: config/copywriting/ | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 校验物品与剧情文案模板参数占位符闭合性，杜绝未填充占位符与空泛文案
# 退出语义与设计依据: 退出码: 0=合规, 1=存在文案破损 | 设计依据: 统一文案配置契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_copywriting.py
#   python scripts/py/audit_copywriting.py --json
# ==============================================================================
"""统一文案配置系统深度审查：校验四域文案配置与叙事模板的事实源一致性。"""

from pathlib import Path
from typing import Any
import json
import re
import sys

from audit_common import ensure_utf8_stdout, resolve_repo_root
ensure_utf8_stdout()

ROOT = resolve_repo_root()
CONFIG = ROOT / "config"
BACKEND = ROOT / "backend"

ITEM_PARAM_WHITELIST = {
    "name", "tier_rank", "mass_kg", "volume_slots", "market_value",
    "quantity", "durability", "enchant", "quality_tier",
}
JUDGMENT_FIELDS = {"action", "dispatch", "lifecycle", "probability", "trigger", "execute", "spawn"}
PLACEHOLDER_RE = re.compile(r"\{([a-z_][a-z0-9_]*)\}")
LEGACY_PLACEHOLDER_RE = re.compile(r"%[sd]|%\.\d*f|\{\}")
CJK_RE = re.compile(r"[\u4e00-\u9fff]")

RESOLVER_FILES = {
    "copywriting_resolver.gd", "item_description_resolver.gd",
    "event_description_resolver.gd", "narrative_flow_resolver.gd",
}
BRANCH_KEYS = ("base", "text", "success", "failure", "partial")
PROBABILITY_DOMAIN_FORBIDDEN = JUDGMENT_FIELDS - {"probability"}


def _audit_narrative_and_prob(ref_key: str, text: str, violations: list[str], is_prob: bool = False) -> None:
    """审查剧情与概率域判定与执行语义禁入 (GOV-DAT-001)。"""
    forbidden = PROBABILITY_DOMAIN_FORBIDDEN if is_prob else JUDGMENT_FIELDS
    for jf in forbidden:
        if jf in text:
            violations.append(f"[判定禁入] {ref_key} 含判定/执行语义 {jf}")


def _audit_item_entry(entry_key: str, entry: dict[str, Any], text: str, violations: list[str]) -> None:
    """审查物品文案占位符白名单与触发条件有效性。"""
    for m in PLACEHOLDER_RE.finditer(text):
        param = m.group(1)
        if param not in ITEM_PARAM_WHITELIST:
            violations.append(f"[白名单外参数] copywriting.item.{entry_key} 引用未注册参数 {{{param}}}（防反向定义）")
    for cond in entry.get("conditions", []):
        when_clause = cond.get("when", {})
        if isinstance(when_clause, dict):
            for cond_key in when_clause:
                if cond_key not in ITEM_PARAM_WHITELIST:
                    violations.append(f"[白名单外条件] copywriting.item.{entry_key} 条件键 {cond_key} 不在属性白名单")


def _audit_domain_entry(domain: str, entry_key: str, entry: dict[str, Any], violations: list[str]) -> None:
    """审查单条文案条目的各分支模板。"""
    is_prob = (domain == "probability")
    for branch in BRANCH_KEYS:
        text = str(entry.get(branch, ""))
        if not text:
            continue
        ref_key = f"copywriting.{domain}.{entry_key}.{branch}"
        if LEGACY_PLACEHOLDER_RE.search(text):
            violations.append(f"[占位符残留] {ref_key} 含 %s/%d/空 {{}}")
        if domain in ("narrative", "probability"):
            _audit_narrative_and_prob(ref_key, text, violations, is_prob)
        if domain == "item":
            _audit_item_entry(entry_key, entry, text, violations)


def _audit_backend_inlines(violations: list[str]) -> None:
    """审查后端 GDScript 中是否存在硬编码文案模板字面量及基础英文文本纯洁性。"""
    for gd in BACKEND.rglob("*.gd"):
        if gd.name in RESOLVER_FILES:
            continue
        for idx, line in enumerate(gd.read_text(encoding="utf-8").splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("#") or stripped.startswith('"""'):
                continue
            if PLACEHOLDER_RE.search(line) and CJK_RE.search(line):
                violations.append(f"[零内联] {gd.relative_to(ROOT)}:{idx} 代码含文案模板字面量")

    base_msg_path = BACKEND / "infrastructure" / "logging" / "system_base_messages.gd"
    if base_msg_path.exists():
        for idx, line in enumerate(base_msg_path.read_text(encoding="utf-8").splitlines(), 1):
            code_part = line.split("#")[0]
            if not re.match(r"\s*const\s+MSG_", code_part):
                continue
            if CJK_RE.search(code_part):
                violations.append(f"[英文模板混杂] {base_msg_path.relative_to(ROOT)}:{idx} 基础英文文本严禁含中文")
            if LEGACY_PLACEHOLDER_RE.search(code_part) or re.search(r"\{\d+\}", code_part):
                violations.append(f"[英文模板占位符] {base_msg_path.relative_to(ROOT)}:{idx} 须使用 {{param}} 命名占位符")


def _load_copywriting_domains(cw_dir: Path) -> dict[str, dict[str, Any]]:
    """加载所有文案域字典数据。"""
    domains = {"item": {}, "narrative": {}, "probability": {}, "bulletin": {}}
    for f in sorted(cw_dir.glob("*.json")):
        domain = f.stem
        if domain in domains:
            domains[domain] = json.loads(f.read_text(encoding="utf-8"))
    return domains


def _print_copywriting_summary(violations: list[str], hints: list[str]) -> int:
    """输出文案审查结论并返回退出码。"""
    print(f"违规总数: {len(violations)} / 提示: {len(hints)}")
    for v in violations:
        print(f"  ✗ {v}")
    for h in hints:
        print(f"  · {h}")

    print("-" * 80)
    if violations:
        print("【审查结论】未通过（存在统一文案违规，已阻断！）")
        return 1
    print("【审查结论】通过（统一文案合规、域红线保留、零内联）")
    return 0


def run_copywriting_audit() -> int:
    """执行统一文案配置系统深度审查入口主流程。"""
    print("=" * 80)
    print("🛡️ 卡拉尔世界引擎：统一文案配置系统深度审查报告")
    print("=" * 80)

    violations: list[str] = []
    hints: list[str] = []
    cw_dir = CONFIG / "copywriting"
    if not cw_dir.exists():
        print("【审查结论】未通过（config/copywriting/ 缺失，已阻断！）")
        return 1

    domains = _load_copywriting_domains(cw_dir)
    print(f"统一文案域: {[d for d, v in domains.items() if v]} / 条目: {sum(len(v) for v in domains.values())}")

    for domain, entries in domains.items():
        if isinstance(entries, dict):
            for entry_key, entry in entries.items():
                if isinstance(entry, dict):
                    _audit_domain_entry(domain, entry_key, entry, violations)

    _audit_backend_inlines(violations)
    return _print_copywriting_summary(violations, hints)


if __name__ == "__main__":
    sys.exit(run_copywriting_audit())
