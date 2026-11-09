#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · MOD SDK 通用共享基盘)
# 文件路径: WebGames/scripts/py/lib/mod_sdk_shared.py
# 架构定位: MOD SDK 能力萃取与契约比较共享核心库 (MOD SDK Shared Core)
# 依赖与触发: 触发方: sync_mod_sdk.py / audit_sdk_sync.py | 上游: config/** | 下游: mod_sdk/** | 运行时: Python 3.10+
# 职责说明: 提供 MOD SDK 权威配置加载、能力萃取、单趟差分漂移比对与通用路径解析
# 退出语义与设计依据: 纯库模块，无进程退出码 | 设计依据: AGENTS.md 单一真源收口与 DRY 消除代码克隆
# ------------------------------------------------------------------------------
# 用法示例:
#   from lib.mod_sdk_shared import extract_capabilities, check_contract_drift
# ==============================================================================
"""MOD SDK 权威真源静态萃取与契约一致性共享核心模块。"""

from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import difflib
import json
import re
import sys

from lib.mod_sdk_render import (
    generate_autogen_spec_section,
    render_full_mod_spec,
)
__all__ = [
    "ContractDriftResult",
    "STANDARD_PLACEHOLDER_DOCS",
    "SUPPORTED_ERROR_CODES",
    "build_dual_track_placeholder_list",
    "check_contract_drift",
    "collect_placeholders_from_obj",
    "ensure_utf8_stdout",
    "extract_agent_hud_telemetry_capabilities",
    "extract_builtin_dag_ids",
    "extract_capabilities",
    "extract_destiny_capabilities",
    "extract_unified_protocol_capabilities",
    "format_capabilities_json",
    "generate_autogen_spec_section",
    "load_json_file",
    "render_full_mod_spec",
    "resolve_webgames_root",
]

STANDARD_PLACEHOLDER_DOCS: dict[str, str] = {
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

SUPPORTED_ERROR_CODES: list[str] = [
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


@dataclass(frozen=True, slots=True)
class ContractDriftResult:
    """契约漂移判定不可变结果载荷。"""

    is_clean: bool
    diff_messages: tuple[str, ...]


def ensure_utf8_stdout() -> None:
    """保障跨平台 UTF-8 控制台输出，避免 Windows GBK 崩溃。"""
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError) as exc:
            sys.stderr.write(f"[DEBUG] 控制台 UTF-8 重配置跳过: {exc}\n")


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
    return Path(__file__).resolve().parents[3]


def load_json_file(file_path: Path) -> dict[str, Any]:
    """读取指定 JSON 文件并解析为字典，遇到异常返回空字典。"""
    if not file_path.is_file():
        return {}
    try:
        content = file_path.read_text(encoding="utf-8")
        return json.loads(content)
    except Exception as exc:
        print(f"[WARN] 读取或解析 JSON 失败: {file_path} ({exc})", file=sys.stderr)
        return {}


def collect_placeholders_from_obj(obj: Any, pattern: re.Pattern[str]) -> list[str]:
    """递归遍历对象中的所有字符串字段，提取占位符标识。"""
    placeholders: list[str] = []
    if isinstance(obj, str):
        placeholders.extend(pattern.findall(obj))
    elif isinstance(obj, dict):
        for val in obj.values():
            placeholders.extend(collect_placeholders_from_obj(val, pattern))
    elif isinstance(obj, list):
        for item in obj:
            placeholders.extend(collect_placeholders_from_obj(item, pattern))
    return placeholders


def build_dual_track_placeholder_list(upper_keys: list[str]) -> list[str]:
    """构建包含大写与小写双轨形式的占位符列表。"""
    result: list[str] = []
    for ph in upper_keys:
        if ph not in result:
            result.append(ph)
        lower_ph = ph.lower()
        if lower_ph not in result:
            result.append(lower_ph)
    return result


def _collect_dag_id_from_list(items: list[Any], found_ids: set[str]) -> None:
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


def extract_builtin_dag_ids(config_dir: Path) -> list[str]:
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


def extract_destiny_capabilities(config_dir: Path, core_data: dict[str, Any]) -> dict[str, Any]:
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
    builtin_dag_ids = extract_builtin_dag_ids(config_dir)

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
    dual_placeholders = build_dual_track_placeholder_list(upper_placeholders)

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


def extract_agent_hud_telemetry_capabilities(config_dir: Path) -> dict[str, Any]:
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


def extract_unified_protocol_capabilities(config_dir: Path) -> dict[str, Any]:
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


def extract_capabilities(webgames_root: Path) -> dict[str, Any]:
    """执行核心能力静态萃取流水线。"""
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

    available_placeholders: dict[str, str] = dict(STANDARD_PLACEHOLDER_DOCS)
    for ph in found_placeholders:
        if ph not in available_placeholders:
            clean_name = ph.strip("{}")
            available_placeholders[ph] = (
                f"剧情本地化占位符: {clean_name}（支持大小写双轨：{{{clean_name.lower()}}} 与 {ph}）"
            )

    supported_placeholders = build_dual_track_placeholder_list(
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

    destiny_mod_capabilities = extract_destiny_capabilities(config_dir, core_data)
    agent_hud_telemetry_capabilities = extract_agent_hud_telemetry_capabilities(
        config_dir
    )
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
        "workbench_capabilities": {
            "supported_package_formats": [
                ".kmod",
                ".kdat",
                "DIRECTORY",
            ],
            "supported_actions": [
                "init",
                "check",
                "pack",
                "play",
                "workbench",
                "verify",
                "bake",
                "self-test",
            ],
            "supported_compression": "ZIP_DEFLATE",
            "hash_algorithm": "SHA256",
        },
    }


def format_capabilities_json(capabilities: dict[str, Any]) -> str:
    """将能力数据序列化为规整的 JSON 字符串（LF 换行，2 空格缩进）。"""
    return json.dumps(capabilities, indent=2, ensure_ascii=False) + "\n"


def check_contract_drift(webgames_root: Path, capabilities: dict[str, Any]) -> tuple[bool, list[str]]:
    """比对磁盘既有文件与内存萃取结果，检测契约漂移。"""
    mod_sdk_dir = webgames_root / "mod_sdk"
    cap_path = mod_sdk_dir / "capabilities.json"
    spec_path = mod_sdk_dir / "MOD_SPEC.md"

    diff_messages: list[str] = []

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
                "capabilities.json 契约漂移:\n" + "".join(diff_lines[:30])
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
            diff_messages.append("MOD_SPEC.md 契约漂移:\n" + "".join(diff_lines[:30]))

    return len(diff_messages) == 0, diff_messages
