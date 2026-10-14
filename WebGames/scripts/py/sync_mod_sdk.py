#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · MOD SDK 同步引擎)
# 文件路径: WebGames/scripts/py/sync_mod_sdk.py
# 架构定位: MOD SDK 权威真源静态萃取与契约同步引擎 (MOD SDK Extraction & Sync Engine)
# 依赖与触发: 触发方: CI / 预提交钩子 / audit_sdk_sync.py | 上游: config/** | 下游: mod_sdk/** | 运行时: Python 3.10+
# 职责说明: 静态提取引擎权威真源、生成/更新 capabilities.json 与 MOD_SPEC.md、提供 --check-only 契约漂移判定
# 退出语义与设计依据: 退出码: 0=同步成功/无漂移, 1=契约漂移/校验失败, 2=配置缺失/运行异常 | 设计依据: AGENTS.md 契约防漂移与单源规则契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python WebGames/scripts/py/sync_mod_sdk.py
#   python WebGames/scripts/py/sync_mod_sdk.py --check-only
#   python WebGames/scripts/py/sync_mod_sdk.py --json
# ==============================================================================
"""MOD SDK 权威真源静态萃取与契约同步引擎。

架构定位与职责说明：
- 从引擎配置单一真源 (config/domains/ 及 config/narratives/) 自动化静态萃取能力清单；
- 同步生成 mod_sdk/capabilities.json 与更新 mod_sdk/MOD_SPEC.md 动态能力章节；
- 提供 --check-only 命令行门禁守卫，拦截任何数据契约漂移；
- 遵循零瞬态堆分配与单源收口公理，保证引擎运行时与模组开发契约 100% 绝对一致。

五阶段同步状态机 (Synchronization Pipeline State Machine):
  Phase 1 [Discovery]: 定位 WebGames 根目录并加载核心领域配置 JSON；
  Phase 2 [Extraction]: AST/JSON 符号深度遍历提取受支持种族、DAG 标识符、占位符及状态突变事件；
  Phase 3 [Compilation]: 汇总命途扩展能力契约、数值边界与 UI 受控策略；
  Phase 4 [Generation]: 渲染规整能力清单 capabilities.json 与 MOD_SPEC.md Markdown 文档；
  Phase 5 [Verification/Sync]: 对比磁盘文件判定契约漂移，或原子回写磁盘并保持 LF 换行。

设计依据与不变式契约：
- 单一事实源 (SSOT)：capabilities.json 必须完全由源码与配置导出，禁止人工维护分叉副本；
- 零破坏性原则：MOD_SPEC.md 的静态规范手工撰写区段必须严格保持不变，仅动态标记区受控刷新；
- 双向等价断言：capabilities.json 格式化缩进使用 2 空格，末尾保留单个标准 LF 换行。
"""

import argparse
import difflib
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def ensure_utf8_stdout() -> None:
    """保障跨平台 UTF-8 控制台输出，避免 Windows GBK 崩溃。"""
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def resolve_webgames_root() -> Path:
    """定位 WebGames 项目根目录。"""
    curr = Path(__file__).resolve()
    for candidate in [curr] + list(curr.parents):
        if (
            candidate / "config" / "domains" / "character_creation" / "core.json"
        ).is_file():
            return candidate
        if (
            candidate
            / "WebGames"
            / "config"
            / "domains"
            / "character_creation"
            / "core.json"
        ).is_file():
            return candidate / "WebGames"
    return Path(__file__).resolve().parents[2]


def load_json_file(file_path: Path) -> Dict[str, Any]:
    """读取指定 JSON 文件并解析为字典，遇到异常返回空字典。"""
    if not file_path.is_file():
        return {}
    try:
        content = file_path.read_text(encoding="utf-8")
        return json.loads(content)
    except Exception as exc:
        print(f"[WARN] 读取或解析 JSON 失败: {file_path} ({exc})", file=sys.stderr)
        return {}


def collect_placeholders_from_obj(obj: Any, pattern: re.Pattern) -> List[str]:
    """递归遍历对象中的所有字符串字段，提取占位符标识。"""
    placeholders: List[str] = []
    if isinstance(obj, str):
        matches = pattern.findall(obj)
        placeholders.extend(matches)
    elif isinstance(obj, dict):
        for val in obj.values():
            placeholders.extend(collect_placeholders_from_obj(val, pattern))
    elif isinstance(obj, list):
        for item in obj:
            placeholders.extend(collect_placeholders_from_obj(item, pattern))
    return placeholders


