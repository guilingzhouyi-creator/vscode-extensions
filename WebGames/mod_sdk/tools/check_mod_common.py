#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Tools)
# 文件路径: WebGames/mod_sdk/tools/check_mod_common.py
# 架构定位: MOD静态检查器基础模型与常量契约单源 (Mod Checker Common Models & Constants)
# 依赖与触发: 触发方: check_mod.py / check_mod_dag.py / check_mod_multi.py | 运行时: Python 3.10+
# 职责说明: 提供 DiagnosticItem 诊断模型、参数正则表达式、白名单占位符以及安全 JSON 加载基础能力
# 退出语义与设计依据: 纯数据结构与基础无害 I/O 辅助函数 | 设计依据: 《卡拉尔数据契约规范 v1.0》
# ==============================================================================
"""MOD 检查器基础模型、白名单常量与工具函数。"""

from __future__ import annotations
from pathlib import Path
from typing import Any
import json
import re
import sys
# ==============================================================================
# 一、全局白名单常量与命途数值边界不变量契约 (Constants & Budget Invariants)
# ==============================================================================
_BASE_PLACEHOLDER_NAMES: tuple[str, ...] = (
    "player_name", "race", "gender", "level", "world_id", "town",
    "gold", "cur", "max", "name", "status", "desc",
    "beast_count", "reward_gold", "loss_soldiers", "loss_gold", "gain_gold",
    "character_name", "character_id", "race_id", "start_location",
    "initial_equipment", "npc_target", "event_result", "origin_id",
    "origin_name", "birth_region", "trait_summary", "starter_kit_name",
    "initial_gold",
)
WHITELISTED_PLACEHOLDERS: frozenset[str] = frozenset(
    [p.lower() for p in _BASE_PLACEHOLDER_NAMES] + [p.upper() for p in _BASE_PLACEHOLDER_NAMES]
)
PARAM_REGEX: re.Pattern[str] = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")
REQUIRED_MANIFEST_FIELDS: tuple[str, ...] = (
    "pack_id", "pack_name", "version", "author", "engine_api_version",
    "priority", "dependencies", "incompatible_packs", "semantic_tags", "is_active",
)

DEFAULT_ATTRIBUTE_KEYS: frozenset[str] = frozenset({"STR", "CON", "INT", "AGI", "SPR", "VIT"})
DEFAULT_UI_SELECTION_MODES: frozenset[str] = frozenset({"INHERIT", "ALLOW_MANUAL", "FORCE_RANDOM"})
DEFAULT_BUILTIN_DAG_IDS: frozenset[str] = frozenset({
    "DAG_PROLOGUE_ELF_SANCTUARY",
    "DAG_PROLOGUE_HUMAN_CAPITAL",
})
DEFAULT_BUILTIN_STARTER_KITS: frozenset[str] = frozenset({
    "KIT_ELF_DEFAULT",
    "KIT_HUMAN_DEFAULT",
})
DEFAULT_BUILTIN_TRAIT_COSTS: dict[str, int] = {
    "PRIMORDIAL_RESONANCE": 3, "GIANT_MIGHT": 2, "IRON_WILL": 1,
    "HEART_CORE_FISSURE": -3, "MANA_INSULATED": -2,
}


