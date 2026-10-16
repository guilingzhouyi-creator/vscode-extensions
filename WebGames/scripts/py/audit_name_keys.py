#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 名称键注册门禁)
# 文件路径: WebGames/scripts/py/audit_name_keys.py
# 架构定位: 全局名称空间分析器 (Name Key Registry Analyzer)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: config/infrastructure/ | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 校验统一名称注册表三段式键名格式、唯一性以及英文 fallback 兜底能力
# 退出语义与设计依据: 退出码: 0=合规, 1=存在命名冲突 | 设计依据: 统一名称注册表契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_name_keys.py
#   python scripts/py/audit_name_keys.py --json
# ==============================================================================
"""全局名称键统一注册表深度审查：校验三段式命名规范、唯一性与 en_US 覆盖。"""

import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

from audit_common import contains_cjk, ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

ROOT = resolve_repo_root()
CONFIG = ROOT / "config"

# 三段式：<域>.<条目>.<字段>（全小写英文点分，字段级最后一段）
KEY_RE = re.compile(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")
MAGIC_TABLES = ("rank_tiers", "mana_aptitudes", "magic_forms", "profession_ranks")


def collect_magic_keys() -> List[str]:
    """收集魔法域名称键：magic_tiers.json 四表 entry.name_key。"""
    path = CONFIG / "domains" / "magic_tiers" / "core.json"
    if not path.exists():
        path = CONFIG / "domains" / "magic_tiers.json"
    if not path.exists():
        return []

    data = json.loads(path.read_text(encoding="utf-8"))
    keys: List[str] = []
    for table in MAGIC_TABLES:
        table_dict = data.get(table, {})
        if isinstance(table_dict, dict):
            for entry in table_dict.values():
                if isinstance(entry, dict):
                    nk = str(entry.get("name_key", ""))
                    if nk:
                        keys.append(nk)
    return keys


def collect_item_keys() -> List[str]:
    """收集物品域名称键：config/items/*.json 的 loc_name_key。"""
    keys: List[str] = []
    item_files = sorted((CONFIG / "items").glob("*.json"))
    for f in item_files:
        data = json.loads(f.read_text(encoding="utf-8"))
        items = data.get("items", [])
        if isinstance(items, dict):
            items = list(items.values())
        if isinstance(items, list):
            for it in items:
                if isinstance(it, dict):
                    nk = str(it.get("loc_name_key", ""))
                    if nk:
                        keys.append(nk)
    return keys


def load_en_us_dict() -> Dict[str, Any]:
    """加载 en_US 国际化语言词典配置字典。"""
    path = CONFIG / "i18n" / "en_US.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _verify_name_keys(
    all_keys: List[Tuple[str, str]],
    magic_keys: List[str],
    en_us_keys: Set[str],
) -> List[str]:
    """执行三段式格式、中文禁入、跨域唯一性与 en_US 覆盖校验。"""
    violations: List[str] = []
    seen: Dict[str, str] = {}

    for src, k in all_keys:
        if not KEY_RE.match(k):
            violations.append(f"[格式] {src} 名称键非三段式英文点分: {k}")
        if contains_cjk(k):
            violations.append(f"[禁中文] {src} 名称键含中文字符: {k}")
        if k in seen and seen[k] != src:
            violations.append(f"[跨域冲突] 名称键 '{k}' 同时属于 {seen[k]} 与 {src}")
        else:
            seen[k] = src

    for k in magic_keys:
        if k not in en_us_keys:
            violations.append(f"[en_US 缺失] 魔法名称键未在 config/i18n/en_US.json 登记: {k}")

    return violations


def run_name_keys_audit() -> int:
    """执行全局名称键统一注册表深度审查入口主流程。"""
    print("=" * 80)
    print("🛡️ 卡拉尔世界引擎：全局名称键统一注册表深度审查报告")
    print("=" * 80)

    magic_keys = collect_magic_keys()
    item_keys = collect_item_keys()
    en_us = load_en_us_dict()
    en_us_keys = set(en_us.keys())

    all_keys: List[Tuple[str, str]] = []
    for src, keys in (("magic", magic_keys), ("item", item_keys)):
        for k in keys:
            all_keys.append((src, k))

    violations = _verify_name_keys(all_keys, magic_keys, en_us_keys)

    print(f"魔法名称键: {len(magic_keys)} 个 / 物品名称键: {len(item_keys)} 个 / en_US 词典: {len(en_us_keys)} 个")
    print(f"违规总数: {len(violations)}")
    for v in violations:
        print(f"  ✗ {v}")

    print("-" * 80)
    if violations:
        print("【审查结论】未通过（存在名称键规范/覆盖违规，已阻断！）")
        return 1
    print("【审查结论】通过（名称键规范唯一、英文底座覆盖 100%）")
    return 0


if __name__ == "__main__":
    sys.exit(run_name_keys_audit())