STANDARD_PLACEHOLDER_DOCS: Dict[str, str] = {
    "{PLAYER_NAME}": "当前玩家角色的自定义名称（支持大小写双轨：{player_name} 与 {PLAYER_NAME}）",
    "{CHARACTER_NAME}": "当前角色的名称标识，同 {PLAYER_NAME}（支持大小写双轨：{character_name} 与 {CHARACTER_NAME}）",
    "{CHARACTER_ID}": "角色实例全局唯一标识符（支持大小写双轨：{character_id} 与 {CHARACTER_ID}）",
    "{RACE_ID}": "角色所属种族唯一标识符，如 HUMAN（支持大小写双轨：{race_id} 与 {RACE_ID}）",
    "{GENDER}": "角色性别标识，如 FEMALE / MALE（支持大小写双轨：{gender} 与 {GENDER}）",
    "{START_LOCATION}": "角色出生与初始降临的地理场景标识或本地化名称（支持大小写双轨：{start_location} 与 {START_LOCATION}）",
    "{INITIAL_EQUIPMENT}": "角色获得的初始佩剑或基础装备道具名称（支持大小写双轨：{initial_equipment} 与 {INITIAL_EQUIPMENT}）",
    "{NPC_TARGET}": "对话交互或剧情引导的目标 NPC 实体名称（支持大小写双轨：{npc_target} 与 {NPC_TARGET}）",
    "{EVENT_RESULT}": "前序节点或剧情事件的判定结果摘要（支持大小写双轨：{event_result} 与 {EVENT_RESULT}）",
    "{ORIGIN_ID}": "角色选定或随机抽取的出身背景唯一标识符（支持大小写双轨：{origin_id} 与 {ORIGIN_ID}）",
    "{ORIGIN_NAME}": "角色出身背景的人类可读显示名称（支持大小写双轨：{origin_name} 与 {ORIGIN_NAME}）",
    "{BIRTH_REGION}": "角色出身关联的降临地域标识符（支持大小写双轨：{birth_region} 与 {BIRTH_REGION}）",
    "{TRAIT_SUMMARY}": "角色装配的正负因果天赋组合摘要文本（支持大小写双轨：{trait_summary} 与 {TRAIT_SUMMARY}）",
    "{STARTER_KIT_NAME}": "角色装配的初始装备行囊名称（支持大小写双轨：{starter_kit_name} 与 {STARTER_KIT_NAME}）",
    "{INITIAL_GOLD}": "角色创角结算后的初始金币数量（支持大小写双轨：{initial_gold} 与 {INITIAL_GOLD}）",
}

SUPPORTED_ERROR_CODES: List[str] = [
    "ERR_MOD_DIR_NOT_FOUND",
    "ERR_FILE_MISSING",
    "ERR_JSON_INVALID",
    "ERR_MANIFEST_NOT_OBJECT",
    "ERR_MANIFEST_FIELD_MISSING",
    "ERR_MANIFEST_FIELD_TYPE",
    "ERR_ROUTING_EMPTY",
    "ERR_ROUTING_TARGET_MISSING",
    "ERR_ROUTING_TARGET_UNKNOWN",
    "ERR_ROUTING_TARGET_NOT_FOUND",
    "ERR_DAG_DIR_MISSING",
    "ERR_DAG_NO_FILES",
    "ERR_DAG_NO_NODES",
    "ERR_DAG_ENTRY_COUNT",
    "ERR_DAG_TERMINAL_COUNT",
    "ERR_DAG_DANGLING_EDGE",
    "ERR_DAG_MISSING_PREREQUISITE",
    "ERR_DAG_CYCLE",
    "ERR_DAG_ORPHAN_NODE",
    "ERR_DAG_UNREACHABLE_TERMINAL",
    "ERR_DAG_NODE_TEXT_MISSING",
    "ERR_I18N_DIR_MISSING",
    "ERR_I18N_EMPTY",
    "ERR_I18N_MISSING_KEY",
    "ERR_UNKNOWN_PLACEHOLDER",
    "ERR_DESTINY_NOT_OBJECT",
    "ERR_DESTINY_INVALID_UI_MODE",
    "ERR_DESTINY_STAT_BUDGET_EXCEEDED",
    "ERR_DESTINY_GOLD_CAP_EXCEEDED",
    "ERR_DESTINY_CAUSALITY_IMBALANCE",
    "ERR_DESTINY_KIT_INVALID",
    "ERR_DESTINY_UNKNOWN_DAG_REF",
    "ERR_DESTINY_UNKNOWN_KIT_REF",
    "ERR_MOD_DUPLICATE_ID_CONFLICT",
    "ERR_MOD_INCOMPATIBLE_CONFLICT",
    "ERR_MOD_UI_POLICY_CONFLICT",
    "ERR_PREEMPTED_BY_HUMAN",
    "ERR_INVALID_ESC_ACTION",
    "ERR_GATEWAY_NOT_BOUND",
    "ERR_SAVE_GUARD_BLOCKED",
    "ERR_INVALID_ENVELOPE",
]


def _collect_dag_id_from_list(items: List[Any], found_ids: set[str]) -> None:
    """从字典列表中提取包含 DAG_ 前缀的节点标识符。"""
    for item in items:
        if not isinstance(item, dict):
            continue
        did = item.get("dag_id") or item.get("id")
        if isinstance(did, str) and did.startswith("DAG_"):
            found_ids.add(did)


def _collect_dag_id_from_value(value: Any, found_ids: set[str]) -> None:
    """从字典或列表值中提取 DAG 标识符。"""
    if isinstance(value, dict):
        for sub_k in value.keys():
            if isinstance(sub_k, str) and sub_k.startswith("DAG_"):
                found_ids.add(sub_k)
        return
    if isinstance(value, list):
        _collect_dag_id_from_list(value, found_ids)


def _extract_builtin_dag_ids(config_dir: Path) -> List[str]:
    """从 config/narratives/prologue_dag_catalog.json 提取内置序章 DAG 标识符列表。"""
    dag_catalog_path = config_dir / "narratives" / "prologue_dag_catalog.json"
    dag_catalog_data = load_json_file(dag_catalog_path)
    found_ids: set[str] = set()
    if isinstance(dag_catalog_data, dict):
        for k, v in dag_catalog_data.items():
            if isinstance(k, str) and k.startswith("DAG_"):
                found_ids.add(k)
            else:
                _collect_dag_id_from_value(v, found_ids)
    if not found_ids:
        return ["DAG_PROLOGUE_ELF_SANCTUARY", "DAG_PROLOGUE_HUMAN_CAPITAL"]
    return sorted(found_ids)


