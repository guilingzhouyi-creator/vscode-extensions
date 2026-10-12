#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Tools)
# 文件路径: WebGames/mod_sdk/tools/check_mod.py
# 架构定位: MOD纯静态轻量自愈诊断器 (Pure Static Mod Validator & Diagnostic Tool)
# 依赖与触发: 触发方: CLI / 外部 Agent | 上游: MOD 目录与文件 | 下游: 控制台输出与结构化 JSON 自愈指引 | 运行时: Python 3.10+
# 职责说明: 纯静态校验 MOD 清单格式、因果 DAG 拓扑连通性与文案占位符白名单，输出自愈诊断
# 退出语义与设计依据: 退出码: 0=合规通过, 1=发现违规错误, 2=参数/IO错误 | 设计依据: Phase 114 DevKit 契约与第一性原理
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

# ==============================================================================
# 一、全局白名单常量与命途数值边界不变量契约 (Constants & Budget Invariants)
# - Inv-PLACEHOLDER: 剧情文本仅允许使用预声明的 18 项上下文占位符
# - Inv-STAT-BUDGET: 自定义身世单维修正 [-2, +3]，六维净代数和 [-2, +4]，金币 [0, 1000]
# - Inv-CAUSALITY-BALANCE: 正负因果天赋必须配对出现，且 |pos_cost + neg_cost| <= 1
# - Inv-KIT-CAPACITY: 自定义初始行囊单套物品总件数 <= 10 且 canonical_id 非空
# ==============================================================================
WHITELISTED_PLACEHOLDERS: frozenset[str] = frozenset({
    "player_name", "race", "gender", "level", "world_id", "town",
    "gold", "cur", "max", "name", "status", "desc",
    "beast_count", "reward_gold", "loss_soldiers", "loss_gold", "gain_gold",
})
PARAM_REGEX: re.Pattern[str] = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")
REQUIRED_MANIFEST_FIELDS: tuple[str, ...] = (
    "pack_id", "pack_name", "version", "author", "engine_api_version",
    "priority", "dependencies", "incompatible_packs", "semantic_tags", "is_active",
)
VALID_ATTRIBUTE_KEYS: frozenset[str] = frozenset({"STR", "CON", "INT", "AGI", "SPR", "VIT"})
VALID_UI_SELECTION_MODES: frozenset[str] = frozenset({"INHERIT", "ALLOW_MANUAL", "FORCE_RANDOM"})
BUILTIN_TRAIT_COSTS: dict[str, int] = {
    "PRIMORDIAL_RESONANCE": 3, "GIANT_MIGHT": 2, "IRON_WILL": 1,
    "HEART_CORE_FISSURE": -3, "MANA_INSULATED": -2,
}


def _ensure_utf8_stdout() -> None:
    """保障跨平台 UTF-8 控制台输出，防止 Windows GBK 编码崩溃。"""
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


# ==============================================================================
# 二、结构化诊断模型与 JSON 安全读取底座 (Diagnostic Model & Safe I/O)
# ==============================================================================
class DiagnosticItem:
    """结构化诊断发现项：包含错误码、文件路径、违规详情与面向 Agent 的自愈修复建议。"""

    def __init__(self, code: str, file_path: str, detail: str, fix_suggestion: str) -> None:
        self.code = code
        self.file = file_path
        self.detail = detail
        self.fix_suggestion = fix_suggestion

    def to_dict(self) -> dict[str, str]:
        return {"code": self.code, "file": self.file, "detail": self.detail, "fix_suggestion": self.fix_suggestion}


def _add_diag(diags: list[DiagnosticItem], code: str, file_path: str, detail: str, fix_suggestion: str) -> None:
    """向诊断列表追加一条结构化违规记录。"""
    diags.append(DiagnosticItem(code=code, file_path=file_path, detail=detail, fix_suggestion=fix_suggestion))


