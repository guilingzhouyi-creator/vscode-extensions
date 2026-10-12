#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Tools)
# 文件路径: WebGames/mod_sdk/tools/check_mod.py
# 架构定位: MOD纯静态轻量自愈诊断器 (Pure Static Mod Validator & Diagnostic Tool)
# 依赖与触发: 触发方: CLI / 外部 Agent | 上游: MOD 目录与文件 | 下游: 控制台输出与结构化 JSON 自愈指引 | 运行时: Python 3.10+
# 职责说明: 纯静态校验 MOD 清单格式、因果 DAG 拓扑连通性与文案占位符白名单，输出自愈诊断
# 退出语义与设计依据: 退出码: 0=合规通过, 1=发现违规错误, 2=参数/IO错误 | 设计依据: 《卡拉尔数据契约规范 v1.0》与第一性原理
# ------------------------------------------------------------------------------
# 用法示例:
#   python mod_sdk/tools/check_mod.py ./my_mod
#   python mod_sdk/tools/check_mod.py ./my_mod --json
# ==============================================================================
"""纯静态轻量 MOD 检查器与自愈诊断器：专为外部开发者与自主 Agent 打造的门禁工具。"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

try:
    from cook_assets import cook_assets
except ImportError:
    cook_assets = None

# ==============================================================================
from check_mod_common import (
    DiagnosticItem,
    WHITELISTED_PLACEHOLDERS,
    PARAM_REGEX,
    REQUIRED_MANIFEST_FIELDS,
    VALID_ATTRIBUTE_KEYS,
    VALID_UI_SELECTION_MODES,
    BUILTIN_DAG_IDS,
    BUILTIN_STARTER_KITS,
    BUILTIN_TRAIT_COSTS,
    ensure_utf8_stdout as _ensure_utf8_stdout,
    add_diag as _add_diag,
    safe_load_json as _safe_load_json,
    normalize_named_items as _normalize_named_items,
)
from check_mod_dag import (
    check_dag_entries_and_terminals as _check_dag_entries_and_terminals,
    build_dag_graph_structure as _build_dag_graph_structure,
    detect_dag_cycle_kahn as _detect_dag_cycle_kahn,
    check_reachability as _check_reachability,
    flatten_i18n_dict as _flatten_i18n_dict,
    check_dag_file as _check_dag_file,
)
from check_mod_multi import (
    check_multi_incompatible_packs as _check_multi_incompatible_packs,
    register_entity_ids as _register_entity_ids,
    check_multi_duplicate_ids as _check_multi_duplicate_ids,
    check_multi_ui_policy_conflicts as _check_multi_ui_policy_conflicts,
    validate_multi_mods,
)



# ==============================================================================
# 三、单包命途契约校验器 (Destiny Mod Budget & Causality Validators)
# - 校验 ui_capabilities 枚举合法性 (INHERIT / ALLOW_MANUAL / FORCE_RANDOM)
# - 校验 custom_origins 六维预算 [-2, 3]、净和 [-2, 4] 与金币上限 [0, 1000]
# - 校验 paired_presets 正负因果天赋守恒 (pos > 0, neg < 0, |pos + neg| <= 1)
# - 校验 custom_starter_kits 初始物品容量 (<= 10 件) 与 canonical_id 非空
# ==============================================================================
def _check_destiny_ui_capabilities(destiny_data: dict[str, Any], rel_name: str, diags: list[DiagnosticItem]) -> None:
    """校验 destinies.json 中的 ui_capabilities 模式枚举合法性。"""
    ui_cap = destiny_data.get("ui_capabilities")
    if ui_cap is None:
        return
    if not isinstance(ui_cap, dict):
        _add_diag(diags, "ERR_DESTINY_INVALID_UI_MODE", rel_name, "ui_capabilities 必须为 JSON 对象", "请将 ui_capabilities 声明为包含 origin_selection_mode 等字段的对象")
        return

    for mode_key in ("origin_selection_mode", "trait_selection_mode"):
        val = ui_cap.get(mode_key)
        if val is not None and (not isinstance(val, str) or val not in VALID_UI_SELECTION_MODES):
            _add_diag(diags, "ERR_DESTINY_INVALID_UI_MODE", rel_name, f"ui_capabilities.{mode_key} 取值非法: '{val}'", f"请将 {mode_key} 修改为合法枚举值: INHERIT, ALLOW_MANUAL 或 FORCE_RANDOM")

    reroll = ui_cap.get("allow_attribute_reroll")
    if reroll is not None and not isinstance(reroll, bool):
        _add_diag(diags, "ERR_DESTINY_INVALID_UI_MODE", rel_name, f"ui_capabilities.allow_attribute_reroll 必须为布尔值，实际为: {reroll!r}", "请将 allow_attribute_reroll 设置为 true 或 false")


def _is_valid_number(val: Any) -> bool:
    """判断值是否为合法的 int 或 float（排除 bool）。"""
    return not isinstance(val, bool) and isinstance(val, (int, float))


def _check_origin_stat_bonuses(oid: str, bonuses: dict[str, Any], rel_name: str, diags: list[DiagnosticItem]) -> None:
    """校验单个身世的六维加成范围 [-2, 3] 与净总和 [-2, 4]。"""
    net_sum: float = 0.0
    for stat_key, val in bonuses.items():
        if stat_key not in VALID_ATTRIBUTE_KEYS or not _is_valid_number(val):
            _add_diag(diags, "ERR_DESTINY_STAT_BUDGET_EXCEEDED", rel_name, f"自定义身世 '{oid}' 含非法属性键或数值: {stat_key}={val!r}", "属性键仅限 STR/CON/INT/AGI/SPR/VIT，数值必须为 [-2, 3] 内的整数")
            continue
        if not (-2 <= val <= 3):
            _add_diag(diags, "ERR_DESTINY_STAT_BUDGET_EXCEEDED", rel_name, f"自定义身世 '{oid}' 单维属性 '{stat_key}' 加成 {val} 超出 [-2, 3] 红线", f"请将 '{oid}' 的 {stat_key} 加成收敛至 [-2, 3] 范围内")
        net_sum += val

    if not (-2 <= net_sum <= 4):
        _add_diag(diags, "ERR_DESTINY_STAT_BUDGET_EXCEEDED", rel_name, f"自定义身世 '{oid}' 六维加成净代数和 {net_sum} 超出 [-2, 4] 预算红线", f"请平衡 '{oid}' 的正负属性加成，使净代数和保持在 [-2, 4] 之间")


def _check_single_origin_budget(
    origin: dict[str, Any],
    idx: int,
    rel_name: str,
    diags: list[DiagnosticItem],
    valid_dags: set[str],
    valid_kits: set[str],
) -> None:
    """校验单个自定义身世的六维加成预算、初始金币上限与序章DAG/套件引用。"""
    oid = str(origin.get("origin_id") or origin.get("id") or f"index_{idx}")
    gold = origin.get("initial_gold", 0)
    if not _is_valid_number(gold) or not (0 <= gold <= 1000):
        _add_diag(diags, "ERR_DESTINY_GOLD_CAP_EXCEEDED", rel_name, f"自定义身世 '{oid}' 初始金币 {gold} 超出合法区间 [0, 1000]", "请将 custom_origins 中的 initial_gold 调整至 0 到 1000 之间")

    bonuses = origin.get("attribute_bonus", {})
    if not isinstance(bonuses, dict):
        _add_diag(diags, "ERR_DESTINY_STAT_BUDGET_EXCEEDED", rel_name, f"自定义身世 '{oid}' 的 attribute_bonus 必须为对象", "请将 attribute_bonus 声明为六维属性键值对字典")
    else:
        _check_origin_stat_bonuses(oid, bonuses, rel_name, diags)

    prologue_dag_id = origin.get("prologue_dag_id")
    if prologue_dag_id:
        if not isinstance(prologue_dag_id, str) or prologue_dag_id.strip() not in valid_dags:
            _add_diag(
                diags,
                "ERR_DESTINY_UNKNOWN_DAG_REF",
                rel_name,
                f"自定义身世 '{oid}' 引用的 prologue_dag_id '{prologue_dag_id}' 不存在于 declared_dag_ids 或内置序章图中",
                "请确保引用的 prologue_dag_id 在 dag_graphs/ 中存在或属于内置序章图",
            )

    starter_kit_id = origin.get("starter_kit_id")
    if starter_kit_id:
        if not isinstance(starter_kit_id, str) or starter_kit_id.strip() not in valid_kits:
            _add_diag(
                diags,
                "ERR_DESTINY_UNKNOWN_KIT_REF",
                rel_name,
                f"自定义身世 '{oid}' 引用的 starter_kit_id '{starter_kit_id}' 不存在于 custom_starter_kits 或内置套件中",
                "请确保 starter_kit_id 引用了合法已声明的套件标识符（如 KIT_HUMAN_DEFAULT）",
            )


def _check_destiny_origins(
    destiny_data: dict[str, Any],
    rel_name: str,
    diags: list[DiagnosticItem],
    valid_dags: set[str],
    valid_kits: set[str],
) -> None:
    """校验 custom_origins 列表中的所有自定义身世。"""
    for idx, origin in enumerate(_normalize_named_items(destiny_data.get("custom_origins"), "origin_id")):
        _check_single_origin_budget(origin, idx, rel_name, diags, valid_dags, valid_kits)


def _extract_trait_cost_map(destiny_data: dict[str, Any], rel_name: str, diags: list[DiagnosticItem]) -> dict[str, int | float]:
    """构建内置与自定义天赋的 cost 映射表，并校验自定义天赋基础极性。"""
    cost_map: dict[str, int | float] = dict(BUILTIN_TRAIT_COSTS)
    for idx, trait in enumerate(_normalize_named_items(destiny_data.get("custom_traits"), "trait_id")):
        tid = str(trait.get("trait_id") or trait.get("id") or f"trait_{idx}")
        cost = trait.get("cost")
        ttype = str(trait.get("type", "")).upper()
        if not _is_valid_number(cost) or cost == 0:
            _add_diag(diags, "ERR_DESTINY_CAUSALITY_IMBALANCE", rel_name, f"自定义天赋 '{tid}' 的 cost ({cost!r}) 必须为非零数值", "正向天赋请设置 cost > 0，负向天赋请设置 cost < 0")
            continue
        if (ttype == "POSITIVE" and cost <= 0) or (ttype == "NEGATIVE" and cost >= 0):
            _add_diag(diags, "ERR_DESTINY_CAUSALITY_IMBALANCE", rel_name, f"自定义天赋 '{tid}' 的极性类型 ({ttype}) 与 cost ({cost}) 符号矛盾", "确保 POSITIVE 天赋 cost > 0 且 NEGATIVE 天赋 cost < 0")
        cost_map[tid] = cost
    return cost_map


def _resolve_endpoint_cost(endpoint: Any, explicit_cost: Any, cost_map: dict[str, int | float]) -> int | float | None:
    """解析配对预设中正/负端点的因果点数。"""
    if _is_valid_number(explicit_cost):
        return explicit_cost
    if isinstance(endpoint, dict):
        c = endpoint.get("cost")
        if _is_valid_number(c):
            return c
        tid = endpoint.get("trait_id") or endpoint.get("id")
        return cost_map.get(tid) if isinstance(tid, str) else None
    return cost_map.get(endpoint) if isinstance(endpoint, str) else None


def _check_destiny_causality_traits(destiny_data: dict[str, Any], rel_name: str, diags: list[DiagnosticItem]) -> None:
    """校验 paired_presets 正负因果天赋配对守恒规则。"""
    cost_map = _extract_trait_cost_map(destiny_data, rel_name, diags)
    custom_traits = _normalize_named_items(destiny_data.get("custom_traits"), "trait_id")
    raw_presets = destiny_data.get("paired_presets")
    presets = [p for p in raw_presets if isinstance(p, dict)] if isinstance(raw_presets, list) else []

    if custom_traits and not presets:
        _add_diag(diags, "ERR_DESTINY_CAUSALITY_IMBALANCE", rel_name, "定义了 custom_traits 但缺少 paired_presets 正负因果天赋配对声明", "请在 paired_presets 中将正向与负向天赋成对绑定，且净 cost 绝对值 <= 1")
        return

    for idx, preset in enumerate(presets):
        pos_ref = preset.get("positive") if "positive" in preset else preset.get("positive_trait")
        neg_ref = preset.get("negative") if "negative" in preset else preset.get("negative_trait")
        pos_cost = _resolve_endpoint_cost(pos_ref, preset.get("positive_cost"), cost_map)
        neg_cost = _resolve_endpoint_cost(neg_ref, preset.get("negative_cost"), cost_map)

        if pos_cost is None or neg_cost is None:
            _add_diag(diags, "ERR_DESTINY_CAUSALITY_IMBALANCE", rel_name, f"paired_presets[{idx}] 引用了未定义或缺少 cost 的天赋: positive={pos_ref!r}, negative={neg_ref!r}", "请确保配对引用的天赋已在 custom_traits 或内置天赋库中声明合法 cost")
            continue

        net_delta = abs(pos_cost + neg_cost)
        if pos_cost <= 0 or neg_cost >= 0 or net_delta > 1:
            _add_diag(diags, "ERR_DESTINY_CAUSALITY_IMBALANCE", rel_name, f"paired_presets[{idx}] 违反因果守恒: positive_cost={pos_cost}, negative_cost={neg_cost}, 净和绝对值={net_delta} (要求 pos>0, neg<0 且 |pos+neg|<=1)", "请调整正负天赋的 cost 配平，确保一正一负且代数和绝对值不超过 1")


def _validate_kit_item_entry(kid: str, item_idx: int, item: Any, rel_name: str, diags: list[DiagnosticItem]) -> int:
    """校验套件内单条初始物品记录，返回合法物品件数。"""
    if not isinstance(item, dict):
        _add_diag(diags, "ERR_DESTINY_KIT_INVALID", rel_name, f"自定义套件 '{kid}' 第 {item_idx} 项物品必须为对象", "每项物品应包含 canonical_id 与 count 字段")
        return 0

    cid = item.get("canonical_id")
    if not isinstance(cid, str) or not cid.strip():
        _add_diag(diags, "ERR_DESTINY_KIT_INVALID", rel_name, f"自定义套件 '{kid}' 第 {item_idx} 项物品的 canonical_id 为空或非法", "请填写非空的权威物品标识符（如 KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD）")

    cnt = item.get("count", 1)
    if isinstance(cnt, bool) or not isinstance(cnt, int) or cnt <= 0:
        _add_diag(diags, "ERR_DESTINY_KIT_INVALID", rel_name, f"自定义套件 '{kid}' 第 {item_idx} 项物品数量 count ({cnt!r}) 必须为正整数", "请将该物品的 count 设置为 >= 1 的正整数")
        return 0
    return cnt


def _check_single_starter_kit(kit: dict[str, Any], idx: int, rel_name: str, diags: list[DiagnosticItem]) -> None:
    """校验单个自定义初始装备套件。"""
    kid = str(kit.get("kit_id") or kit.get("id") or f"kit_{idx}")
    gold = kit.get("initial_gold", 0)
    if not _is_valid_number(gold) or not (0 <= gold <= 1000):
        _add_diag(diags, "ERR_DESTINY_GOLD_CAP_EXCEEDED", rel_name, f"自定义套件 '{kid}' 的 initial_gold ({gold}) 超出 [0, 1000] 上限", "请将套件的 initial_gold 调整至 0 到 1000 范围内")

    items = kit.get("initial_items") if "initial_items" in kit else kit.get("items")
    if not isinstance(items, list) or not items:
        _add_diag(diags, "ERR_DESTINY_KIT_INVALID", rel_name, f"自定义套件 '{kid}' 的 initial_items 必须为非空数组", "请在套件中配置 initial_items 列表并至少包含 1 件合法初始物品")
        return

    total_count = sum(_validate_kit_item_entry(kid, item_idx, item, rel_name, diags) for item_idx, item in enumerate(items))
    if total_count > 10 or len(items) > 10:
        _add_diag(diags, "ERR_DESTINY_KIT_INVALID", rel_name, f"自定义套件 '{kid}' 物品总件数 ({total_count}) 超过上限 10 件", "请精简 custom_starter_kits 中的初始物品数量，使单套总件数 <= 10")


def _check_destiny_starter_kits(destiny_data: dict[str, Any], rel_name: str, diags: list[DiagnosticItem]) -> None:
    """校验 custom_starter_kits 列表中的所有自定义套件。"""
    for idx, kit in enumerate(_normalize_named_items(destiny_data.get("custom_starter_kits"), "kit_id")):
        _check_single_starter_kit(kit, idx, rel_name, diags)


def _check_destiny_custom_routing_rules(
    destiny_data: dict[str, Any],
    rel_name: str,
    valid_dags: set[str],
    diags: list[DiagnosticItem],
) -> None:
    """校验 destinies.json 中的 custom_routing_rules 目标 DAG 是否合法。"""
    raw_rules = destiny_data.get("custom_routing_rules")
    if not raw_rules:
        return
    rules = _extract_rules_list(raw_rules) if not isinstance(raw_rules, list) else [r for r in raw_rules if isinstance(r, dict)]
    for idx, rule in enumerate(rules):
        target = rule.get("target_dag_id")
        if not target or not isinstance(target, str) or target.strip() not in valid_dags:
            _add_diag(
                diags,
                "ERR_DESTINY_UNKNOWN_DAG_REF",
                rel_name,
                f"custom_routing_rules[{idx}] 引用的 target_dag_id '{target}' 不存在于 declared_dag_ids 或内置序章图中",
                "请指定已存在的有效序章 DAG 图元标识符",
            )


def _check_destinies_file(
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
    data = _safe_load_json(destiny_path, rel_name, diags)
    if not isinstance(data, dict):
        if data is not None:
            _add_diag(diags, "ERR_DESTINY_NOT_OBJECT", rel_name, "destinies.json 顶层必须为 JSON 对象", "请将 destinies.json 根节点调整为 JSON 对象 {}")
        return None

    valid_dags = (declared_dag_ids or set()) | BUILTIN_DAG_IDS
    declared_kit_ids: set[str] = set()
    for kit in _normalize_named_items(data.get("custom_starter_kits"), "kit_id"):
        kid = kit.get("kit_id") or kit.get("id")
        if isinstance(kid, str) and kid.strip():
            declared_kit_ids.add(kid.strip())
    valid_kits = declared_kit_ids | BUILTIN_STARTER_KITS

    _check_destiny_ui_capabilities(data, rel_name, diags)
    _check_destiny_origins(data, rel_name, diags, valid_dags, valid_kits)
    _check_destiny_causality_traits(data, rel_name, diags)
    _check_destiny_starter_kits(data, rel_name, diags)
    _check_destiny_custom_routing_rules(data, rel_name, valid_dags, diags)
    return data


def _check_manifest(mod_dir: Path, diags: list[DiagnosticItem]) -> dict[str, Any] | None:
    """校验 pack.json 清单。"""
    manifest_path = mod_dir / "pack.json"
    data = _safe_load_json(manifest_path, "pack.json", diags)
    if not isinstance(data, dict):
        if data is not None:
            diags.append(DiagnosticItem(
                code="ERR_MANIFEST_NOT_OBJECT",
                file_path="pack.json",
                detail="pack.json 顶层必须为 JSON 对象",
                fix_suggestion="请将 pack.json 根节点修改为 JSON 对象格式 {}",
            ))
        return None

    for field in REQUIRED_MANIFEST_FIELDS:
        if field not in data:
            diags.append(DiagnosticItem(
                code="ERR_MANIFEST_FIELD_MISSING",
                file_path="pack.json",
                detail=f"清单缺失必备字段: '{field}'",
                fix_suggestion=f"在 pack.json 中补充 '{field}' 字段声明",
            ))

    if not isinstance(data.get("priority", 0), int):
        diags.append(DiagnosticItem(
            code="ERR_MANIFEST_FIELD_TYPE",
            file_path="pack.json",
            detail="字段 'priority' 必须为整数",
            fix_suggestion="将 'priority' 字段修改为正整数（如 100）",
        ))

    return data


def _extract_rules_list(rules_data: Any) -> list[dict[str, Any]]:
    """提取路由规则列表。"""
    if isinstance(rules_data, list):
        return [r for r in rules_data if isinstance(r, dict)]
    if isinstance(rules_data, dict):
        for key in ("routing_rules", "rules", "prologue_routing_rules"):
            val = rules_data.get(key)
            if isinstance(val, list):
                return [r for r in val if isinstance(r, dict)]
    return []


def _check_routing_rules(mod_dir: Path, declared_dag_ids: set[str], diags: list[DiagnosticItem]) -> None:
    """校验 routing_rules.json。"""
    routing_path = mod_dir / "routing_rules.json"
    data = _safe_load_json(routing_path, "routing_rules.json", diags)
    if data is None:
        return

    rules = _extract_rules_list(data)
    if not rules:
        diags.append(DiagnosticItem(
            code="ERR_ROUTING_EMPTY",
            file_path="routing_rules.json",
            detail="routing_rules.json 中未解析到有效的路由规则列表",
            fix_suggestion="请在 routing_rules.json 中提供 'routing_rules' 数组并配置匹配规则",
        ))
        return

    valid_dags = declared_dag_ids | BUILTIN_DAG_IDS
    for idx, rule in enumerate(rules):
        target = rule.get("target_dag_id")
        if not target or not isinstance(target, str):
            diags.append(DiagnosticItem(
                code="ERR_ROUTING_TARGET_MISSING",
                file_path="routing_rules.json",
                detail=f"第 {idx} 条路由规则缺少 'target_dag_id'",
                fix_suggestion="为该规则指定目标 DAG 图标识符 target_dag_id",
            ))
            continue

        if valid_dags and target not in valid_dags:
            diags.append(DiagnosticItem(
                code="ERR_ROUTING_TARGET_UNKNOWN",
                file_path="routing_rules.json",
                detail=f"第 {idx} 条规则引用的 target_dag_id '{target}' 在 dag_graphs/ 或内置图中未找到",
                fix_suggestion=f"请确保 dag_graphs/{target}.json 存在或修改目标 ID",
            ))


# ==============================================================================
# 四、DAG 拓扑连通性、Kahn 环检测与多包冲突裁决契约 (DAG & Multi-Pack Contracts)
# - Inv-DAG-TOPOLOGY: 单一 START_ENTRY，至少一个 TERMINAL_EXIT，Kahn 算法零有向环
# - Inv-DAG-REACHABILITY: 前向全节点可达（零孤儿），反向全路径可达终态（零死胡同）
# - Inv-MULTI-CONFLICT: 跨包互斥、同名 origin_id/trait_id/kit_id 与 UI 策略互斥静态阻断
# ==============================================================================
from check_mod_dag import (
    check_dag_entries_and_terminals as _check_dag_entries_and_terminals,
    build_dag_graph_structure as _build_dag_graph_structure,
    detect_dag_cycle_kahn as _detect_dag_cycle_kahn,
    check_reachability as _check_reachability,
    flatten_i18n_dict as _flatten_i18n_dict,
    check_dag_file as _check_dag_file,
)


def _check_i18n(mod_dir: Path, required_keys: set[str], diags: list[DiagnosticItem]) -> None:
    """校验 i18n 语言包与占位符白名单（当所有节点采用 inline_text 且 i18n 不存在时免校验放行）。"""
    i18n_dir = mod_dir / "i18n"
    if not i18n_dir.is_dir():
        if not required_keys:
            return
        diags.append(DiagnosticItem(
            code="ERR_I18N_DIR_MISSING",
            file_path="i18n",
            detail="缺少 i18n 本地化目录",
            fix_suggestion="创建 i18n 目录并在其中放置 zh-CN.json",
        ))
        return

    i18n_files = sorted(i18n_dir.glob("*.json"))
    if not i18n_files:
        if not required_keys:
            return
        diags.append(DiagnosticItem(
            code="ERR_I18N_EMPTY",
            file_path="i18n",
            detail="i18n 目录下未找到任何语言 JSON 文件",
            fix_suggestion="在 i18n 目录创建 zh-CN.json 提供多语言文案字典",
        ))
        return

    for ifile in i18n_files:
        rel_path = f"i18n/{ifile.name}"
        raw_data = _safe_load_json(ifile, rel_path, diags)
        if not isinstance(raw_data, dict):
            continue

        data = _flatten_i18n_dict(raw_data)

        # 1. 检查 DAG 引用的叙事键在语言包中是否存在
        for rkey in sorted(required_keys):
            if rkey not in data:
                diags.append(DiagnosticItem(
                    code="ERR_I18N_MISSING_KEY",
                    file_path=rel_path,
                    detail=f"语言包缺少 DAG 所需的文案键: '{rkey}'",
                    fix_suggestion=f"在 {rel_path} 中添加键 '{rkey}' 的本地化翻译文本",
                ))

        # 2. 占位符白名单校验
        for k, text in data.items():
            if not isinstance(text, str):
                continue
            matches = PARAM_REGEX.findall(text)
            for param in matches:
                if param not in WHITELISTED_PLACEHOLDERS:
                    diags.append(DiagnosticItem(
                        code="ERR_UNKNOWN_PLACEHOLDER",
                        file_path=rel_path,
                        detail=f"键 '{k}' 包含非法/未知占位符 '{{{param}}}'",
                        fix_suggestion=f"请替换为白名单参数，如: {', '.join(sorted(list(WHITELISTED_PLACEHOLDERS)[:6]))}",
                    ))


def _check_asset_safety_and_manifest(mod_dir: Path, diags: list[DiagnosticItem]) -> None:
    """若存在 assets/ 目录，校验其资源格式白名单、体积预算及 manifest.json。"""
    assets_dir = mod_dir / "assets"
    if not assets_dir.is_dir():
        return
    if cook_assets is not None:
        valid_assets, asset_diags, _ = cook_assets(mod_dir, check_only=True)
        for d in asset_diags:
            diags.append(DiagnosticItem(d.code, d.file, d.detail, d.fix_suggestion))


def _collect_mod_uri_strings(obj: Any) -> list[str]:
    """递归收集数据对象中所有以 'mod://' 开头的资产 URI 字符串。"""
    found: list[str] = []
    if isinstance(obj, str):
        if obj.startswith("mod://"):
            found.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            found.extend(_collect_mod_uri_strings(v))
    elif isinstance(obj, list):
        for item in obj:
            found.extend(_collect_mod_uri_strings(item))
    return found


def _resolve_mod_uri_path(mod_dir: Path, uri: str) -> bool:
    """判断 mod:// 资产 URI 是否在模组内物理存在。"""
    clean_target = uri[6:].strip("/")
    if not clean_target:
        return False
    if (mod_dir / clean_target).is_file():
        return True
    if (mod_dir / "assets" / clean_target).is_file():
        return True
    return False