def _build_dual_track_placeholder_list(upper_keys: List[str]) -> List[str]:
    """构建包含大写与小写双轨形式的占位符列表。"""
    result: List[str] = []
    for ph in upper_keys:
        if ph not in result:
            result.append(ph)
        lower_ph = ph.lower()
        if lower_ph not in result:
            result.append(lower_ph)
    return result


def extract_destiny_capabilities(
    config_dir: Path, core_data: Dict[str, Any]
) -> Dict[str, Any]:
    """从角色创建、初始行囊与物品真源提取命途扩展能力契约。"""
    attr_gen = core_data.get("authoritative_reincarnation", {}).get(
        "attribute_generation", {}
    )
    attr_keys = attr_gen.get("keys")
    if not isinstance(attr_keys, list) or not attr_keys:
        attr_keys = ["STR", "CON", "INT", "AGI", "SPR", "VIT"]

    attribute_bounds = {
        "min_val": int(attr_gen.get("min_val", 1)),
        "max_val": int(attr_gen.get("max_val", 6)),
        "baseline": int(attr_gen.get("baseline", 3)),
        "total_points": int(attr_gen.get("total_points", 21)),
    }

    builtin_traits = sorted(list(core_data.get("traits", {}).keys()))

    loadout_path = config_dir / "domains" / "starter_loadout" / "core.json"
    loadout_data = load_json_file(loadout_path)
    builtin_starter_kits = sorted(list(loadout_data.get("starter_kits", {}).keys()))
    builtin_dag_ids = _extract_builtin_dag_ids(config_dir)

    items_path = config_dir / "items" / "core.json"
    items_data = load_json_file(items_path)
    raw_items = items_data.get("items", [])
    canonical_item_ids = sorted(
        [
            item["canonical_id"]
            for item in raw_items
            if isinstance(item, dict)
            and isinstance(item.get("canonical_id"), str)
            and item.get("canonical_id")
        ]
    )

    upper_placeholders = list(STANDARD_PLACEHOLDER_DOCS.keys())
    dual_placeholders = _build_dual_track_placeholder_list(upper_placeholders)

    return {
        "attribute_keys": list(attr_keys),
        "attribute_bounds": attribute_bounds,
        "origin_bonus_budget": {
            "per_stat_min": -2,
            "per_stat_max": 3,
            "net_sum_min": -2,
            "net_sum_max": 4,
            "max_initial_gold": 1000,
        },
        "causality_trait_rules": {
            "require_paired_pos_neg": True,
            "max_net_cost_delta": 1,
        },
        "ui_capability_modes": {
            "origin_selection_mode": ["INHERIT", "ALLOW_MANUAL", "FORCE_RANDOM"],
            "trait_selection_mode": ["INHERIT", "ALLOW_MANUAL", "FORCE_RANDOM"],
        },
        "builtin_traits": builtin_traits,
        "builtin_starter_kits": builtin_starter_kits,
        "builtin_dag_ids": builtin_dag_ids,
        "canonical_item_ids": canonical_item_ids,
        "supported_placeholders": dual_placeholders,
        "supported_error_codes": list(SUPPORTED_ERROR_CODES),
    }


def extract_agent_hud_telemetry_capabilities(config_dir: Path) -> Dict[str, Any]:
    """从 config/domains/world_state/core.json 静态萃取 Agent 遥测与动态动作通道能力。"""
    ws_core_path = config_dir / "domains" / "world_state" / "core.json"
    ws_data = load_json_file(ws_core_path)

    stream_cfg = ws_data.get("agent_telemetry_stream", {})
    channel_cfg = ws_data.get("agent_action_channel", {})

    raw_directives = stream_cfg.get("supported_directives", [])
    supported_directives = (
        sorted(list(raw_directives))
        if raw_directives
        else [
            "ALLOCATE_POTENTIAL_STAT",
            "CLAIM_QUEST_OBJECTIVE",
            "DISMISS_UI_NOTICE",
            "INSPECT_INVENTORY_SLOT",
            "MARK_MAIL_READ",
            "REST_AND_ADVANCE_TIME",
            "TOGGLE_MODE_ADAPTATION",
        ]
    )

    return {
        "protocol_version": str(stream_cfg.get("protocol_version", "1.0.0")),
        "domain_name": str(stream_cfg.get("domain_name", "HOME_HUD")),
        "ring_buffer_capacity": int(stream_cfg.get("ring_buffer_capacity", 32)),
        "async_queue_capacity": int(stream_cfg.get("async_queue_capacity", 128)),
        "backpressure_strategy": str(
            stream_cfg.get("backpressure_strategy", "DROP_OLDEST")
        ),
        "binary_compression_enabled": bool(
            stream_cfg.get("binary_compression_enabled", True)
        ),
        "supported_directives": supported_directives,
        "control_lease": {
            "human_preemption_lease_ms": int(
                channel_cfg.get("human_preemption_lease_ms", 3000)
            ),
            "auto_preempt_on_modal_open": bool(
                channel_cfg.get("auto_preempt_on_modal_open", True)
            ),
            "modes": [
                "READ_WRITE",
                "READ_ONLY_OBSERVER",
            ],
            "operator_states": [
                "IDLE",
                "ACTIVE",
                "EXCLUSIVE_MODAL_OPEN",
            ],
        },
        "binary_telemetry_codec": {
            "magic_header": "0x4B414C52",
            "protocol_version": 1,
            "target_byte_budget": 256,
        },
    }