def _safe_load_json(file_path: Path, rel_name: str, diags: list[DiagnosticItem]) -> Any:
    """安全读取并解析 JSON 文件，文件缺失或语法损坏时登记自愈诊断。"""
    if not file_path.is_file():
        _add_diag(diags, "ERR_FILE_MISSING", rel_name, f"必备文件不存在: {rel_name}", f"请通过 scaffold_mod.py 或手动创建 {rel_name}")
        return None
    try:
        return json.loads(file_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as err:
        _add_diag(diags, "ERR_JSON_INVALID", rel_name, f"JSON 解析失败: {err}", f"请检查 {rel_name} 的 JSON 语法正确性与逗号/引号匹配")
        return None


def _normalize_named_items(raw_collection: Any, id_field: str) -> list[dict[str, Any]]:
    """将列表式或字典式条目集合归一化为对象列表。"""
    if isinstance(raw_collection, list):
        return [item for item in raw_collection if isinstance(item, dict)]
    if isinstance(raw_collection, dict):
        normalized: list[dict[str, Any]] = []
        for k, v in raw_collection.items():
            if isinstance(v, dict):
                entry = dict(v)
                entry.setdefault(id_field, k)
                normalized.append(entry)
        return normalized
    return []


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


def _check_single_origin_budget(origin: dict[str, Any], idx: int, rel_name: str, diags: list[DiagnosticItem]) -> None:
    """校验单个自定义身世的六维加成预算与初始金币上限。"""
    oid = str(origin.get("origin_id") or origin.get("id") or f"index_{idx}")
    gold = origin.get("initial_gold", 0)
    if not _is_valid_number(gold) or not (0 <= gold <= 1000):
        _add_diag(diags, "ERR_DESTINY_GOLD_CAP_EXCEEDED", rel_name, f"自定义身世 '{oid}' 初始金币 {gold} 超出合法区间 [0, 1000]", "请将 custom_origins 中的 initial_gold 调整至 0 到 1000 之间")

    bonuses = origin.get("attribute_bonus", {})
    if not isinstance(bonuses, dict):
        _add_diag(diags, "ERR_DESTINY_STAT_BUDGET_EXCEEDED", rel_name, f"自定义身世 '{oid}' 的 attribute_bonus 必须为对象", "请将 attribute_bonus 声明为六维属性键值对字典")
        return

    _check_origin_stat_bonuses(oid, bonuses, rel_name, diags)


def _check_destiny_origins(destiny_data: dict[str, Any], rel_name: str, diags: list[DiagnosticItem]) -> None:
    """校验 custom_origins 列表中的所有自定义身世。"""
    for idx, origin in enumerate(_normalize_named_items(destiny_data.get("custom_origins"), "origin_id")):
        _check_single_origin_budget(origin, idx, rel_name, diags)


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


def _check_destinies_file(mod_dir: Path, diags: list[DiagnosticItem], rel_prefix: str = "") -> dict[str, Any] | None:
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

    _check_destiny_ui_capabilities(data, rel_name, diags)
    _check_destiny_origins(data, rel_name, diags)
    _check_destiny_causality_traits(data, rel_name, diags)
    _check_destiny_starter_kits(data, rel_name, diags)
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

        if declared_dag_ids and target not in declared_dag_ids:
            diags.append(DiagnosticItem(
                code="ERR_ROUTING_TARGET_UNKNOWN",
                file_path="routing_rules.json",
                detail=f"第 {idx} 条规则引用的 target_dag_id '{target}' 在 dag_graphs/ 中未找到",
                fix_suggestion=f"请确保 dag_graphs/{target}.json 存在或修改目标 ID",
            ))


# ==============================================================================
# 四、DAG 拓扑连通性、Kahn 环检测与多包冲突裁决契约 (DAG & Multi-Pack Contracts)
# - Inv-DAG-TOPOLOGY: 单一 START_ENTRY，至少一个 TERMINAL_EXIT，Kahn 算法零有向环
# - Inv-DAG-REACHABILITY: 前向全节点可达（零孤儿），反向全路径可达终态（零死胡同）
# - Inv-MULTI-CONFLICT: 跨包互斥、同名 origin_id/trait_id/kit_id 与 UI 策略互斥静态阻断
# ==============================================================================
def _check_dag_entries_and_terminals(nodes: dict[str, Any], rel_name: str, diags: list[DiagnosticItem]) -> tuple[str | None, list[str]]:
    """校验 DAG 入口与终态节点基数。"""
    entry_nodes: list[str] = []
    terminal_nodes: list[str] = []

    for nid, node_data in nodes.items():
        if not isinstance(node_data, dict):
            continue
        ntype = str(node_data.get("node_type", ""))
        if ntype == "START_ENTRY":
            entry_nodes.append(nid)
        elif ntype == "TERMINAL_EXIT":
            terminal_nodes.append(nid)

    if len(entry_nodes) != 1:
        diags.append(DiagnosticItem(
            code="ERR_DAG_ENTRY_COUNT",
            file_path=rel_name,
            detail=f"DAG 必须有且仅有一个 START_ENTRY 节点，实际找到: {len(entry_nodes)} 个 ({entry_nodes})",
            fix_suggestion="请调整节点定义，保留且仅保留一个 node_type 为 'START_ENTRY' 的入口节点",
        ))

    if not terminal_nodes:
        diags.append(DiagnosticItem(
            code="ERR_DAG_TERMINAL_COUNT",
            file_path=rel_name,
            detail="DAG 至少需要一个 TERMINAL_EXIT 终态退出节点",
            fix_suggestion="在 nodes 中添加一个 node_type 为 'TERMINAL_EXIT' 的完成节点",
        ))

    entry_id = entry_nodes[0] if len(entry_nodes) == 1 else None
    return entry_id, terminal_nodes


def _build_dag_graph_structure(nodes: dict[str, Any], edges: list[Any], rel_name: str, diags: list[DiagnosticItem]) -> tuple[dict[str, list[str]], dict[str, list[str]], dict[str, int]]:
    """构建邻接表、反向邻接表与入度表，并拦截悬挂边与前置缺失。"""
    adj: dict[str, list[str]] = {nid: [] for nid in nodes}
    rev_adj: dict[str, list[str]] = {nid: [] for nid in nodes}
    in_degree: dict[str, int] = {nid: 0 for nid in nodes}

    for edge in edges:
        if not isinstance(edge, dict):
            continue
        u = edge.get("from") or edge.get("from_node_id")
        v = edge.get("to") or edge.get("to_node_id")
        if u not in nodes or v not in nodes:
            diags.append(DiagnosticItem(
                code="ERR_DAG_DANGLING_EDGE",
                file_path=rel_name,
                detail=f"边连接了不存在的节点: '{u}' -> '{v}'",
                fix_suggestion="检查边的两端节点 ID 是否均已在 nodes 字典中正确声明",
            ))
            continue

        adj[u].append(v)
        rev_adj[v].append(u)
        in_degree[v] += 1

    for nid, node_data in nodes.items():
        if not isinstance(node_data, dict):
            continue
        prereqs = node_data.get("required_prerequisites", [])
        if isinstance(prereqs, list):
            for pre in prereqs:
                if pre not in nodes:
                    diags.append(DiagnosticItem(
                        code="ERR_DAG_MISSING_PREREQUISITE",
                        file_path=rel_name,
                        detail=f"节点 '{nid}' 的前置依赖 '{pre}' 不存在",
                        fix_suggestion=f"在 nodes 中补充声明 '{pre}' 或从 '{nid}' 的 required_prerequisites 中移除",
                    ))

    return adj, rev_adj, in_degree


def _detect_dag_cycle_kahn(nodes: dict[str, Any], adj: dict[str, list[str]], in_degree: dict[str, int], rel_name: str, diags: list[DiagnosticItem]) -> None:
    """使用 Kahn 拓扑排序算法检测死锁有向环。"""
    deg_copy = dict(in_degree)
    zero_queue = [nid for nid, d in deg_copy.items() if d == 0]
    visited_count = 0

    while zero_queue:
        curr = zero_queue.pop(0)
        visited_count += 1
        for nbr in adj.get(curr, []):
            deg_copy[nbr] -= 1
            if deg_copy[nbr] == 0:
                zero_queue.append(nbr)

    if visited_count < len(nodes):
        cyclic_nodes = [nid for nid, d in deg_copy.items() if d > 0]
        diags.append(DiagnosticItem(
            code="ERR_DAG_CYCLE",
            file_path=rel_name,
            detail=f"DAG 存在死锁循环依赖环 (Cycle)！涉及节点: {cyclic_nodes}",
            fix_suggestion="断开循环环路中的边（移除导致依赖闭环的边，使拓扑保持严格单向）",
        ))


def _check_reachability(nodes: dict[str, Any], entry_id: str | None, terminals: list[str], adj: dict[str, list[str]], rev_adj: dict[str, list[str]], rel_name: str, diags: list[DiagnosticItem]) -> None:
    """检查连通性与可达性：所有节点自入口可达，且所有路径均可到达终点。"""
    if not entry_id:
        return

    # 1. 前向可达性 (从入口出发)
    fwd_reachable: set[str] = set()
    frontier = [entry_id]
    while frontier:
        cur = frontier.pop(0)
        if cur in fwd_reachable:
            continue
        fwd_reachable.add(cur)
        for nxt in adj.get(cur, []):
            if nxt not in fwd_reachable:
                frontier.append(nxt)

    unreachable_nodes = set(nodes.keys()) - fwd_reachable
    if unreachable_nodes:
        diags.append(DiagnosticItem(
            code="ERR_DAG_ORPHAN_NODE",
            file_path=rel_name,
            detail=f"存在无法从入口 '{entry_id}' 到达的孤儿断链节点: {sorted(unreachable_nodes)}",
            fix_suggestion="请为孤儿节点添加来自上游节点的边，或者从图元中移除未引用的节点",
        ))

    # 2. 反向可达性 (能到达任意终态节点)
    if not terminals:
        return

    bwd_reachable: set[str] = set()
    bwd_frontier = list(terminals)
    while bwd_frontier:
        cur = bwd_frontier.pop(0)
        if cur in bwd_reachable:
            continue
        bwd_reachable.add(cur)
        for prev in rev_adj.get(cur, []):
            if prev not in bwd_reachable:
                bwd_frontier.append(prev)

    dead_end_nodes = fwd_reachable - bwd_reachable
    if dead_end_nodes:
        diags.append(DiagnosticItem(
            code="ERR_DAG_UNREACHABLE_TERMINAL",
            file_path=rel_name,
            detail=f"存在无法沿路径到达任何 TERMINAL_EXIT 的死胡同节点: {sorted(dead_end_nodes)}",
            fix_suggestion="请为这些节点添加指向终态节点的出边，确保所有分支都能顺利完结",
        ))


def _check_dag_file(dag_path: Path, rel_name: str, required_keys: set[str], diags: list[DiagnosticItem]) -> None:
    """校验单份 DAG 图元文件。"""
    data = _safe_load_json(dag_path, rel_name, diags)
    if not isinstance(data, dict):
        return

    nodes = data.get("nodes")
    edges = data.get("edges")
    if not isinstance(nodes, dict) or not nodes:
        diags.append(DiagnosticItem(
            code="ERR_DAG_NO_NODES",
            file_path=rel_name,
            detail="DAG 图元 nodes 字段必须为非空字典",
            fix_suggestion="在 DAG JSON 中声明 'nodes' 对象，并至少包含起始与终态节点",
        ))
        return

    if not isinstance(edges, list):
        edges = []

    # 收集待本地化的叙事键
    for nid, node_data in nodes.items():
        if isinstance(node_data, dict):
            nkey = node_data.get("narrative_key")
            if nkey and isinstance(nkey, str):
                required_keys.add(nkey)

    entry_id, terminals = _check_dag_entries_and_terminals(nodes, rel_name, diags)
    adj, rev_adj, in_deg = _build_dag_graph_structure(nodes, edges, rel_name, diags)
    _detect_dag_cycle_kahn(nodes, adj, in_deg, rel_name, diags)
    _check_reachability(nodes, entry_id, terminals, adj, rev_adj, rel_name, diags)


def _check_i18n(mod_dir: Path, required_keys: set[str], diags: list[DiagnosticItem]) -> None:
    """校验 i18n 语言包与占位符白名单。"""
    i18n_dir = mod_dir / "i18n"
    if not i18n_dir.is_dir():
        diags.append(DiagnosticItem(
            code="ERR_I18N_DIR_MISSING",
            file_path="i18n",
            detail="缺少 i18n 本地化目录",
            fix_suggestion="创建 i18n 目录并在其中放置 zh-CN.json",
        ))
        return

    i18n_files = sorted(i18n_dir.glob("*.json"))
    if not i18n_files:
        diags.append(DiagnosticItem(
            code="ERR_I18N_EMPTY",
            file_path="i18n",
            detail="i18n 目录下未找到任何语言 JSON 文件",
            fix_suggestion="在 i18n 目录创建 zh-CN.json 提供多语言文案字典",
        ))
        return

    for ifile in i18n_files:
        rel_path = f"i18n/{ifile.name}"
        data = _safe_load_json(ifile, rel_path, diags)
        if not isinstance(data, dict):
            continue

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
            _check_dag_file(df, f"dag_graphs/{df.name}", required_keys, diags)

    _check_routing_rules(mod_dir, declared_dag_ids, diags)
    _check_i18n(mod_dir, required_keys, diags)
    _check_destinies_file(mod_dir, diags)

    valid = len(diags) == 0
    return valid, diags


def _check_multi_incompatible_packs(
    pack_records: list[dict[str, Any]],
    diags: list[DiagnosticItem],
) -> None:
    """检测多包联合启用时的 incompatible_packs 互斥冲突。"""
    active_ids: dict[str, str] = {}
    for rec in pack_records:
        pid = rec["pack_id"]
        dir_name = rec["dir_name"]
        if pid in active_ids:
            diags.append(DiagnosticItem(
                code="ERR_MOD_DUPLICATE_ID_CONFLICT",
                file_path=f"{dir_name}/pack.json",
                detail=f"多包联合加载存在重复的 pack_id '{pid}' ({active_ids[pid]} vs {dir_name})",
                fix_suggestion="请确保每个启用 MOD 的 pack.json 具有全局唯一的 pack_id",
            ))
        else:
            active_ids[pid] = dir_name

    seen_pairs: set[tuple[str, str]] = set()
    for rec in pack_records:
        pid = rec["pack_id"]
        dir_name = rec["dir_name"]
        incompat_list = rec["manifest"].get("incompatible_packs", [])
        if not isinstance(incompat_list, list):
            continue
        for target_id in incompat_list:
            if not isinstance(target_id, str) or target_id not in active_ids:
                continue
            pair_key = (min(pid, target_id), max(pid, target_id))
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)
            diags.append(DiagnosticItem(
                code="ERR_MOD_INCOMPATIBLE_CONFLICT",
                file_path=f"{dir_name}/pack.json",
                detail=f"MOD '{pid}' 与已启用的 MOD '{target_id}' 存在 incompatible_packs 互斥冲突",
                fix_suggestion=f"请禁用互斥包 '{pid}' 或 '{target_id}' 之一，或解除 incompatible_packs 声明",
            ))


