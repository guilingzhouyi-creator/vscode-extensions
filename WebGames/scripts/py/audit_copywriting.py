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
"""统一文案配置系统深度审查：校验四域文案配置与叙事模板的事实源一致性（Phase 24）。"""

import json
import re
import sys
from pathlib import Path
from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

ROOT = resolve_repo_root()
CONFIG = ROOT / "config"
BACKEND = ROOT / "backend"

# 物品描述模板属性白名单（本体已注册字段 + 运行时状态，防反向定义）
ITEM_PARAM_WHITELIST = {
    "name", "tier_rank", "mass_kg", "volume_slots", "market_value",
    "quantity", "durability", "enchant", "quality_tier",
}
# 判定/执行语义字段（描述层不承担判定；概率文案只读）
JUDGMENT_FIELDS = {"action", "dispatch", "lifecycle", "probability", "trigger", "execute", "spawn"}
PLACEHOLDER_RE = re.compile(r"\{([a-z_][a-z0-9_]*)\}")
LEGACY_PLACEHOLDER_RE = re.compile(r"%[sd]|%\.\d*f|\{\}")
CJK_RE = re.compile(r"[\u4e00-\u9fff]")

# 解析器白名单（零内联扫描跳过——共享核心/域解析器自身）
RESOLVER_FILES = {
    "copywriting_resolver.gd", "item_description_resolver.gd",
    "event_description_resolver.gd", "narrative_flow_resolver.gd",
}


def run_copywriting_audit() -> int:
    print("=" * 80)
    print("🛡️ 卡拉尔世界引擎：统一文案配置系统深度审查报告 (Phase 24)")
    print("=" * 80)

    violations = []
    hints = []
    cw_dir = CONFIG / "copywriting"
    if not cw_dir.exists():
        print("【审查结论】未通过（config/copywriting/ 缺失，已阻断！）")
        return 1

    domains = {"item": {}, "narrative": {}, "probability": {}, "bulletin": {}}
    for f in sorted(cw_dir.glob("*.json")):
        domain = f.stem
        if domain in domains:
            domains[domain] = json.loads(f.read_text(encoding="utf-8"))
    print(f"统一文案域: {[d for d, v in domains.items() if v]} / 条目: {sum(len(v) for v in domains.values())}")

    # 1. 通用：占位符残留 + 2. 域红线（判定字段）+ 3. 物品属性白名单
    for domain, entries in domains.items():
        for entry_key, entry in entries.items():
            for branch in ("base", "text", "success", "failure", "partial"):
                text = str(entry.get(branch, ""))
                if not text:
                    continue
                if LEGACY_PLACEHOLDER_RE.search(text):
                    violations.append(f"[占位符残留] copywriting.{domain}.{entry_key}.{branch} 含 %s/%d/空 {{}}")
                if domain in ("narrative", "probability"):
                    # 域感知判定禁入：probability 域正文描述概率结果属主题词（合法），
                    # 豁免 "probability" 词本身；其余执行语义词（action/dispatch/…）全域拦截。
                    forbidden = JUDGMENT_FIELDS
                    if domain == "probability":
                        forbidden = JUDGMENT_FIELDS - {"probability"}
                    for jf in forbidden:
                        if jf in text:
                            violations.append(f"[判定禁入] copywriting.{domain}.{entry_key}.{branch} 含判定/执行语义 {jf}")
                if domain == "item":
                    for m in PLACEHOLDER_RE.finditer(text):
                        p = m.group(1)
                        if p not in ITEM_PARAM_WHITELIST:
                            violations.append(f"[白名单外参数] copywriting.item.{entry_key} 引用未注册参数 {{{p}}}（防反向定义）")
                    for cond in entry.get("conditions", []):
                        for key in cond.get("when", {}).keys():
                            if key not in ITEM_PARAM_WHITELIST:
                                violations.append(f"[白名单外条件] copywriting.item.{entry_key} 条件键 {key} 不在属性白名单")

    # 4. 通用：零内联（后端代码含 {param} 中文模板字面量）
    for gd in BACKEND.rglob("*.gd"):
        if gd.name in RESOLVER_FILES:
            continue
        for idx, line in enumerate(gd.read_text(encoding="utf-8").splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith("#") or stripped.startswith('"""'):
                continue
            if PLACEHOLDER_RE.search(line) and CJK_RE.search(line):
                violations.append(f"[零内联] {gd.relative_to(ROOT)}:{idx} 代码含文案模板字面量")

    # 5. 提示通道（当前无待提示项，保留通道供未来扩展）
    pass

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


if __name__ == "__main__":
    sys.exit(run_copywriting_audit())