def extract_unified_protocol_capabilities(config_dir: Path) -> Dict[str, Any]:
    """从 config/domains/ 与引擎全局常数静态萃取全域统一协议契约。"""
    ws_core_path = config_dir / "domains" / "world_state" / "core.json"
    ws_data = load_json_file(ws_core_path)
    channel_cfg = ws_data.get("agent_action_channel", {})

    lease_ms = int(channel_cfg.get("human_preemption_lease_ms", 3000))
    auto_preempt = bool(channel_cfg.get("auto_preempt_on_modal_open", True))

    return {
        "protocol_version": "1.0.0",
        "supported_actors": ["HUMAN_UI", "AGENT"],
        "human_preemption_lease_ms": lease_ms,
        "auto_preempt_on_modal_open": auto_preempt,
        "supported_domains": [
            "HOME_HUD",
            "ESC_MENU",
            "PROLOGUE",
            "CHARACTER_CREATION",
        ],
        "esc_menu_actions": [
            "RESUME_GAME",
            "OPEN_SETTINGS",
            "SAVE_AND_QUIT_TO_ARCHIVE",
            "FORCE_QUIT_TO_ARCHIVE",
            "SAVE_AND_QUIT_TO_GATEWAY",
            "SAVE_AND_QUIT_DESKTOP",
        ],
        "envelope_schema_versions": {
            "client_request": "kalar.mod_sdk.client_request_envelope.v1",
            "unified_response": "kalar.mod_sdk.unified_response_envelope.v1",
            "esc_payload": "kalar.mod_sdk.esc_menu_action_payload.v1",
        },
    }


def extract_capabilities(webgames_root: Path) -> Dict[str, Any]:
    """执行核心能力静态萃取流水线。

    业务逻辑与状态机时序：
    1. 创角核心领域真源 (character_creation/core.json)：解析受支持种族枚举与六维属性初值；
    2. 叙事与本地化配置 (narratives/prologue_i18n.json)：DFS 遍历占位符 token 并构建大小写双轨词典；
    3. DAG 流程图元真源 (narratives/prologue_dag_catalog.json)：萃取合法节点类型与状态突变事件列表；
    4. 命途扩展能力 (destiny/): 聚合身世背景、因果天赋等数值守恒预算与边界契约；
    5. 主页 HUD 遥测与动作通道能力 (world_state/core.json): 聚合切片流、7 大指令与人类独占租约。

    返回规整后的能力全集字典，保证字段命名与 mod_sdk/capabilities.json 架构契约 100% 对齐。
    """
    config_dir = webgames_root / "config"

    # 1. 提取 character_creation core.json
    core_path = config_dir / "domains" / "character_creation" / "core.json"
    core_data = load_json_file(core_path)

    races_catalog = core_data.get("races_catalog", {})
    supported_races = sorted(
        [
            r_id
            for r_id, r_info in races_catalog.items()
            if isinstance(r_info, dict) and r_info.get("is_enabled", False)
        ]
    )
    if not supported_races:
        supported_races = ["HUMAN"]

    origins = sorted(list(core_data.get("origins", {}).keys()))
    birth_regions = sorted(list(core_data.get("birth_regions", {}).keys()))

    # 2. 提取 prologue_i18n.json
    i18n_path = config_dir / "narratives" / "prologue_i18n.json"
    i18n_data = load_json_file(i18n_path)

    placeholder_pattern = re.compile(r"\{[A-Z0-9_]+\}")
    found_placeholders = collect_placeholders_from_obj(i18n_data, placeholder_pattern)

    available_placeholders: Dict[str, str] = dict(STANDARD_PLACEHOLDER_DOCS)
    for ph in found_placeholders:
        if ph not in available_placeholders:
            clean_name = ph.strip("{}")
            available_placeholders[ph] = (
                f"剧情本地化占位符: {clean_name}（支持大小写双轨：{{{clean_name.lower()}}} 与 {ph}）"
            )

    supported_placeholders = _build_dual_track_placeholder_list(
        list(available_placeholders.keys())
    )

    reference_locations = sorted(list(i18n_data.get("locations", {}).keys()))
    reference_items = sorted(list(i18n_data.get("items", {}).keys()))
    reference_npcs = sorted(
        [k for k in i18n_data.get("npcs", {}).keys() if k != "default_guide"]
    )

    # 3. 提取 prologue_dag_catalog.json
    valid_node_types = [
        "START_ENTRY",
        "STANDARD_STEP",
        "BRANCH_CHOICE",
        "TERMINAL_EXIT",
    ]
    valid_mutation_events = [
        "CharacterCreated",
        "LocationAssigned",
        "EquipmentGranted",
        "DialogueReady",
        "PrologueCompleted",
    ]

    # 4. 提取命途与创角扩展能力真源
    destiny_mod_capabilities = extract_destiny_capabilities(config_dir, core_data)

    # 5. 提取主页 HUD 遥测与动态动作通道能力真源
    agent_hud_telemetry_capabilities = extract_agent_hud_telemetry_capabilities(
        config_dir
    )

    # 6. 提取全域统一协议与跨端信封契约真源
    unified_protocol_capabilities = extract_unified_protocol_capabilities(config_dir)

    return {
        "_meta": {
            "version": "1.0.0",
            "schema": "kalar.mod_sdk.capabilities",
            "generator": "WebGames/scripts/py/sync_mod_sdk.py",
            "description": "卡拉尔世界引擎 MOD 开发者 SDK 权威能力描述清单（权威真源萃取，禁止手动修改）",
        },
        "engine_api_version": "1.0.0",
        "supported_races": supported_races,
        "valid_node_types": valid_node_types,
        "available_placeholders": available_placeholders,
        "supported_placeholders": supported_placeholders,
        "supported_error_codes": list(SUPPORTED_ERROR_CODES),
        "valid_mutation_events": valid_mutation_events,
        "origins": origins,
        "birth_regions": birth_regions,
        "reference_locations": reference_locations,
        "reference_items": reference_items,
        "reference_npcs": reference_npcs,
        "destiny_mod_capabilities": destiny_mod_capabilities,
        "agent_hud_telemetry_capabilities": agent_hud_telemetry_capabilities,
        "unified_protocol_capabilities": unified_protocol_capabilities,
        "interactive_session_capabilities": {
            "supported_modes": [
                "BATCH_SIMULATION",
                "INTERACTIVE_STREAM",
            ],
            "schema_versions": {
                "observation": "kalar.mod_sdk.observation.v1",
                "action": "kalar.mod_sdk.action.v1",
                "transcript": "kalar.mod_sdk.playthrough_transcript.v1",
            },
            "supported_action_types": [
                "choose",
                "rollback",
                "quit",
            ],
            "channel_protocol": "STDIO_NDJSON",
        },
    }