def _register_entity_ids(
    items: list[dict[str, Any]],
    id_field: str,
    category_label: str,
    pack_id: str,
    rel_file: str,
    seen_registry: dict[str, tuple[str, str]],
    diags: list[DiagnosticItem],
) -> None:
    """登记自定义实体 ID 并拦截跨包同名撞车。"""
    for item in items:
        entity_id = item.get(id_field) or item.get("id")
        if not isinstance(entity_id, str) or not entity_id.strip():
            continue
        if entity_id in seen_registry:
            prev_pack, prev_file = seen_registry[entity_id]
            diags.append(DiagnosticItem(
                code="ERR_MOD_DUPLICATE_ID_CONFLICT",
                file_path=rel_file,
                detail=(
                    f"跨包同名 {category_label} ID 撞车: '{entity_id}' 同时存在于 "
                    f"MOD '{prev_pack}' ({prev_file}) 与 MOD '{pack_id}' ({rel_file})"
                ),
                fix_suggestion=f"请为 '{entity_id}' 添加模组专属前缀（如 {pack_id.upper()}_{entity_id}）以消除命名冲突",
            ))
        else:
            seen_registry[entity_id] = (pack_id, rel_file)


def _check_multi_duplicate_ids(
    pack_records: list[dict[str, Any]],
    diags: list[DiagnosticItem],
) -> None:
    """检测多包联合启用时的同名 origin_id / trait_id / kit_id 撞车。"""
    seen_origins: dict[str, tuple[str, str]] = {}
    seen_traits: dict[str, tuple[str, str]] = {}
    seen_kits: dict[str, tuple[str, str]] = {}

    for rec in pack_records:
        destiny = rec.get("destiny")
        if not isinstance(destiny, dict):
            continue
        pid = rec["pack_id"]
        rel_file = f"{rec['dir_name']}/destinies.json"

        origins = _normalize_named_items(destiny.get("custom_origins"), "origin_id")
        _register_entity_ids(origins, "origin_id", "origin_id", pid, rel_file, seen_origins, diags)

        traits = _normalize_named_items(destiny.get("custom_traits"), "trait_id")
        _register_entity_ids(traits, "trait_id", "trait_id", pid, rel_file, seen_traits, diags)

        kits = _normalize_named_items(destiny.get("custom_starter_kits"), "kit_id")
        _register_entity_ids(kits, "kit_id", "kit_id", pid, rel_file, seen_kits, diags)


