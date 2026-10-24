#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Tools)
# 文件路径: WebGames/mod_sdk/tools/check_mod_destiny.py
# 架构定位: 单包命途契约校验器 (Destiny Mod Budget & Causality Validators)
# 依赖与触发: 触发方: check_mod.py | 上游: pack.json / destinies.json | 运行时: Python 3.10+
# 职责说明: 校验 UI 能力枚举、身世六维预算与金币上限、正负因果天赋守恒及初始套件容量
# 退出语义与设计依据: 纯静态校验无独立退出码，违规经 DiagnosticItem 回传 | 设计依据: 《卡拉尔数据契约规范 v1.0》
# ------------------------------------------------------------------------------
# 用法示例:
#   from check_mod_destiny import check_destinies_file
# ==============================================================================
"""单包命途契约校验：UI 策略、六维预算、正负因果与初始套件四类不变量。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from check_mod_common import (
    BUILTIN_DAG_IDS,
    BUILTIN_STARTER_KITS,
    BUILTIN_TRAIT_COSTS,
    VALID_ATTRIBUTE_KEYS,
    VALID_UI_SELECTION_MODES,
    DiagnosticItem,
    add_diag,
    normalize_named_items,
    safe_load_json,
)

# 六维属性加成的单维下限与上限，以及六维代数和的预算包络。
STAT_BONUS_MIN = -2
STAT_BONUS_MAX = 3
STAT_NET_MIN = -2
STAT_NET_MAX = 4
# 初始金币的合法闭区间与初始套件的单套件数上限。
GOLD_CAP_MIN = 0
GOLD_CAP_MAX = 1000
KIT_ITEM_LIMIT = 10


def extract_rules_list(rules_data: Any) -> list[dict[str, Any]]:
    """从列表或对象形态中提取路由规则列表。"""
    if isinstance(rules_data, list):
        return [rule for rule in rules_data if isinstance(rule, dict)]
    if isinstance(rules_data, dict):
        for key in ("routing_rules", "rules", "prologue_routing_rules"):
            value = rules_data.get(key)
            if isinstance(value, list):
                return [rule for rule in value if isinstance(rule, dict)]
    return []


def is_valid_number(value: Any) -> bool:
    """判断值是否为合法数值（bool 不计入数值）。"""
    return not isinstance(value, bool) and isinstance(value, (int, float))


def check_destiny_ui_capabilities(
    destiny_data: dict[str, Any],
    rel_name: str,
    diags: list[DiagnosticItem],
) -> None:
    """校验 destinies.json 中的 ui_capabilities 模式枚举合法性。"""
    ui_cap = destiny_data.get("ui_capabilities")
    if ui_cap is None:
        return
    if not isinstance(ui_cap, dict):
        add_diag(
            diags,
            "ERR_DESTINY_INVALID_UI_MODE",
            rel_name,
            "ui_capabilities 必须为 JSON 对象",
            "请将 ui_capabilities 声明为包含 origin_selection_mode 等字段的对象",
        )
        return

    for mode_key in ("origin_selection_mode", "trait_selection_mode"):
        value = ui_cap.get(mode_key)
        if value is not None and (not isinstance(value, str) or value not in VALID_UI_SELECTION_MODES):
            add_diag(
                diags,
                "ERR_DESTINY_INVALID_UI_MODE",
                rel_name,
                f"ui_capabilities.{mode_key} 取值非法: '{value}'",
                f"请将 {mode_key} 修改为合法枚举值: INHERIT, ALLOW_MANUAL 或 FORCE_RANDOM",
            )

    reroll = ui_cap.get("allow_attribute_reroll")
    if reroll is not None and not isinstance(reroll, bool):
        add_diag(
            diags,
            "ERR_DESTINY_INVALID_UI_MODE",
            rel_name,
            f"ui_capabilities.allow_attribute_reroll 必须为布尔值，实际为: {reroll!r}",
            "请将 allow_attribute_reroll 设置为 true 或 false",
        )


def check_origin_stat_bonuses(
    origin_id: str,
    bonuses: dict[str, Any],
    rel_name: str,
    diags: list[DiagnosticItem],
) -> None:
    """校验单个身世的六维加成单维范围与净总和预算。"""
    net_sum: float = 0.0
    for stat_key, value in bonuses.items():
        if stat_key not in VALID_ATTRIBUTE_KEYS or not is_valid_number(value):
            add_diag(
                diags,
                "ERR_DESTINY_STAT_BUDGET_EXCEEDED",
                rel_name,
                f"自定义身世 '{origin_id}' 含非法属性键或数值: {stat_key}={value!r}",
                "属性键仅限 STR/CON/INT/AGI/SPR/VIT，数值必须为 [-2, 3] 内的整数",
            )
            continue
        if not (STAT_BONUS_MIN <= value <= STAT_BONUS_MAX):
            add_diag(
                diags,
                "ERR_DESTINY_STAT_BUDGET_EXCEEDED",
                rel_name,
                f"自定义身世 '{origin_id}' 单维属性 '{stat_key}' 加成 {value} 超出 [-2, 3] 红线",
                f"请将 '{origin_id}' 的 {stat_key} 加成收敛至 [-2, 3] 范围内",
            )
        net_sum += value

    if not (STAT_NET_MIN <= net_sum <= STAT_NET_MAX):
        add_diag(
            diags,
            "ERR_DESTINY_STAT_BUDGET_EXCEEDED",
            rel_name,
            f"自定义身世 '{origin_id}' 六维加成净代数和 {net_sum} 超出 [-2, 4] 预算红线",
            f"请平衡 '{origin_id}' 的正负属性加成，使净代数和保持在 [-2, 4] 之间",
        )


def check_single_origin_budget(
    origin: dict[str, Any],
    index: int,
    rel_name: str,
    diags: list[DiagnosticItem],
    valid_dags: set[str],
    valid_kits: set[str],
) -> None:
    """校验单个自定义身世的六维加成预算、初始金币上限与序章 DAG/套件引用。"""
    origin_id = str(origin.get("origin_id") or origin.get("id") or f"index_{index}")
    gold = origin.get("initial_gold", 0)
    if not is_valid_number(gold) or not (GOLD_CAP_MIN <= gold <= GOLD_CAP_MAX):
        add_diag(
            diags,
            "ERR_DESTINY_GOLD_CAP_EXCEEDED",
            rel_name,
            f"自定义身世 '{origin_id}' 初始金币 {gold} 超出合法区间 [0, 1000]",
            "请将 custom_origins 中的 initial_gold 调整至 0 到 1000 之间",
        )

    bonuses = origin.get("attribute_bonus", {})
    if not isinstance(bonuses, dict):
        add_diag(
            diags,
            "ERR_DESTINY_STAT_BUDGET_EXCEEDED",
            rel_name,
            f"自定义身世 '{origin_id}' 的 attribute_bonus 必须为对象",
            "请将 attribute_bonus 声明为六维属性键值对字典",
        )
    else:
        check_origin_stat_bonuses(origin_id, bonuses, rel_name, diags)

    prologue_dag_id = origin.get("prologue_dag_id")
    if prologue_dag_id and (not isinstance(prologue_dag_id, str) or prologue_dag_id.strip() not in valid_dags):
        add_diag(
            diags,
            "ERR_DESTINY_UNKNOWN_DAG_REF",
            rel_name,
            f"自定义身世 '{origin_id}' 引用的 prologue_dag_id '{prologue_dag_id}' "
            "不存在于 declared_dag_ids 或内置序章图中",
            "请确保引用的 prologue_dag_id 在 dag_graphs/ 中存在或属于内置序章图",
        )

    starter_kit_id = origin.get("starter_kit_id")
    if starter_kit_id and (not isinstance(starter_kit_id, str) or starter_kit_id.strip() not in valid_kits):
        add_diag(
            diags,
            "ERR_DESTINY_UNKNOWN_KIT_REF",
            rel_name,
            f"自定义身世 '{origin_id}' 引用的 starter_kit_id '{starter_kit_id}' "
            "不存在于 custom_starter_kits 或内置套件中",
            "请确保 starter_kit_id 引用了合法已声明的套件标识符（如 KIT_HUMAN_DEFAULT）",
        )


def check_destiny_origins(
    destiny_data: dict[str, Any],
    rel_name: str,
    diags: list[DiagnosticItem],
    valid_dags: set[str],
    valid_kits: set[str],
) -> None:
    """校验 custom_origins 列表中的所有自定义身世。"""
    origins = normalize_named_items(destiny_data.get("custom_origins"), "origin_id")
    for index, origin in enumerate(origins):
        check_single_origin_budget(origin, index, rel_name, diags, valid_dags, valid_kits)


def extract_trait_cost_map(
    destiny_data: dict[str, Any],
    rel_name: str,
    diags: list[DiagnosticItem],
) -> dict[str, int | float]:
    """构建内置与自定义天赋的 cost 映射表，并校验自定义天赋基础极性。"""
    cost_map: dict[str, int | float] = dict(BUILTIN_TRAIT_COSTS)
    traits = normalize_named_items(destiny_data.get("custom_traits"), "trait_id")
    for index, trait in enumerate(traits):
        trait_id = str(trait.get("trait_id") or trait.get("id") or f"trait_{index}")
        cost = trait.get("cost")
        trait_type = str(trait.get("type", "")).upper()
        if not is_valid_number(cost) or cost == 0:
            add_diag(
                diags,
                "ERR_DESTINY_CAUSALITY_IMBALANCE",
                rel_name,
                f"自定义天赋 '{trait_id}' 的 cost ({cost!r}) 必须为非零数值",
                "正向天赋请设置 cost > 0，负向天赋请设置 cost < 0",
            )
            continue
        polarity_conflict = (trait_type == "POSITIVE" and cost <= 0) or (
            trait_type == "NEGATIVE" and cost >= 0
        )
        if polarity_conflict:
            add_diag(
                diags,
                "ERR_DESTINY_CAUSALITY_IMBALANCE",
                rel_name,
                f"自定义天赋 '{trait_id}' 的极性类型 ({trait_type}) 与 cost ({cost}) 符号矛盾",
                "确保 POSITIVE 天赋 cost > 0 且 NEGATIVE 天赋 cost < 0",
            )
        cost_map[trait_id] = cost
    return cost_map


def resolve_endpoint_cost(
    endpoint: Any,
    explicit_cost: Any,
    cost_map: dict[str, int | float],
) -> int | float | None:
    """解析配对预设中正/负端点的因果点数。"""
    if is_valid_number(explicit_cost):
        return explicit_cost
    if isinstance(endpoint, dict):
        inline_cost = endpoint.get("cost")
        if is_valid_number(inline_cost):
            return inline_cost
        trait_id = endpoint.get("trait_id") or endpoint.get("id")
        return cost_map.get(trait_id) if isinstance(trait_id, str) else None
    return cost_map.get(endpoint) if isinstance(endpoint, str) else None


def check_destiny_causality_traits(
    destiny_data: dict[str, Any],
    rel_name: str,
    diags: list[DiagnosticItem],
) -> None:
    """校验 paired_presets 正负因果天赋配对守恒规则。"""
    cost_map = extract_trait_cost_map(destiny_data, rel_name, diags)
    custom_traits = normalize_named_items(destiny_data.get("custom_traits"), "trait_id")
    raw_presets = destiny_data.get("paired_presets")
    presets = [preset for preset in raw_presets if isinstance(preset, dict)] if isinstance(raw_presets, list) else []

    if custom_traits and not presets:
        add_diag(
            diags,
            "ERR_DESTINY_CAUSALITY_IMBALANCE",
            rel_name,
            "定义了 custom_traits 但缺少 paired_presets 正负因果天赋配对声明",
            "请在 paired_presets 中将正向与负向天赋成对绑定，且净 cost 绝对值 <= 1",
        )
        return

    for index, preset in enumerate(presets):
        positive_ref = preset.get("positive") if "positive" in preset else preset.get("positive_trait")
        negative_ref = preset.get("negative") if "negative" in preset else preset.get("negative_trait")
        positive_cost = resolve_endpoint_cost(positive_ref, preset.get("positive_cost"), cost_map)
        negative_cost = resolve_endpoint_cost(negative_ref, preset.get("negative_cost"), cost_map)

        if positive_cost is None or negative_cost is None:
            add_diag(
                diags,
                "ERR_DESTINY_CAUSALITY_IMBALANCE",
                rel_name,
                f"paired_presets[{index}] 引用了未定义或缺少 cost 的天赋: "
                f"positive={positive_ref!r}, negative={negative_ref!r}",
                "请确保配对引用的天赋已在 custom_traits 或内置天赋库中声明合法 cost",
            )
            continue

        net_delta = abs(positive_cost + negative_cost)
        if positive_cost <= 0 or negative_cost >= 0 or net_delta > 1:
            add_diag(
                diags,
                "ERR_DESTINY_CAUSALITY_IMBALANCE",
                rel_name,
                f"paired_presets[{index}] 违反因果守恒: positive_cost={positive_cost}, "
                f"negative_cost={negative_cost}, 净和绝对值={net_delta} (要求 pos>0, neg<0 且 |pos+neg|<=1)",
                "请调整正负天赋的 cost 配平，确保一正一负且代数和绝对值不超过 1",
            )


def validate_kit_item_entry(
    kit_id: str,
    item_index: int,
    item: Any,
    rel_name: str,
    diags: list[DiagnosticItem],
) -> int:
    """校验套件内单条初始物品记录，返回合法物品件数。"""
    if not isinstance(item, dict):
        add_diag(
            diags,
            "ERR_DESTINY_KIT_INVALID",
            rel_name,
            f"自定义套件 '{kit_id}' 第 {item_index} 项物品必须为对象",
            "每项物品应包含 canonical_id 与 count 字段",
        )
        return 0

    canonical_id = item.get("canonical_id")
    if not isinstance(canonical_id, str) or not canonical_id.strip():
        add_diag(
            diags,
            "ERR_DESTINY_KIT_INVALID",
            rel_name,
            f"自定义套件 '{kit_id}' 第 {item_index} 项物品的 canonical_id 为空或非法",
            "请填写非空的权威物品标识符（如 KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD）",
        )

    count = item.get("count", 1)
    if isinstance(count, bool) or not isinstance(count, int) or count <= 0:
        add_diag(
            diags,
            "ERR_DESTINY_KIT_INVALID",
            rel_name,
            f"自定义套件 '{kit_id}' 第 {item_index} 项物品数量 count ({count!r}) 必须为正整数",
            "请将该物品的 count 设置为 >= 1 的正整数",
        )
        return 0
    return count


def check_single_starter_kit(
    kit: dict[str, Any],
    index: int,
    rel_name: str,
    diags: list[DiagnosticItem],
) -> None:
    """校验单个自定义初始装备套件。"""
    kit_id = str(kit.get("kit_id") or kit.get("id") or f"kit_{index}")
    gold = kit.get("initial_gold", 0)
    if not is_valid_number(gold) or not (GOLD_CAP_MIN <= gold <= GOLD_CAP_MAX):
        add_diag(
            diags,
            "ERR_DESTINY_GOLD_CAP_EXCEEDED",
            rel_name,
            f"自定义套件 '{kit_id}' 的 initial_gold ({gold}) 超出 [0, 1000] 上限",
            "请将套件的 initial_gold 调整至 0 到 1000 范围内",
        )

    items = kit.get("initial_items") if "initial_items" in kit else kit.get("items")
    if not isinstance(items, list) or not items:
        add_diag(
            diags,
            "ERR_DESTINY_KIT_INVALID",
            rel_name,
            f"自定义套件 '{kit_id}' 的 initial_items 必须为非空数组",
            "请在套件中配置 initial_items 列表并至少包含 1 件合法初始物品",
        )
        return

    total_count = sum(
        validate_kit_item_entry(kit_id, item_index, item, rel_name, diags)
        for item_index, item in enumerate(items)
    )
    if total_count > KIT_ITEM_LIMIT or len(items) > KIT_ITEM_LIMIT:
        add_diag(
            diags,
            "ERR_DESTINY_KIT_INVALID",
            rel_name,
            f"自定义套件 '{kit_id}' 物品总件数 ({total_count}) 超过上限 10 件",
            "请精简 custom_starter_kits 中的初始物品数量，使单套总件数 <= 10",
        )


def check_destiny_starter_kits(
    destiny_data: dict[str, Any],
    rel_name: str,
    diags: list[DiagnosticItem],
) -> None:
    """校验 custom_starter_kits 列表中的所有自定义套件。"""
    kits = normalize_named_items(destiny_data.get("custom_starter_kits"), "kit_id")
    for index, kit in enumerate(kits):
        check_single_starter_kit(kit, index, rel_name, diags)


def check_destiny_custom_routing_rules(
    destiny_data: dict[str, Any],
    rel_name: str,
    valid_dags: set[str],
    diags: list[DiagnosticItem],
) -> None:
    """校验 destinies.json 中的 custom_routing_rules 目标 DAG 是否合法。"""
    raw_rules = destiny_data.get("custom_routing_rules")
    if not raw_rules:
        return
    rules = extract_rules_list(raw_rules) if not isinstance(raw_rules, list) else [
        rule for rule in raw_rules if isinstance(rule, dict)
    ]
    for index, rule in enumerate(rules):
        target = rule.get("target_dag_id")
        if not target or not isinstance(target, str) or target.strip() not in valid_dags:
            add_diag(
                diags,
                "ERR_DESTINY_UNKNOWN_DAG_REF",
                rel_name,
                f"custom_routing_rules[{index}] 引用的 target_dag_id '{target}' "
                "不存在于 declared_dag_ids 或内置序章图中",
                "请指定已存在的有效序章 DAG 图元标识符",
            )


def collect_declared_kit_ids(destiny_data: dict[str, Any]) -> set[str]:
    """汇总 destinies.json 中已声明的自定义套件标识符。"""
    declared: set[str] = set()
    for kit in normalize_named_items(destiny_data.get("custom_starter_kits"), "kit_id"):
        kit_id = kit.get("kit_id") or kit.get("id")
        if isinstance(kit_id, str) and kit_id.strip():
            declared.add(kit_id.strip())
    return declared


def check_destinies_file(
    mod_dir: Path,
    diags: list[DiagnosticItem],
    rel_prefix: str = "",
    declared_dag_ids: set[str] | None = None,
) -> dict[str, Any] | None:
    """若存在 destinies.json，则校验其 UI 策略、六维预算、正负因果与初始套件。"""
    destiny_path = mod_dir / "destinies.json"
    if not destiny_path.is_file():
        return None

    rel_name = f"{rel_prefix}destinies.json" if rel_prefix else "destinies.json"
    data = safe_load_json(destiny_path, rel_name, diags)
    if not isinstance(data, dict):
        if data is not None:
            add_diag(
                diags,
                "ERR_DESTINY_NOT_OBJECT",
                rel_name,
                "destinies.json 顶层必须为 JSON 对象",
                "请将 destinies.json 根节点调整为 JSON 对象 {}",
            )
        return None

    valid_dags = (declared_dag_ids or set()) | BUILTIN_DAG_IDS
    valid_kits = collect_declared_kit_ids(data) | BUILTIN_STARTER_KITS

    check_destiny_ui_capabilities(data, rel_name, diags)
    check_destiny_origins(data, rel_name, diags, valid_dags, valid_kits)
    check_destiny_causality_traits(data, rel_name, diags)
    check_destiny_starter_kits(data, rel_name, diags)
    check_destiny_custom_routing_rules(data, rel_name, valid_dags, diags)
    return data