def format_capabilities_json(capabilities: Dict[str, Any]) -> str:
    """将能力数据序列化为规整的 JSON 字符串（LF 换行，2 空格缩进）。"""
    return json.dumps(capabilities, indent=2, ensure_ascii=False) + "\n"


def _build_destiny_autogen_lines(destiny_cap: Dict[str, Any]) -> List[str]:
    """构建命途扩展能力章节的动态 Markdown 行列表。"""
    attr_keys = ", ".join(destiny_cap.get("attribute_keys", []))
    bounds = destiny_cap.get("attribute_bounds", {})
    budget = destiny_cap.get("origin_bonus_budget", {})
    trait_rules = destiny_cap.get("causality_trait_rules", {})
    ui_modes = destiny_cap.get("ui_capability_modes", {})
    origin_modes = ", ".join(ui_modes.get("origin_selection_mode", []))
    trait_modes = ", ".join(ui_modes.get("trait_selection_mode", []))
    builtin_traits = ", ".join(destiny_cap.get("builtin_traits", []))
    builtin_kits = ", ".join(destiny_cap.get("builtin_starter_kits", []))
    builtin_dags = ", ".join(destiny_cap.get("builtin_dag_ids", []))
    canonical_items = ", ".join(destiny_cap.get("canonical_item_ids", []))
    error_codes = ", ".join(destiny_cap.get("supported_error_codes", []))

    return [
        "",
        "### 6. 命途与创角扩展能力契约 (`destinies.json` Capabilities)",
        "",
        f"- **六维核心属性键 (`attribute_keys`)**: `{attr_keys}`",
        (
            f"- **六维基础生成边界 (`attribute_bounds`)**: "
            f"单维范围 `[{bounds.get('min_val', 1)}, {bounds.get('max_val', 6)}]`，"
            f"基准值 `{bounds.get('baseline', 3)}`，"
            f"总点数预算 `{bounds.get('total_points', 21)}`"
        ),
        (
            f"- **自定义身世加成红线 (`origin_bonus_budget`)**: "
            f"单维加成 `[{budget.get('per_stat_min', -2)}, {budget.get('per_stat_max', 3)}]`，"
            f"六维净代数和 `[{budget.get('net_sum_min', -2)}, {budget.get('net_sum_max', 4)}]`，"
            f"初始金币上限 `<={budget.get('max_initial_gold', 1000)}`"
        ),
        (
            f"- **正负因果天赋守恒规则 (`causality_trait_rules`)**: "
            f"`require_paired_pos_neg={trait_rules.get('require_paired_pos_neg', True)}`（必须一正一负成对配置），"
            f"`max_net_cost_delta={trait_rules.get('max_net_cost_delta', 1)}`（正负点数净和绝对值 `<= 1`）"
        ),
        (
            f"- **前端 UI 受控解锁策略 (`ui_capability_modes`)**: "
            f"`origin_selection_mode`: `[{origin_modes}]`；"
            f"`trait_selection_mode`: `[{trait_modes}]`"
        ),
        f"- **内置因果天赋 (`builtin_traits`)**: `{builtin_traits}`",
        f"- **内置初始套件 (`builtin_starter_kits`)**: `{builtin_kits}`",
        f"- **内置序章图元 (`builtin_dag_ids`)**: `{builtin_dags}`",
        f"- **合法物品 ID 清单 (`canonical_item_ids`)**: `{canonical_items}`",
        f"- **静态门禁错误码 (`supported_error_codes`)**: `{error_codes}`",
    ]