def _check_multi_ui_policy_conflicts(
    pack_records: list[dict[str, Any]],
    diags: list[DiagnosticItem],
) -> None:
    """检测多包联合启用时 ui_capabilities 的 ALLOW_MANUAL vs FORCE_RANDOM 策略冲突。"""
    for mode_key in ("origin_selection_mode", "trait_selection_mode"):
        mode_sources: dict[str, list[str]] = {}
        for rec in pack_records:
            destiny = rec.get("destiny")
            if not isinstance(destiny, dict):
                continue
            ui_cap = destiny.get("ui_capabilities")
            if not isinstance(ui_cap, dict):
                continue
            mode_val = ui_cap.get(mode_key)
            if isinstance(mode_val, str) and mode_val in ("ALLOW_MANUAL", "FORCE_RANDOM"):
                mode_sources.setdefault(mode_val, []).append(rec["pack_id"])

        if "ALLOW_MANUAL" in mode_sources and "FORCE_RANDOM" in mode_sources:
            manual_packs = ", ".join(mode_sources["ALLOW_MANUAL"])
            random_packs = ", ".join(mode_sources["FORCE_RANDOM"])
            diags.append(DiagnosticItem(
                code="ERR_MOD_UI_POLICY_CONFLICT",
                file_path="destinies.json",
                detail=(
                    f"多包 UI 策略冲突 ({mode_key}): MOD [{manual_packs}] 要求 ALLOW_MANUAL，"
                    f"而 MOD [{random_packs}] 要求 FORCE_RANDOM"
                ),
                fix_suggestion=f"请将其中一个 MOD 的 ui_capabilities.{mode_key} 调整为 'INHERIT' 或统一策略模式",
            ))