def _check_dangling_asset_refs(mod_dir: Path, diags: list[DiagnosticItem]) -> None:
    """校验 destinies.json 与因果 DAG 图元中引用的 mod:// 资产是否存在于 assets/。"""
    destiny_path = mod_dir / "destinies.json"
    if destiny_path.is_file():
        try:
            d_data = json.loads(destiny_path.read_text(encoding="utf-8"))
            for uri in _collect_mod_uri_strings(d_data):
                if not _resolve_mod_uri_path(mod_dir, uri):
                    diags.append(DiagnosticItem(
                        code="ERR_ASSET_DANGLING_REF",
                        file_path="destinies.json",
                        detail=f"destinies.json 引用了不存在的资产: '{uri}'",
                        fix_suggestion=f"请确保资产文件已放置于 assets/ 对应路径，并运行 'kalar-mod cook' 生成清单",
                    ))
        except (json.JSONDecodeError, OSError):
            pass

    dag_dir = mod_dir / "dag_graphs"
    if dag_dir.is_dir():
        for df in sorted(dag_dir.glob("*.json")):
            try:
                g_data = json.loads(df.read_text(encoding="utf-8"))
                rel_file = f"dag_graphs/{df.name}"
                for uri in _collect_mod_uri_strings(g_data):
                    if not _resolve_mod_uri_path(mod_dir, uri):
                        diags.append(DiagnosticItem(
                            code="ERR_ASSET_DANGLING_REF",
                            file_path=rel_file,
                            detail=f"{rel_file} 节点中引用了不存在的资产: '{uri}'",
                            fix_suggestion=f"请确保资产文件已放置于 assets/ 对应路径，或修正节点中的资源 URI",
                        ))
            except (json.JSONDecodeError, OSError):
                pass


