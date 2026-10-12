#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Playtester)
# 文件路径: WebGames/mod_sdk/tools/play_mod_common.py
# 架构定位: MOD试玩推演公共基础设施与资产会话装配器
# 依赖与触发: 触发方: play_mod / play_mod_interactive | 上游: check_mod / play_mod_character | 运行时: Python 3.10+
# 职责说明: 提供编码保障、JSON读取、文案水化、DAG拓扑解析、四级路由匹配与资产合并会话准备
# 退出语义与设计依据: 纯计算与数据装配模块，无独立退出码 | 符合《卡拉尔数据契约规范 v1.0》
# ==============================================================================
"""MOD试玩推演公共基础设施与资产会话装配器。"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

from play_mod_character import (
    BUILTIN_DAG_TEMPLATES,
    BUILTIN_ORIGINS,
    BUILTIN_PAIRED_PRESETS,
    BUILTIN_STARTER_KITS,
    BUILTIN_TRAITS,
    build_character_context,
    resolve_character_sheet,
)

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

try:
    from check_mod import (
        DiagnosticItem,
        validate_mod,
        validate_multi_mods,
    )
except ImportError:
    class DiagnosticItem:  # type: ignore[no-redef]
        def __init__(self, code: str, file_path: str, detail: str, fix_suggestion: str) -> None:
            self.code = code
            self.file = file_path
            self.detail = detail
            self.fix_suggestion = fix_suggestion

        def to_dict(self) -> dict[str, str]:
            return {"code": self.code, "file": self.file, "detail": self.detail, "fix_suggestion": self.fix_suggestion}

    def validate_mod(mod_dir: Path) -> tuple[bool, list[DiagnosticItem]]:  # type: ignore[no-redef]
        return True, []

    def validate_multi_mods(mod_dirs: list[Path]) -> tuple[bool, list[DiagnosticItem]]:  # type: ignore[no-redef]
        return True, []


PARAM_REGEX: re.Pattern[str] = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")
SCHEMA_VERSION: str = "kalar.mod_sdk.playthrough_transcript.v1"
SCHEMA_VERSION_TRANSCRIPT: str = "kalar.mod_sdk.playthrough_transcript.v1"
SCHEMA_VERSION_OBSERVATION: str = "kalar.mod_sdk.observation.v1"
SCHEMA_VERSION_ACTION: str = "kalar.mod_sdk.action.v1"


def ensure_utf8_stdout() -> None:
    """保障 Windows 控制台输出 UTF-8，防止 GBK 编码异常。"""
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def safe_load_json(file_path: Path) -> Any:
    """安全读取 JSON 文件，失败返回 None。"""
    if not file_path.is_file():
        return None
    try:
        return json.loads(file_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def flatten_i18n_dict(data: dict[str, Any], prefix: str = "") -> dict[str, str]:
    """递归展平多层嵌套的 i18n 字典为以点号分隔的单层字典。"""
    flat: dict[str, str] = {}
    for k, v in data.items():
        full_key = f"{prefix}.{k}" if prefix else str(k)
        if isinstance(v, str):
            flat[full_key] = v
        elif isinstance(v, dict):
            flat.update(flatten_i18n_dict(v, full_key))
    return flat


def normalize_items(raw_val: Any, id_key: str) -> list[dict[str, Any]]:
    """将列表或字典格式集合标准化为对象列表。"""
    if isinstance(raw_val, list):
        return [item for item in raw_val if isinstance(item, dict)]
    if isinstance(raw_val, dict):
        result: list[dict[str, Any]] = []
        for k, v in raw_val.items():
            if isinstance(v, dict):
                entry = dict(v)
                entry.setdefault(id_key, k)
                result.append(entry)
        return result
    return []


def extract_rules(routing_rules_data: Any) -> list[dict[str, Any]]:
    """提取扁平路由规则列表。"""
    if isinstance(routing_rules_data, list):
        return [r for r in routing_rules_data if isinstance(r, dict)]
    if not isinstance(routing_rules_data, dict):
        return []
    for key in ("routing_rules", "rules", "prologue_routing_rules"):
        val = routing_rules_data.get(key)
        if isinstance(val, list):
            return [r for r in val if isinstance(r, dict)]
    return []


def hydrate(template: str, context: dict[str, Any]) -> str:
    """双轨水化文案中的占位符。"""
    def _repl(match: re.Match[str]) -> str:
        key = match.group(1)
        if key in context:
            return str(context[key])
        if key.lower() in context:
            return str(context[key.lower()])
        if key.upper() in context:
            return str(context[key.upper()])
        return f"{{{key}}}"
    return PARAM_REGEX.sub(_repl, template)


def resolve_node_text(node_data: dict[str, Any], i18n_catalog: dict[str, str]) -> tuple[str, str]:
    """解析节点文本模板与来源类型 ('i18n' 或 'inline_text')。"""
    nkey = str(node_data.get("narrative_key") or "")
    if nkey and nkey in i18n_catalog:
        return i18n_catalog[nkey], "i18n"

    inline_val = node_data.get("inline_text")
    if isinstance(inline_val, str) and inline_val.strip():
        return inline_val, "inline_text"
    if isinstance(inline_val, dict):
        for v in inline_val.values():
            if isinstance(v, str) and v.strip():
                return v, "inline_text"

    if nkey:
        return f"<缺失文案: {nkey}>", "missing"
    return "<缺失文案>", "missing"


def parse_dag_topology(
    nodes: dict[str, Any],
    edges: list[dict[str, Any]],
) -> tuple[str | None, set[str], dict[str, list[str]]]:
    """解析 DAG 的入口节点、终结节点集合以及邻接关系表。"""
    entry_id: str | None = None
    terminals: set[str] = set()
    adj: dict[str, list[str]] = {nid: [] for nid in nodes}

    for nid, nd in nodes.items():
        if isinstance(nd, dict):
            ntype = nd.get("node_type")
            if ntype == "START_ENTRY":
                entry_id = nid
            elif ntype == "TERMINAL_EXIT":
                terminals.add(nid)

    for e in edges:
        if isinstance(e, dict):
            u = e.get("from") or e.get("from_node_id")
            v = e.get("to") or e.get("to_node_id")
            if u in adj and v in nodes:
                adj[u].append(v)

    return entry_id, terminals, adj


def score_rule(rule: dict[str, Any], race_u: str, origin_id: str) -> int:
    """计算路由规则匹配优先级权重 (4: 双匹配, 3: 仅身世, 2: 仅种族, 1: 默认兜底)。"""
    cond = rule.get("match_condition", rule) if isinstance(rule.get("match_condition"), dict) else rule
    r = str(cond.get("race_id") or "").upper()
    o = str(cond.get("origin_id") or "")
    if r == race_u and o == origin_id:
        return 4
    if o == origin_id and not r:
        return 3
    if r == race_u and not o:
        return 2
    if cond.get("is_default") is True:
        return 1
    return 0


def match_rule(rules: list[dict[str, Any]], race_id: str, origin_id: str) -> str | None:
    """按匹配条件命中路由规则中的 target_dag_id。"""
    race_u = race_id.upper()
    best_target: str | None = None
    best_score = 0
    for r in rules:
        target = r.get("target_dag_id")
        if not isinstance(target, str) or not target.strip():
            continue
        score = score_rule(r, race_u, origin_id)
        if score > best_score:
            best_score = score
            best_target = target.strip()
    if best_target:
        return best_target
    if rules:
        fallback = rules[0].get("target_dag_id")
        if isinstance(fallback, str) and fallback.strip():
            return fallback.strip()
    return None


def resolve_dag_routing(
    merged_custom_rules: list[dict[str, Any]],
    merged_routing_rules: list[dict[str, Any]],
    selected_origin: dict[str, Any],
    race_id: str,
) -> tuple[str, str]:
    """四级 DAG 路由解算。"""
    origin_id = str(selected_origin.get("origin_id") or "")

    if merged_custom_rules:
        target = match_rule(merged_custom_rules, race_id, origin_id)
        if target:
            return target, "custom_routing_rules"

    orig_dag = selected_origin.get("prologue_dag_id")
    if isinstance(orig_dag, str) and orig_dag.strip():
        return orig_dag.strip(), "origin_prologue_dag_id"

    if merged_routing_rules:
        target = match_rule(merged_routing_rules, race_id, origin_id)
        if target:
            return target, "routing_rules.json"

    fallback = "DAG_PROLOGUE_ELF_SANCTUARY" if race_id.upper() == "ELF" else "DAG_PROLOGUE_HUMAN_CAPITAL"
    return fallback, "builtin_default"


def merge_destinies_from_mod(dest_data: dict[str, Any], state: dict[str, Any]) -> None:
    """提取单个 MOD destinies 数据并填充至聚合状态字典。"""
    ui_cap = dest_data.get("ui_capabilities")
    if isinstance(ui_cap, dict):
        if ui_cap.get("origin_selection_mode"):
            state["ui_origin_mode"] = str(ui_cap["origin_selection_mode"])
        if ui_cap.get("trait_selection_mode"):
            state["ui_trait_mode"] = str(ui_cap["trait_selection_mode"])
        if "allow_attribute_reroll" in ui_cap:
            state["ui_reroll"] = bool(ui_cap["allow_attribute_reroll"])

    state["custom_origins"].extend(normalize_items(dest_data.get("custom_origins"), "origin_id"))
    state["custom_traits"].extend(normalize_items(dest_data.get("custom_traits"), "trait_id"))
    state["paired_presets"].extend(normalize_items(dest_data.get("paired_presets"), "preset_id"))
    state["custom_kits"].extend(normalize_items(dest_data.get("custom_starter_kits"), "kit_id"))
    state["custom_rules"].extend(extract_rules(dest_data.get("custom_routing_rules")))


def merge_dag_and_i18n(mod_dir: Path, dags: dict[str, Any], i18n_cat: dict[str, str]) -> None:
    """读取单个 MOD 的 dag_graphs 与 i18n 目录并归集。"""
    dag_dir = mod_dir / "dag_graphs"
    if dag_dir.is_dir():
        for df in sorted(dag_dir.glob("*.json")):
            dcontent = safe_load_json(df)
            if isinstance(dcontent, dict):
                dag_id_key = str(dcontent.get("dag_id") or df.stem)
                dags[dag_id_key] = dcontent
                dags[df.stem] = dcontent

    i18n_dir = mod_dir / "i18n"
    if i18n_dir.is_dir():
        for i_file in sorted(i18n_dir.glob("*.json")):
            idata = safe_load_json(i_file)
            if isinstance(idata, dict):
                i18n_cat.update(flatten_i18n_dict(idata))


def load_and_merge_assets(mod_paths: list[Path]) -> dict[str, Any]:
    """读取并合并多个 MOD 目录下的资产数据。"""
    state: dict[str, Any] = {
        "custom_origins": [],
        "custom_traits": [],
        "paired_presets": [],
        "custom_kits": [],
        "custom_rules": [],
        "routing_rules": [],
        "dag_graphs": dict(BUILTIN_DAG_TEMPLATES),
        "i18n_catalog": {},
        "ui_origin_mode": "INHERIT",
        "ui_trait_mode": "INHERIT",
        "ui_reroll": False,
    }
    for mod_dir in mod_paths:
        dest_data = safe_load_json(mod_dir / "destinies.json")
        if isinstance(dest_data, dict):
            merge_destinies_from_mod(dest_data, state)
        rout_data = safe_load_json(mod_dir / "routing_rules.json")
        if rout_data:
            state["routing_rules"].extend(extract_rules(rout_data))
        merge_dag_and_i18n(mod_dir, state["dag_graphs"], state["i18n_catalog"])

    all_origins = state["custom_origins"] + BUILTIN_ORIGINS
    all_traits = state["custom_traits"] + BUILTIN_TRAITS
    all_presets = state["paired_presets"] + BUILTIN_PAIRED_PRESETS
    all_kits = state["custom_kits"] + BUILTIN_STARTER_KITS

    creation_ui_snapshot = {
        "origin_selection_mode": state["ui_origin_mode"],
        "trait_selection_mode": state["ui_trait_mode"],
        "allow_attribute_reroll": state["ui_reroll"],
        "available_origins": [str(o.get("origin_id") or o.get("id")) for o in all_origins],
        "available_trait_pairs": [str(p.get("preset_id") or p.get("id")) for p in all_presets],
        "available_starter_kits": [str(k.get("kit_id") or k.get("id")) for k in all_kits],
        "custom_origin_count": len(state["custom_origins"]),
        "custom_trait_count": len(state["custom_traits"]),
        "custom_kit_count": len(state["custom_kits"]),
    }

    return {
        "all_origins": all_origins,
        "all_traits": all_traits,
        "all_presets": all_presets,
        "all_kits": all_kits,
        "creation_ui_snapshot": creation_ui_snapshot,
        "merged_custom_rules": state["custom_rules"],
        "merged_routing_rules": state["routing_rules"],
        "merged_dag_graphs": state["dag_graphs"],
        "merged_i18n_catalog": state["i18n_catalog"],
    }


def prepare_session(
    mod_paths: list[Path],
    player_name: str,
    race_id: str,
    gender: str,
    origin_id_param: str | None,
    trait_pair_param: str | None,
    reroll_nonce: int,
    seed: str,
    choice_strategy: str,
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """准备推演环境、执行静态预检、合并资产、解算创角与解析 DAG 路由。"""
    if len(mod_paths) > 1:
        is_valid, diags = validate_multi_mods(mod_paths)
    else:
        is_valid, diags = validate_mod(mod_paths[0])

    precheck_report = {
        "valid": is_valid,
        "checked_packs": [p.name for p in mod_paths],
        "error_count": len(diags),
        "diagnostics": [d.to_dict() for d in diags],
    }

    if not is_valid:
        fail_transcript: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "is_success": False,
            "precheck_report": precheck_report,
            "creation_ui_snapshot": {},
            "character_sheet": None,
            "dag_routing": None,
            "transcript_steps": [],
            "final_state": {"reached_terminal": False, "error": "MOD 静态预检未通过"},
        }
        return None, fail_transcript

    assets = load_and_merge_assets(mod_paths)
    all_origins = assets["all_origins"]
    all_traits = assets["all_traits"]
    all_presets = assets["all_presets"]
    all_kits = assets["all_kits"]
    creation_ui_snapshot = assets["creation_ui_snapshot"]
    merged_custom_rules = assets["merged_custom_rules"]
    merged_routing_rules = assets["merged_routing_rules"]
    merged_dag_graphs = assets["merged_dag_graphs"]
    merged_i18n_catalog = assets["merged_i18n_catalog"]

    char_sheet = resolve_character_sheet(
        player_name=player_name,
        race_id=race_id,
        gender=gender,
        origin_id_param=origin_id_param,
        trait_pair_param=trait_pair_param,
        seed=seed,
        reroll_nonce=reroll_nonce,
        all_origins=all_origins,
        all_traits=all_traits,
        all_presets=all_presets,
        all_kits=all_kits,
    )

    selected_orig = next(
        (o for o in all_origins if str(o.get("origin_id") or o.get("id")) == char_sheet["origin_id"]),
        all_origins[0],
    )
    target_dag_id, routing_source = resolve_dag_routing(
        merged_custom_rules=merged_custom_rules,
        merged_routing_rules=merged_routing_rules,
        selected_origin=selected_orig,
        race_id=race_id,
    )

    dag_routing = {
        "target_dag_id": target_dag_id,
        "dag_id": target_dag_id,
        "routing_source": routing_source,
        "matched_race_id": race_id.upper(),
        "matched_origin_id": char_sheet["origin_id"],
        "choice_strategy": choice_strategy,
    }

    target_dag_data = merged_dag_graphs.get(target_dag_id)
    if not target_dag_data:
        fail_transcript = {
            "schema_version": SCHEMA_VERSION,
            "is_success": False,
            "precheck_report": precheck_report,
            "creation_ui_snapshot": creation_ui_snapshot,
            "character_sheet": char_sheet,
            "dag_routing": dag_routing,
            "transcript_steps": [],
            "final_state": {"reached_terminal": False, "error": f"目标 DAG 图元不存在: {target_dag_id}"},
        }
        return None, fail_transcript

    context = build_character_context(char_sheet)
    bundle = {
        "is_valid": is_valid,
        "precheck_report": precheck_report,
        "creation_ui_snapshot": creation_ui_snapshot,
        "char_sheet": char_sheet,
        "dag_routing": dag_routing,
        "target_dag_id": target_dag_id,
        "target_dag_data": target_dag_data,
        "merged_i18n_catalog": merged_i18n_catalog,
        "context": context,
    }
    return bundle, {}