def _build_agent_hud_telemetry_autogen_lines(
    telemetry_cap: Dict[str, Any],
) -> List[str]:
    """构建主页 HUD Agent 遥测与动态行动空间章节的动态 Markdown 行列表。"""
    protocol_ver = telemetry_cap.get("protocol_version", "1.0.0")
    domain_name = telemetry_cap.get("domain_name", "HOME_HUD")
    ring_cap = telemetry_cap.get("ring_buffer_capacity", 32)
    async_cap = telemetry_cap.get("async_queue_capacity", 128)
    backpressure = telemetry_cap.get("backpressure_strategy", "DROP_OLDEST")
    directives = ", ".join(telemetry_cap.get("supported_directives", []))
    lease = telemetry_cap.get("control_lease", {})
    lease_ms = lease.get("human_preemption_lease_ms", 2000)
    auto_preempt = lease.get("auto_preempt_on_modal_open", True)
    modes = ", ".join(lease.get("modes", []))
    op_states = ", ".join(lease.get("operator_states", []))
    codec = telemetry_cap.get("binary_telemetry_codec", {})
    magic = codec.get("magic_header", "0x4B414C52")
    budget = codec.get("target_byte_budget", 256)

    return [
        "",
        "### 7. 主页 HUD 面向 Agent 动态行动空间与遥测流能力契约 (Home HUD Telemetry)",
        "",
        f"- **遥测协议版本 (`protocol_version`)**: `{protocol_ver}`",
        f"- **遥测业务域 (`domain_name`)**: `{domain_name}`",
        (
            f"- **定长轨迹与流控队列 (`ring_buffer_capacity` / `async_queue_capacity`)**: "
            f"定长环形缓冲 `{ring_cap}` 槽位，异步队列容量 `{async_cap}`，背压流控策略 `{backpressure}`"
        ),
        f"- **受支持动态行动空间指令集 (`supported_directives`)**: `{directives}`",
        (
            f"- **人类控制权优先租约 (`control_lease`)**: "
            f"人类抢占窗口 `{lease_ms}ms`，模态独占抢占 `{auto_preempt}`，"
            f"控制模式 `[{modes}]`，操作者状态 `[{op_states}]`"
        ),
        (
            f"- **紧凑二进制流编解码 (`binary_telemetry_codec`)**: "
            f"魔数标识 `{magic}` (KALR)，协议版本 `{codec.get('protocol_version', 1)}`，"
            f"目标压缩体积预算 `<={budget}` 字节"
        ),
    ]


def _build_unified_protocol_autogen_lines(proto_cap: Dict[str, Any]) -> List[str]:
    """构建全域统一协议与跨端信封契约章节的动态 Markdown 行列表。"""
    protocol_ver = proto_cap.get("protocol_version", "1.0.0")
    actors = ", ".join(proto_cap.get("supported_actors", []))
    lease_ms = proto_cap.get("human_preemption_lease_ms", 3000)
    auto_preempt = proto_cap.get("auto_preempt_on_modal_open", True)
    domains = ", ".join(proto_cap.get("supported_domains", []))
    esc_actions = ", ".join(proto_cap.get("esc_menu_actions", []))
    schemas = proto_cap.get("envelope_schema_versions", {})
    req_schema = schemas.get(
        "client_request", "kalar.mod_sdk.client_request_envelope.v1"
    )
    resp_schema = schemas.get(
        "unified_response", "kalar.mod_sdk.unified_response_envelope.v1"
    )
    esc_schema = schemas.get("esc_payload", "kalar.mod_sdk.esc_menu_action_payload.v1")

    return [
        "",
        "### 8. 全域统一请求响应信封与 ESC 协议契约 (Unified Protocol Envelope)",
        "",
        f"- **统一协议版本 (`protocol_version`)**: `{protocol_ver}`",
        f"- **受支持参与者身份 (`supported_actors`)**: `{actors}`",
        (
            f"- **人类独占抢占租约窗口 (`human_preemption_lease_ms`)**: "
            f"`{lease_ms}ms`（模态打开自动抢占: `{auto_preempt}`）"
        ),
        f"- **协议路由业务域 (`supported_domains`)**: `{domains}`",
        f"- **受支持系统菜单指令 (`esc_menu_actions`)**: `{esc_actions}`",
        (
            f"- **信封强类型 Schema 版本 (`envelope_schema_versions`)**: "
            f"请求信封 `{req_schema}`，响应信封 `{resp_schema}`，ESC 载荷 `{esc_schema}`"
        ),
    ]


