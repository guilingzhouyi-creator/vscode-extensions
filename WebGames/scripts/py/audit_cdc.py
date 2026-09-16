#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 配置收口审计)
# 文件路径: WebGames/scripts/py/audit_cdc.py
# 架构定位: 配置合规分析器 (Config Compliance Analyzer)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: config/ 与 backend/ | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 静态断言配置驱动收口与单一真源，拦截未经注册的次分类与裸配置硬编码
# 退出语义与设计依据: 退出码: 0=合规, 1=存在配置散落 | 设计依据: WebGames 零硬编码契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_cdc.py
#   python scripts/py/audit_cdc.py --json
# ==============================================================================
import json
import re
import sys
from pathlib import Path
from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

ROOT = resolve_repo_root()
BACKEND = ROOT / "backend"
CONFIG = ROOT / "config"


def load_registered_canonical_ids() -> set:
    """加载 config/items/*.json 全量已注册 canonical_id 集合"""
    registered = set()
    items_dir = CONFIG / "items"
    if items_dir.exists():
        for f in items_dir.glob("*.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                for item in data.get("items", []):
                    cid = item.get("canonical_id")
                    if cid:
                        registered.add(cid)
            except Exception as e:
                print(f"[WARN] 读取物品配置失败 {f.name}: {e}", file=sys.stderr)
    return registered


def check_code_canonical_id_references(registered_ids: set, violations: list) -> int:
    """扫描 backend 代码中出现的 KALAR:... 字面量，校验是否全部已注册"""
    scanned_count = 0
    kalar_pattern = re.compile(r'"(KALAR:[A-Z0-9_:]+)"')

    for gd_file in BACKEND.rglob("*.gd"):
        try:
            lines = gd_file.read_text(encoding="utf-8").splitlines()
            for line_idx, line in enumerate(lines, 1):
                # 剔除单行注释
                code_part = line.split("#")[0]
                matches = kalar_pattern.findall(code_part)
                for cid in matches:
                    scanned_count += 1
                    if cid not in registered_ids:
                        rel_path = gd_file.relative_to(ROOT)
                        violations.append(
                            f"[ID引用漂移] {rel_path}:{line_idx} 引用了未在 config/items 中注册的物品ID: {cid}"
                        )
        except Exception as e:
            violations.append(f"[文件读取错误] {gd_file}: {e}")

    return scanned_count


def check_ast_kind_single_source(violations: list) -> set:
    """校验 AST kind 单一真源解析"""
    src_file = BACKEND / "domains" / "narrative_orchestration" / "narrative_causality_orchestrator.gd"
    if not src_file.exists():
        violations.append(f"[真源缺失] 找不到编排器源文件: {src_file}")
        return set()

    src = src_file.read_text(encoding="utf-8")
    kinds = {"AND", "OR", "NOT"}
    for m in re.finditer(r'^\s*"([A-Z_]+)":', src, re.MULTILINE):
        kinds.add(m.group(1))

    expected_mandatory = {"TOWN_EQUALS", "MIN_LEVEL", "HOUR_BETWEEN", "REPUTATION_GREATER"}
    missing = expected_mandatory - kinds
    if missing:
        violations.append(f"[AST真源缺漏] 编排器 match 分支缺少必要条件 kind: {missing}")

    return kinds


def check_gacha_rates_and_pity(violations: list) -> dict:
    """校验 domains.gacha 概率表值域与保底阶梯单调性"""
    gacha_file = CONFIG / "domains" / "gacha.json"
    if not gacha_file.exists():
        violations.append(f"[配置缺失] 找不到 Gacha 配置文件: {gacha_file}")
        return {}

    try:
        data = json.loads(gacha_file.read_text(encoding="utf-8"))
    except Exception as e:
        violations.append(f"[JSON解析失败] gacha.json: {e}")
        return {}

    rates = data.get("rates", {})
    for key, val in rates.items():
        if not isinstance(val, (int, float)) or val < 0.0 or val > 1.0:
            violations.append(f"[Gacha概率越界] rates.{key} = {val} 超出 [0.0, 1.0] 合法值域")

    pity = data.get("pity", {})
    soft = pity.get("soft_threshold")
    hard = pity.get("hard_threshold")
    inc = pity.get("soft_increment_per_pull")
    guaranteed = pity.get("hard_guaranteed_rate")

    if not isinstance(soft, int) or soft <= 0:
        violations.append(f"[Gacha保底非法] pity.soft_threshold = {soft} 必须为正整数")
    if not isinstance(hard, int) or hard <= 0:
        violations.append(f"[Gacha保底非法] pity.hard_threshold = {hard} 必须为正整数")
    if isinstance(soft, int) and isinstance(hard, int) and soft >= hard:
        violations.append(f"[Gacha保底倒挂] soft_threshold({soft}) 必须严格小于 hard_threshold({hard})")
    if not isinstance(inc, (int, float)) or inc <= 0.0 or inc > 1.0:
        violations.append(f"[Gacha步进越界] pity.soft_increment_per_pull = {inc} 必须在 (0.0, 1.0] 之间")
    if guaranteed != 1.0:
        violations.append(f"[Gacha绝对保底非法] pity.hard_guaranteed_rate = {guaranteed} 必须严格为 1.0")

    return data


def run_cdc_audit() -> int:
    print("=" * 80)
    print("🛡️ 卡拉尔世界引擎：配置驱动收口与单一真源审查 (Phase 25)")
    print("=" * 80)

    violations = []
    registered_ids = load_registered_canonical_ids()
    code_ref_count = check_code_canonical_id_references(registered_ids, violations)
    parsed_kinds = check_ast_kind_single_source(violations)
    check_gacha_rates_and_pity(violations)

    print(f"  • 已注册 Canonical ID 数量: {len(registered_ids)} 个")
    print(f"  • 代码引用 Canonical ID 校验点: {code_ref_count} 处")
    print(f"  • 代码解析 AST 条件 Kind 白名单: {sorted(list(parsed_kinds))}")
    print(f"  • 审查违规项: {len(violations)} 项")
    print("-" * 80)

    if violations:
        print("❌ 发现以下配置驱动收口违规项:")
        for v in violations:
            print(f"  - {v}")
        print("\n【审查结论】未通过（存在配置或引用漂移）")
        return 1
    else:
        print("【审查结论】通过（ID 引用严格自洽、AST Kind 单一真源直读、Gacha 值域守恒）")
        return 0


if __name__ == "__main__":
    sys.exit(run_cdc_audit())