def validate_multi_mods(mod_dirs: list[Path]) -> tuple[bool, list[DiagnosticItem]]:
    """执行多包单包合规检查与跨包联合冲突预检。"""
    all_diags: list[DiagnosticItem] = []
    pack_records: list[dict[str, Any]] = []

    for mod_dir in mod_dirs:
        _, single_diags = validate_mod(mod_dir)
        for d in single_diags:
            prefixed_file = f"{mod_dir.name}/{d.file}" if not d.file.startswith(str(mod_dir)) else d.file
            all_diags.append(DiagnosticItem(d.code, prefixed_file, d.detail, d.fix_suggestion))

        if not mod_dir.is_dir():
            continue

        manifest_path = mod_dir / "pack.json"
        destiny_path = mod_dir / "destinies.json"
        manifest: dict[str, Any] = {}
        if manifest_path.is_file():
            try:
                loaded_m = json.loads(manifest_path.read_text(encoding="utf-8"))
                if isinstance(loaded_m, dict):
                    manifest = loaded_m
            except (json.JSONDecodeError, OSError):
                pass

        destiny: dict[str, Any] | None = None
        if destiny_path.is_file():
            try:
                loaded_d = json.loads(destiny_path.read_text(encoding="utf-8"))
                if isinstance(loaded_d, dict):
                    destiny = loaded_d
            except (json.JSONDecodeError, OSError):
                pass

        pack_id = str(manifest.get("pack_id") or mod_dir.name)
        pack_records.append({
            "pack_id": pack_id,
            "dir_name": mod_dir.name,
            "manifest": manifest,
            "destiny": destiny,
        })

    if len(pack_records) >= 2:
        _check_multi_incompatible_packs(pack_records, all_diags)
        _check_multi_duplicate_ids(pack_records, all_diags)
        _check_multi_ui_policy_conflicts(pack_records, all_diags)

    return len(all_diags) == 0, all_diags


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