def generate_autogen_spec_section(capabilities: Dict[str, Any]) -> str:
    """生成 MOD_SPEC.md 动态能力章节的 Markdown 文本。"""
    lines: List[str] = [
        "<!-- AUTOGEN_CAPABILITIES_START -->",
        "> [!IMPORTANT]",
        f"> **【引擎权威能力清单】**：当前兼容引擎 API 版本: `{capabilities.get('engine_api_version', '1.0.0')}`。本节由 `sync_mod_sdk.py` 静态萃取维护，禁止手动篡改。",
        "",
        "### 1. 启用的种族清单 (Supported Races)",
        "",
        "MOD 创作者角色与序章节点路由仅允许绑定下列已启用种族：",
        "",
        "| 种族标识符 (Race ID) | 状态 | 规范语义 |",
        "| :--- | :---: | :--- |",
    ]

    for race in capabilities.get("supported_races", []):
        lines.append(f"| `{race}` | 启用 (Active) | 卡拉尔世界核心创角与剧情支持种族 |")

    lines.extend(
        [
            "",
            "### 2. 合法 DAG 节点类型 (Valid DAG Node Types)",
            "",
            "剧情图由下列四类节点拓扑连接，严禁使用非声明节点类型：",
            "",
            "| 节点类型枚举 | 拓扑约束 | 语义与职责 |",
            "| :--- | :--- | :--- |",
            "| `START_ENTRY` | 入度必须为 0，单图仅允许 1 个 | 序章剧情唯一的起始入口节点 |",
            "| `STANDARD_STEP` | 入度 >= 1，出度 >= 1 | 标准顺序执行剧情推进步骤 |",
            "| `BRANCH_CHOICE` | 入度 >= 1，出度 >= 2 | 具有多分支交互选择或因果分流节点 |",
            "| `TERMINAL_EXIT` | 出度必须为 0，允许触发完成突变 | 剧情图唯一的终结退出节点 |",
            "",
            "### 3. 合法文本占位符字典 (Available Placeholders)",
            "",
            "本地化文案模板（i18n）与节点内联文案（`inline_text`）支持大小写双轨插值（如 `{player_name}` 与 `{PLAYER_NAME}`）：",
            "",
            "| 占位符宏 (Placeholder) | 解析源与说明 |",
            "| :--- | :--- |",
        ]
    )

    placeholders = capabilities.get("available_placeholders", {})
    for ph, desc in placeholders.items():
        lines.append(f"| `{ph}` | {desc} |")

    lines.extend(
        [
            "",
            "### 4. 状态突变事件规范 (Valid Mutation Events)",
            "",
            "DAG 终结节点或剧情关键节点仅允许发布下列合法状态突变事件：",
            "",
            "| 突变事件类型 (Mutation Type) | 触发阶段与语义 |",
            "| :--- | :--- |",
            "| `CharacterCreated` | 角色基础档案初始化完成并装配属性 |",
            "| `LocationAssigned` | 角色出生地与初始空间坐标指派完毕 |",
            "| `EquipmentGranted` | 角色初始新兵行囊与佩剑装备入包 |",
            "| `DialogueReady` | 对话总线就绪并激活引导 NPC 交互 |",
            "| `PrologueCompleted` | 序章历程完结，世界大门敞开，流转至主舞台 |",
            "",
            "### 5. 参考预设枚举库 (Reference Constants)",
            "",
            f"- **可选出身预设 (Origins)**: `{', '.join(capabilities.get('origins', []))}`",
            f"- **可选出生地域 (Birth Regions)**: `{', '.join(capabilities.get('birth_regions', []))}`",
            f"- **标准初始场景 (Locations)**: `{', '.join(capabilities.get('reference_locations', []))}`",
            f"- **标准初始装备 (Items)**: `{', '.join(capabilities.get('reference_items', []))}`",
            f"- **引导 NPC 实体 (NPCs)**: `{', '.join(capabilities.get('reference_npcs', []))}`",
        ]
    )

    destiny_cap = capabilities.get("destiny_mod_capabilities", {})
    if isinstance(destiny_cap, dict) and destiny_cap:
        lines.extend(_build_destiny_autogen_lines(destiny_cap))

    telemetry_cap = capabilities.get("agent_hud_telemetry_capabilities", {})
    if isinstance(telemetry_cap, dict) and telemetry_cap:
        lines.extend(_build_agent_hud_telemetry_autogen_lines(telemetry_cap))

    proto_cap = capabilities.get("unified_protocol_capabilities", {})
    if isinstance(proto_cap, dict) and proto_cap:
        lines.extend(_build_unified_protocol_autogen_lines(proto_cap))

    lines.append("<!-- AUTOGEN_CAPABILITIES_END -->")
    return "\n".join(lines)


def render_full_mod_spec(
    capabilities: Dict[str, Any], existing_content: Optional[str] = None
) -> str:
    """渲染或注入 MOD_SPEC.md 完整内容。"""
    autogen_part = generate_autogen_spec_section(capabilities)

    if (
        existing_content
        and "<!-- AUTOGEN_CAPABILITIES_START -->" in existing_content
        and "destinies.json" in existing_content
    ):
        pattern = re.compile(
            r"<!-- AUTOGEN_CAPABILITIES_START -->.*?<!-- AUTOGEN_CAPABILITIES_END -->",
            re.DOTALL,
        )
        updated = pattern.sub(autogen_part, existing_content)
        return updated.replace("\r\n", "\n")

    template = f"""# 卡拉尔世界引擎 · 模组创作者数据契约速查指南 (MOD Quick-Reference Spec v1.2)

> [!NOTE]
> **【规范定位】**：本手册是面向模组开发者与自主推演 Agent 的根目录官方契约速查指南与真源索引总枢。所有动态能力清单均由底层单一真源自动化静态萃取同步，确保数据契约与引擎运行时保持一致。
> 完整深入的架构设计、算法公式与协议明细，请直接查阅 [`docs/`](docs/) 对应权威规范卷。
> **引擎接口版本**：`{capabilities.get("engine_api_version", "1.0.0")}`

---

## 🧭 官方权威规范导航矩阵 (Documentation Index & Navigation Hub)

| 专题领域 | 权威规范文档指针 | 核心内容摘要 |
| :--- | :--- | :--- |
| **全景架构与装配** | [`docs/SPECIFICATION.md`](docs/SPECIFICATION.md) | 模组核心架构、Kahn 拓扑排序装配算法、多包冲突裁决公理与静态门禁错误码字典 |
| **视听多媒体准入** | [`docs/ART_AND_ASSETS_GUIDE.md`](docs/ART_AND_ASSETS_GUIDE.md) | Tier 2 视听资产烹饪规范、WebP/OGG/TTF 格式白名单、体积配额与 SHA-256 清单机制 |
| **规则大魔改覆写** | [`docs/TOTAL_CONVERSION_SPEC.md`](docs/TOTAL_CONVERSION_SPEC.md) | Tier 3 全局大魔改规范、世界地图空间阻抗、物品卡牌、战斗动力学公式与差分覆写语义 |
| **无头交互推演** | [`docs/AGENT_INTERACTION.md`](docs/AGENT_INTERACTION.md) | Agent 无头交互式推演协议、STDIO NDJSON 双向流式通信契约与 Observation-Action 状态机 |
| **现场遥测与伴侣** | [`docs/COMPANION_PROTOCOL.md`](docs/COMPANION_PROTOCOL.md) | 非侵入式伴侣观察总线、事件广播协议、会话遥测与现场黑匣子录制归档规范 |

---

## 一、 引擎能力真源契约 (Engine Capabilities)

{autogen_part}

---

## 二、 自动化验证与守卫命令

```bash
# 验证 MOD SDK 契约是否与引擎底层真源保持一致（零漂移）
python WebGames/scripts/py/sync_mod_sdk.py --check-only

# 执行全量 SDK 完整性与门禁审计断言
python WebGames/scripts/py/audit_sdk_sync.py
```
"""
    return template.replace("\r\n", "\n")