def _check_content_directory(mod_dir: Path, diags: list[DiagnosticItem]) -> None:
    """校验 content/ 大魔改数据目录及其 JSON 实体定义的合法性。"""
    content_dir = mod_dir / "content"
    if not content_dir.is_dir():
        return

    content_files = sorted([p for p in content_dir.rglob("*") if p.is_file()])
    if not content_files:
        diags.append(DiagnosticItem(
            code="ERR_CONTENT_EMPTY",
            file_path="content",
            detail="content/ 目录已创建但未包含任何数据文件",
            fix_suggestion="请在 content/ 目录下放置合规的 JSON 数据定义文件，或移除空的 content/ 目录",
        ))
        return

    forbidden_exts = frozenset({".exe", ".bat", ".cmd", ".sh", ".py", ".pyc", ".dll", ".so", ".bin", ".ps1"})
    for cf in content_files:
        rel_str = f"content/{cf.relative_to(content_dir).as_posix()}"
        ext = cf.suffix.lower()
        if ext in forbidden_exts:
            diags.append(DiagnosticItem(
                code="ERR_CONTENT_FORBIDDEN_FILE",
                file_path=rel_str,
                detail=f"content/ 目录严禁包含可执行或脚本文件: '{cf.name}'",
                fix_suggestion="请将该文件移出 content/ 目录",
            ))
            continue
        if ext not in (".json", ".json5"):
            diags.append(DiagnosticItem(
                code="ERR_CONTENT_INVALID_FORMAT",
                file_path=rel_str,
                detail=f"content/ 文件格式非法: '{cf.name}' (仅支持 .json)",
                fix_suggestion="请将大魔改数据存储为合规的 .json 格式",
            ))
            continue
        try:
            cdata = json.loads(cf.read_text(encoding="utf-8"))
            if not isinstance(cdata, (dict, list)):
                diags.append(DiagnosticItem(
                    code="ERR_CONTENT_NOT_OBJECT_OR_ARRAY",
                    file_path=rel_str,
                    detail=f"{rel_str} 顶层必须为 JSON 对象或列表",
                    fix_suggestion="请将该文件的根结构调整为 {} 或 []",
                ))
        except (json.JSONDecodeError, OSError) as err:
            diags.append(DiagnosticItem(
                code="ERR_CONTENT_JSON_INVALID",
                file_path=rel_str,
                detail=f"JSON 解析失败: {err}",
                fix_suggestion=f"请检查 {rel_str} 的语法正确性",
            ))