def load_capabilities_json() -> dict[str, Any]:
    """从 mod_sdk/capabilities.json 单一真源读取引擎能力声明，缺失时返回空字典。"""
    cap_path = Path(__file__).resolve().parent.parent / "capabilities.json"
    if not cap_path.is_file():
        return {}
    try:
        parsed = json.loads(cap_path.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _load_frozenset_capability(cap_data: dict[str, Any], key: str, fallback: frozenset[str]) -> frozenset[str]:
    """从 destiny_mod_capabilities 提取字符串集合，若缺失或为空则回退安全默认值。"""
    destiny_caps = cap_data.get("destiny_mod_capabilities", {})
    if isinstance(destiny_caps, dict):
        raw_list = destiny_caps.get(key)
        if isinstance(raw_list, list) and raw_list:
            cleaned = {str(entry).strip() for entry in raw_list if str(entry).strip()}
            if cleaned:
                return frozenset(cleaned)
    return fallback


def _load_trait_costs(cap_data: dict[str, Any]) -> dict[str, int]:
    """结合 capabilities.json、角色创建配置与官方基础模组包加载内置天赋因果花费映射表。"""
    cost_map = dict(DEFAULT_BUILTIN_TRAIT_COSTS)
    webgames_root = Path(__file__).resolve().parent.parent.parent
    cc_core = webgames_root / "config" / "domains" / "character_creation" / "core.json"
    if cc_core.is_file():
        try:
            cc_data = json.loads(cc_core.read_text(encoding="utf-8"))
            traits_cfg = cc_data.get("traits", {}) if isinstance(cc_data, dict) else {}
            if isinstance(traits_cfg, dict):
                for trait_id, trait_meta in traits_cfg.items():
                    if isinstance(trait_meta, dict) and isinstance(trait_meta.get("cost"), int):
                        cost_map[str(trait_id)] = int(trait_meta["cost"])
        except (json.JSONDecodeError, OSError) as exc:
            sys.stderr.write(f"[WARN] 读取 {cc_core} 失败，回退默认天赋花费映射: {exc}\n")
    official_destinies = webgames_root / "mods" / "official_kalar" / "destinies.json"
    if official_destinies.is_file():
        try:
            dest_data = json.loads(official_destinies.read_text(encoding="utf-8"))
            for trait_meta in dest_data.get("custom_traits", []):
                if isinstance(trait_meta, dict) and isinstance(trait_meta.get("cost"), int):
                    tid = str(trait_meta.get("trait_id") or trait_meta.get("id") or "")
                    if tid:
                        cost_map[tid] = int(trait_meta["cost"])
        except (json.JSONDecodeError, OSError) as exc:
            sys.stderr.write(f"[WARN] 读取 {official_destinies} 失败，跳过官方天赋花费覆盖: {exc}\n")
    return cost_map


_CAPABILITIES_CACHE: dict[str, Any] = load_capabilities_json()
VALID_ATTRIBUTE_KEYS: frozenset[str] = _load_frozenset_capability(
    _CAPABILITIES_CACHE, "attribute_keys", DEFAULT_ATTRIBUTE_KEYS
)
VALID_UI_SELECTION_MODES: frozenset[str] = DEFAULT_UI_SELECTION_MODES
_ui_modes_raw = _CAPABILITIES_CACHE.get("destiny_mod_capabilities", {}).get("ui_capability_modes", {})
if isinstance(_ui_modes_raw, dict) and isinstance(_ui_modes_raw.get("origin_selection_mode"), list):
    _parsed_modes = {str(m).strip() for m in _ui_modes_raw["origin_selection_mode"] if str(m).strip()}
    if _parsed_modes:
        VALID_UI_SELECTION_MODES = frozenset(_parsed_modes)

BUILTIN_DAG_IDS: frozenset[str] = _load_frozenset_capability(
    _CAPABILITIES_CACHE, "builtin_dag_ids", DEFAULT_BUILTIN_DAG_IDS
)
BUILTIN_STARTER_KITS: frozenset[str] = _load_frozenset_capability(
    _CAPABILITIES_CACHE, "builtin_starter_kits", DEFAULT_BUILTIN_STARTER_KITS
)
BUILTIN_TRAIT_COSTS: dict[str, int] = _load_trait_costs(_CAPABILITIES_CACHE)


def ensure_utf8_stdout() -> None:
    """保障跨平台 UTF-8 控制台输出，防止 Windows GBK 编码崩溃。"""
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


class DiagnosticItem:
    """结构化诊断发现项：包含错误码、文件路径、违规详情与面向 Agent 的自愈修复建议。"""

    def __init__(self, code: str, file_path: str, detail: str, fix_suggestion: str) -> None:
        self.code = code
        self.file = file_path
        self.detail = detail
        self.fix_suggestion = fix_suggestion

    def to_dict(self) -> dict[str, str]:
        """将诊断条目序列化为结构化字典。"""
        return {"code": self.code, "file": self.file, "detail": self.detail, "fix_suggestion": self.fix_suggestion}


def add_diag(diags: list[DiagnosticItem], code: str, file_path: str, detail: str, fix_suggestion: str) -> None:
    """向诊断列表追加一条结构化违规记录。"""
    diags.append(DiagnosticItem(code=code, file_path=file_path, detail=detail, fix_suggestion=fix_suggestion))


def safe_load_json(file_path: Path, rel_name: str, diags: list[DiagnosticItem]) -> Any:
    """安全读取并解析 JSON 文件，文件缺失或语法损坏时登记自愈诊断。"""
    if not file_path.is_file():
        add_diag(diags, "ERR_FILE_MISSING", rel_name, f"必备文件不存在: {rel_name}", f"请通过 scaffold_mod.py 或手动创建 {rel_name}")
        return None
    try:
        return json.loads(file_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        add_diag(diags, "ERR_JSON_INVALID", rel_name, f"JSON 解析失败: {exc}", f"请检查 {rel_name} 的 JSON 语法正确性与逗号/引号匹配")
        return None


def normalize_named_items(raw_collection: Any, id_field: str) -> list[dict[str, Any]]:
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