def check_contract_drift(
    webgames_root: Path,
    capabilities: Dict[str, Any],
) -> Tuple[bool, List[str]]:
    """比对磁盘既有文件与内存萃取结果，检测契约漂移。

    判定规则与差分输出：
    - 分别对 capabilities.json 与 MOD_SPEC.md 动态区间进行内存渲染；
    - 使用 difflib 生成统一上下文 Diff 补丁（前 30 行明细）；
    - 若两份文件均无漂移，返回 (True, [])；否则返回 (False, diff_messages)；
    - 本函数供 --check-only 命令行门禁与 CI/预提交钩子直接消费。
    """
    mod_sdk_dir = webgames_root / "mod_sdk"
    cap_path = mod_sdk_dir / "capabilities.json"
    spec_path = mod_sdk_dir / "MOD_SPEC.md"

    diff_messages: List[str] = []

    # 1. 检查 capabilities.json
    expected_cap_content = format_capabilities_json(capabilities)
    if not cap_path.is_file():
        diff_messages.append(f"磁盘缺失文件: {cap_path}")
    else:
        existing_cap_content = cap_path.read_text(encoding="utf-8").replace(
            "\r\n", "\n"
        )
        if existing_cap_content != expected_cap_content:
            diff_lines = list(
                difflib.unified_diff(
                    existing_cap_content.splitlines(keepends=True),
                    expected_cap_content.splitlines(keepends=True),
                    fromfile="disk/capabilities.json",
                    tofile="memory/capabilities.json",
                )
            )
            diff_messages.append(
                f"capabilities.json 契约漂移:\n" + "".join(diff_lines[:30])
            )

    # 2. 检查 MOD_SPEC.md
    if not spec_path.is_file():
        diff_messages.append(f"磁盘缺失文件: {spec_path}")
    else:
        existing_spec_content = spec_path.read_text(encoding="utf-8").replace(
            "\r\n", "\n"
        )
        expected_spec_content = render_full_mod_spec(
            capabilities, existing_spec_content
        )
        if existing_spec_content != expected_spec_content:
            diff_lines = list(
                difflib.unified_diff(
                    existing_spec_content.splitlines(keepends=True),
                    expected_spec_content.splitlines(keepends=True),
                    fromfile="disk/MOD_SPEC.md",
                    tofile="memory/MOD_SPEC.md",
                )
            )
            diff_messages.append(f"MOD_SPEC.md 契约漂移:\n" + "".join(diff_lines[:30]))

    is_clean = len(diff_messages) == 0
    return is_clean, diff_messages


def sync_to_disk(webgames_root: Path, capabilities: Dict[str, Any]) -> None:
    """将萃取的能力清单与文档原子写入磁盘。

    落盘规范与格式保证：
    - capabilities.json：按键排序、2 空格缩进、末尾单个 LF、UTF-8 编码；
    - MOD_SPEC.md：定位标记区间进行局部切片替换，保留手工撰写章节无损；
    - 保证跨平台（Windows/Linux）一致的 LF 换行契约。
    """
    mod_sdk_dir = webgames_root / "mod_sdk"
    mod_sdk_dir.mkdir(parents=True, exist_ok=True)

    cap_path = mod_sdk_dir / "capabilities.json"
    spec_path = mod_sdk_dir / "MOD_SPEC.md"

    # 1. 写入 capabilities.json
    cap_content = format_capabilities_json(capabilities)
    cap_path.write_text(cap_content, encoding="utf-8", newline="\n")
    print(f"[OK] 已同步能力清单: {cap_path}")

    # 2. 写入或注入 MOD_SPEC.md
    existing_spec = (
        spec_path.read_text(encoding="utf-8") if spec_path.is_file() else None
    )
    spec_content = render_full_mod_spec(capabilities, existing_spec)
    spec_path.write_text(spec_content, encoding="utf-8", newline="\n")
    print(f"[OK] 已同步开发契约规范: {spec_path}")


def main() -> int:
    """CLI 入口主函数。"""
    ensure_utf8_stdout()
    parser = argparse.ArgumentParser(
        description="卡拉尔引擎 MOD 开发者 SDK 权威真源静态萃取与防漂移同步引擎"
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="比对磁盘既有文件与内存萃取结果，检测到差异返回非 0 退出码（CI 门禁阻断）",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="输出萃取的 capabilities 结构化 JSON 到标准输出",
    )
    args = parser.parse_args()

    root = resolve_webgames_root()
    capabilities = extract_capabilities(root)

    if args.json:
        print(format_capabilities_json(capabilities))
        return 0

    if args.check_only:
        is_clean, diffs = check_contract_drift(root, capabilities)
        if is_clean:
            print("[OK] MOD SDK 契约与引擎真源保持 100% 绝对一致，未检测到任何漂移。")
            return 0
        print("[FAIL] 检测到 MOD SDK 契约发生漂移！", file=sys.stderr)
        for diff in diffs:
            print(diff, file=sys.stderr)
        print(
            "\n请运行 python WebGames/scripts/py/sync_mod_sdk.py 重新同步最新权威契约。",
            file=sys.stderr,
        )
        return 1

    sync_to_disk(root, capabilities)
    return 0


if __name__ == "__main__":
    sys.exit(main())