def validate_mod(mod_dir: Path) -> tuple[bool, list[DiagnosticItem]]:
    """核心单包诊断校验流水线。"""
    diags: list[DiagnosticItem] = []
    if not mod_dir.is_dir():
        diags.append(DiagnosticItem(
            code="ERR_MOD_DIR_NOT_FOUND",
            file_path=str(mod_dir),
            detail=f"MOD 目标目录不存在: {mod_dir}",
            fix_suggestion="请确认命令行指定的 MOD 根目录路径存在",
        ))
        return False, diags

    _check_manifest(mod_dir, diags)

    dag_dir = mod_dir / "dag_graphs"
    declared_dag_ids: set[str] = set()
    required_keys: set[str] = set()

    if not dag_dir.is_dir():
        diags.append(DiagnosticItem(
            code="ERR_DAG_DIR_MISSING",
            file_path="dag_graphs",
            detail="缺少 dag_graphs 目录",
            fix_suggestion="创建 dag_graphs 目录并在其中放置因果 DAG 图元 JSON",
        ))
    else:
        dag_files = sorted(dag_dir.glob("*.json"))
        if not dag_files:
            diags.append(DiagnosticItem(
                code="ERR_DAG_NO_FILES",
                file_path="dag_graphs",
                detail="dag_graphs 目录下未找到任何因果图元 JSON 文件",
                fix_suggestion="在 dag_graphs 下至少创建一个 DAG_<ID>.json 图元文件",
            ))
        for df in dag_files:
            dag_stem = df.stem
            declared_dag_ids.add(dag_stem)
            _check_dag_file(df, f"dag_graphs/{df.name}", required_keys, declared_dag_ids, diags)

    _check_routing_rules(mod_dir, declared_dag_ids, diags)
    _check_i18n(mod_dir, required_keys, diags)
    _check_destinies_file(mod_dir, diags, declared_dag_ids=declared_dag_ids)
    _check_asset_safety_and_manifest(mod_dir, diags)
    _check_dangling_asset_refs(mod_dir, diags)
    _check_content_directory(mod_dir, diags)

    valid = len(diags) == 0
    return valid, diags


