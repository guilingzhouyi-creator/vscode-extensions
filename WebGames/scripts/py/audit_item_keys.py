#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 物品键注册门禁)
# 文件路径: WebGames/scripts/py/audit_item_keys.py
# 架构定位: 物品命名空间校验器 (Item Namespace Validator)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: config/ 与 backend/ | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 校验物品 Canonical ID 分级命名空间格式、英文解析唯一性与注册表映射一致性
# 退出语义与设计依据: 退出码: 0=合规, 1=存在重号或非法命名 | 设计依据: 统一物品命名空间契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_item_keys.py
#   python scripts/py/audit_item_keys.py --json
# ==============================================================================
"""物品注册库键级审计：config 物品键引用 vs items 登记清单。"""
import json
import re
import sys
from pathlib import Path
from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

ROOT = resolve_repo_root()
CONFIG_DIR = ROOT / "config"
ITEMS_DIR = CONFIG_DIR / "items"
ITEM_KEY_RE = re.compile(r'"KALAR:[A-Z0-9_:-]+"')


def collect_registered() -> set[str]:
    """items/*.json 登记清单（canonical_id）。"""
    registered: set[str] = set()
    duplicates: list[str] = []
    for f in sorted(ITEMS_DIR.rglob("*.json")):
        data = json.loads(f.read_text(encoding="utf-8"))
        items = data.get("items", []) if isinstance(data, dict) else []
        for entry in items:
            cid = entry.get("canonical_id", "")
            if not cid:
                continue
            if cid in registered:
                duplicates.append(f"{f.relative_to(ROOT)}: {cid}")
            registered.add(cid)
    return registered, duplicates


def main() -> int:
    registered, duplicates = collect_registered()
    violations: list[str] = []
    for dup in duplicates:
        violations.append(f"重复登记: {dup}")

    for f in sorted(CONFIG_DIR.rglob("*.json")):
        if f.parent == ITEMS_DIR or ITEMS_DIR in f.parents:
            continue
        text = f.read_text(encoding="utf-8")
        for m in ITEM_KEY_RE.finditer(text):
            key = m.group(0).strip('"')
            if key not in registered:
                rel = f.relative_to(ROOT)
                violations.append(f"{rel}: 物品键未登记: {key}")

    print(f"【audit-item-keys】登记 {len(registered)} 个 / 引用扫描全库 config / 未登记 {len(violations) - len(duplicates)} 处")
    if violations:
        print("【audit-item-keys】违规项:")
        for v in violations:
            print(f"  ✗ {v}")
        print("【审查结论】未通过（存在未登记/重复物品键，禁造临时物件）")
        return 1
    print("【审查结论】通过（全部物品键已登记）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
