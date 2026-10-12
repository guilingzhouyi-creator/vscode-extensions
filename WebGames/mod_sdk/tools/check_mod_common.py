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

import json
import re
import sys
from pathlib import Path
from typing import Any

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
VALID_ATTRIBUTE_KEYS: frozenset[str] = frozenset({"STR", "CON", "INT", "AGI", "SPR", "VIT"})
VALID_UI_SELECTION_MODES: frozenset[str] = frozenset({"INHERIT", "ALLOW_MANUAL", "FORCE_RANDOM"})
BUILTIN_DAG_IDS: frozenset[str] = frozenset({
    "DAG_PROLOGUE_ELF_SANCTUARY",
    "DAG_PROLOGUE_HUMAN_CAPITAL",
})
BUILTIN_STARTER_KITS: frozenset[str] = frozenset({
    "KIT_ELF_DEFAULT",
    "KIT_HUMAN_DEFAULT",
})
BUILTIN_TRAIT_COSTS: dict[str, int] = {
    "PRIMORDIAL_RESONANCE": 3, "GIANT_MIGHT": 2, "IRON_WILL": 1,
    "HEART_CORE_FISSURE": -3, "MANA_INSULATED": -2,
}


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
    except (json.JSONDecodeError, OSError) as err:
        add_diag(diags, "ERR_JSON_INVALID", rel_name, f"JSON 解析失败: {err}", f"请检查 {rel_name} 的 JSON 语法正确性与逗号/引号匹配")
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