from check_mod_multi import (
    check_multi_incompatible_packs as _check_multi_incompatible_packs,
    register_entity_ids as _register_entity_ids,
    check_multi_duplicate_ids as _check_multi_duplicate_ids,
    check_multi_ui_policy_conflicts as _check_multi_ui_policy_conflicts,
    validate_multi_mods,
)



def print_cli_report(valid: bool, diags: list[DiagnosticItem], mod_dir: Path) -> None:
    """输出人类可读的控制台审查报告。"""
    print("==============================================================================")
    print(f"🔍 卡拉尔 MOD 静态诊断报告: {mod_dir.resolve().name}")
    print("------------------------------------------------------------------------------")
    if valid:
        print("  🎉 诊断结论: 100% 合规通过！")
        print("  • 清单格式   : 合规")
        print("  • DAG 拓扑   : 连通性良好，无环，无孤儿，单入口全路径可达")
        print("  • 命途契约   : 六维预算、正负因果守恒与初始套件全部合规")
        print("  • 占位符白名单: 100% 遵从")
        print("  • 资产与引用 : 格式白名单、体积预算与 mod:// 引用全部合规")
        print("  • 魔改数据体 : content/ 大魔改数据结构合法")
        print("==============================================================================")
        return

    print(f"  ❌ 发现 {len(diags)} 处违规或拓扑缺陷:\n")
    for idx, d in enumerate(diags, start=1):
        print(f"  [{idx}] [{d.code}] 文件: {d.file}")
        print(f"      • 详情: {d.detail}")
        print(f"      • 建议: {d.fix_suggestion}\n")
    print("==============================================================================")


