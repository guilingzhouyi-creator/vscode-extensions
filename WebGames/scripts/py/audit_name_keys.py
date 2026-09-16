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
import json
import re
import sys
from pathlib import Path

from audit_common import ensure_utf8_stdout, resolve_repo_root
from audit_common import contains_cjk

ensure_utf8_stdout()

ROOT = resolve_repo_root()
CONFIG = ROOT / "config"

# 三段式：<域>.<条目>.<字段>（全小写英文点分，字段级最后一段）
KEY_RE = re.compile(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")

MAGIC_TABLES = ("rank_tiers", "mana_aptitudes", "magic_forms", "profession_ranks")


def collect_magic_keys() -> list:
    """魔法域名称键：magic_tiers.json 四表 entry.name_key"""
    path = CONFIG / "domains" / "magic_tiers.json"
    keys = []
    if not path.exists():
        return keys
    data = json.loads(path.read_text(encoding="utf-8"))
    for table in MAGIC_TABLES:
        for entry in data.get(table, {}).values():
            nk = str(entry.get("name_key", ""))
            if nk:
                keys.append(nk)
    return keys


def collect_item_keys() -> list:
    """物品域名称键：config/items/*.json 的 loc_name_key + english_name（en_US 由物品配置提供）"""
    keys = []
    for f in sorted((CONFIG / "items").glob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        items = data.get("items", [])
        if isinstance(items, dict):
            items = list(items.values())
        for it in items:
            nk = str(it.get("loc_name_key", ""))
            if nk:
                keys.append(nk)
    return keys


def load_en_us_dict() -> dict:
    path = CONFIG / "i18n" / "en_US.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def run_name_keys_audit() -> int:
    print("=" * 80)
    print("🛡️ 卡拉尔世界引擎：全局名称键统一注册表深度审查报告 (Phase 19)")
    print("=" * 80)

    violations = []

    magic_keys = collect_magic_keys()
    item_keys = collect_item_keys()
    en_us = load_en_us_dict()
    en_us_keys = set(en_us.keys())

    all_keys = []
    for src, keys in (("magic", magic_keys), ("item", item_keys)):
        for k in keys:
            all_keys.append((src, k))

    # 1. 三段格式校验
    for src, k in all_keys:
        if not KEY_RE.match(k):
            violations.append(f"[格式] {src} 名称键非三段式英文点分: {k}")

    # 2. 键本体禁中文
    for src, k in all_keys:
        if contains_cjk(k):
            violations.append(f"[禁中文] {src} 名称键含中文字符: {k}")

    # 3. 跨域唯一性（不同域出现同键 → 冲突）
    seen = {}
    for src, k in all_keys:
        if k in seen and seen[k] != src:
            violations.append(f"[跨域冲突] 名称键 '{k}' 同时属于 {seen[k]} 与 {src}")
        else:
            seen[k] = src

    # 4. en_US 覆盖 100%：魔法键必须 ⊆ en_US 词典（物品键由 english_name 提供，不进词典文件）
    for k in magic_keys:
        if k not in en_us_keys:
            violations.append(f"[en_US 缺失] 魔法名称键未在 config/i18n/en_US.json 登记: {k}")

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