def _collect_target_dirs(mod_dir_arg: str | None, multi_dirs_arg: list[str] | None) -> list[Path]:
    """汇总并去重命令行传入的待检 MOD 目录列表。"""
    targets: list[Path] = []
    seen_resolved: set[Path] = set()
    raw_list: list[str] = []
    if mod_dir_arg:
        raw_list.append(mod_dir_arg)
    if multi_dirs_arg:
        raw_list.extend(multi_dirs_arg)

    for raw in raw_list:
        p = Path(raw)
        resolved = p.resolve()
        if resolved not in seen_resolved:
            seen_resolved.add(resolved)
            targets.append(p)
    return targets


def main() -> None:
    """命令行入口。"""
    _ensure_utf8_stdout()
    parser = argparse.ArgumentParser(
        description="卡拉尔 MOD 纯静态自愈诊断器 (Static Mod Checker)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("mod_dir", nargs="?", help="待诊断的 MOD 根目录路径")
    parser.add_argument(
        "--check-multi",
        nargs="+",
        dest="multi_dirs",
        default=None,
        help="多包联合冲突预检的附加或完整 MOD 目录列表",
    )
    parser.add_argument("--json", action="store_true", dest="as_json", help="输出机器可读的结构化 JSON 诊断信息")

    args = parser.parse_args()
    target_dirs = _collect_target_dirs(args.mod_dir, args.multi_dirs)
    if not target_dirs:
        parser.error("请提供至少一个 mod_dir 或通过 --check-multi 指定待检目录列表")

    if args.multi_dirs is not None or len(target_dirs) > 1:
        valid, diags = validate_multi_mods(target_dirs)
        report_target = target_dirs[0]
    else:
        report_target = target_dirs[0]
        valid, diags = validate_mod(report_target)

    if args.as_json:
        payload = {
            "valid": valid,
            "checked_packs": [d.name for d in target_dirs],
            "error_count": len(diags),
            "diagnostics": [d.to_dict() for d in diags],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_cli_report(valid, diags, report_target)

    sys.exit(0 if valid else 1)


if __name__ == "__main__":
    main()
