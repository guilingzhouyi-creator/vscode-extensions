#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Playtester)
# 文件路径: WebGames/mod_sdk/tools/play_mod_interactive.py
# 架构定位: MOD长程交互式单步推演会话驱动器 (Agent Interactive Session Runner)
# 依赖与触发: 触发方: play_mod / kalar_mod --interactive | 上游: play_mod_common | 运行时: Python 3.10+
# 职责说明: 提供基于 stdio 的 Agent 长程交互式单步推演会话、状态栈回滚与动作协议派发
# 退出语义与设计依据: 会话驱动函数返回 (transcript, is_success) | 符合《卡拉尔数据契约规范 v1.0》
# ==============================================================================
"""MOD长程交互式单步推演会话驱动器。"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any

from play_mod_common import (
    SCHEMA_VERSION,
    SCHEMA_VERSION_ACTION,
    SCHEMA_VERSION_OBSERVATION,
    hydrate,
    parse_dag_topology,
    prepare_session,
    resolve_node_text,
)


def build_observation_payload(
    session_id: str,
    step_index: int,
    current_node_id: str | None,
    node_type: str,
    narrative_key: str,
    text_source: str,
    raw_text: str,
    hydrated_text: str,
    available_choices: list[str],
    character_snapshot: dict[str, Any],
    applied_mutations: list[dict[str, Any]],
    history_depth: int,
    is_terminal: bool,
    error_code: str | None = None,
    error_message: str | None = None,
    background_asset: str | None = None,
    bgm_asset: str | None = None,
) -> dict[str, Any]:
    """构造符合 kalar.mod_sdk.observation.v1 标准契约的单步观测包字典。"""
    payload: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION_OBSERVATION,
        "session_id": session_id,
        "step_index": step_index,
        "current_node_id": current_node_id,
        "node_type": node_type,
        "narrative_key": narrative_key,
        "text_source": text_source,
        "raw_text": raw_text,
        "hydrated_text": hydrated_text,
        "available_choices": available_choices,
        "character_snapshot": character_snapshot,
        "applied_mutations": applied_mutations,
        "history_depth": history_depth,
        "is_terminal": is_terminal,
        "error_code": error_code,
        "error_message": error_message,
    }
    if background_asset is not None:
        payload["background_asset"] = background_asset
    if bgm_asset is not None:
        payload["bgm_asset"] = bgm_asset
    return payload


def emit_json_line(data: dict[str, Any]) -> None:
    """输出单行 JSON 数据包至标准输出并立即刷新缓冲区。"""
    print(json.dumps(data, ensure_ascii=False))
    sys.stdout.flush()


def apply_single_mutation(m: dict[str, Any], char_state: dict[str, Any], context: dict[str, Any]) -> None:
    """结算单个突变事件。"""
    mtype = m.get("type")
    if mtype == "GoldGranted":
        amt = int(m.get("amount", 0))
        char_state["gold"] = char_state.get("gold", 0) + amt
        context["gold"] = char_state["gold"]
        context["GOLD"] = char_state["gold"]
    elif mtype == "LocationAssigned":
        loc = str(m.get("location") or "")
        if loc:
            char_state["birth_region"] = loc
            context["start_location"] = loc
            context["START_LOCATION"] = loc
    elif mtype == "EquipmentGranted":
        item = str(m.get("item_id") or "")
        if item:
            char_state["initial_equipment"] = item
            context["initial_equipment"] = item
            context["INITIAL_EQUIPMENT"] = item


def apply_mutations_to_state(
    mutations: list[dict[str, Any]],
    char_state: dict[str, Any],
    context: dict[str, Any],
) -> None:
    """结算步骤中触发的状态突变并同步更新角色快照与水化上下文。"""
    for m in mutations:
        if isinstance(m, dict):
            apply_single_mutation(m, char_state, context)


def parse_action_input(line: str) -> tuple[dict[str, Any] | None, str | None]:
    """安全解析 Agent 发送的动作 JSON 行。"""
    line_clean = line.strip()
    if not line_clean:
        return None, None
    try:
        data = json.loads(line_clean)
        if not isinstance(data, dict):
            return None, "动作包格式错误：必须为 JSON 对象"
        return data, None
    except Exception as exc:
        return None, f"JSON 语法解析失败: {exc}"


def resolve_choice_target(choice_id_val: Any, available: list[str]) -> str | None:
    """解析 Agent 决策目标，兼容节点 ID 字符串与 0-based 整数索引。"""
    if isinstance(choice_id_val, int) and 0 <= choice_id_val < len(available):
        return available[choice_id_val]
    choice_str = str(choice_id_val or "").strip()
    if choice_str in available:
        return choice_str
    if choice_str.isdigit() and 0 <= int(choice_str) < len(available):
        return available[int(choice_str)]
    return None


def handle_interactive_rollback(
    session_id: str,
    nodes: dict[str, Any],
    terminals: set[str],
    s_ctx: dict[str, Any],
) -> None:
    """执行交互历史栈回滚操作。"""
    history_stack = s_ctx["history_stack"]
    if not history_stack:
        err_obs = build_observation_payload(
            session_id=session_id,
            step_index=s_ctx["step_index"],
            current_node_id=s_ctx["curr"],
            node_type=s_ctx["ntype"],
            narrative_key=s_ctx["nkey"],
            text_source=s_ctx["text_source"],
            raw_text=s_ctx["raw_text"],
            hydrated_text=s_ctx["hydrated_text"],
            available_choices=s_ctx["choices"],
            character_snapshot=s_ctx["current_char"],
            applied_mutations=[],
            history_depth=0,
            is_terminal=s_ctx["is_term"],
            error_code="ERR_ROLLBACK_EMPTY_STACK",
            error_message="历史栈为空，已处于起始节点，无法继续回滚",
        )
        emit_json_line(err_obs)
        return

    prev_state = history_stack.pop()
    s_ctx["step_index"] = prev_state["step_index"]
    curr = prev_state["curr"]
    s_ctx["curr"] = curr
    nd = nodes.get(curr, {})
    s_ctx["ntype"] = str(nd.get("node_type", "UNKNOWN"))
    s_ctx["nkey"] = str(nd.get("narrative_key", ""))
    s_ctx["raw_text"] = prev_state["raw_text"]
    s_ctx["text_source"] = prev_state["text_source"]
    s_ctx["hydrated_text"] = prev_state["hydrated_text"]
    s_ctx["choices"] = list(prev_state["choices"])
    s_ctx["current_char"] = dict(prev_state["char"])
    s_ctx["context"] = dict(prev_state["context"])
    s_ctx["visited"] = list(prev_state["visited"])
    s_ctx["all_applied_mutations"] = list(prev_state["mutations"])
    s_ctx["transcript_steps"] = [dict(s) for s in prev_state["transcript_steps"]]
    s_ctx["is_term"] = (curr in terminals or s_ctx["ntype"] == "TERMINAL_EXIT")

    rollback_obs = build_observation_payload(
        session_id=session_id,
        step_index=s_ctx["step_index"],
        current_node_id=curr,
        node_type=s_ctx["ntype"],
        narrative_key=s_ctx["nkey"],
        text_source=s_ctx["text_source"],
        raw_text=s_ctx["raw_text"],
        hydrated_text=s_ctx["hydrated_text"],
        available_choices=s_ctx["choices"],
        character_snapshot=s_ctx["current_char"],
        applied_mutations=[],
        history_depth=len(history_stack),
        is_terminal=s_ctx["is_term"],
    )
    emit_json_line(rollback_obs)


def handle_interactive_choose(
    action_dict: dict[str, Any],
    session_id: str,
    nodes: dict[str, Any],
    adj: dict[str, list[str]],
    terminals: set[str],
    i18n_catalog: dict[str, str],
    s_ctx: dict[str, Any],
) -> bool:
    """执行交互单步分支推进操作，返回是否抵达终态。"""
    choices = s_ctx["choices"]
    choice_raw = action_dict.get("choice_id")
    target_node = resolve_choice_target(choice_raw, choices)
    history_stack = s_ctx["history_stack"]

    if not target_node:
        err_obs = build_observation_payload(
            session_id=session_id,
            step_index=s_ctx["step_index"],
            current_node_id=s_ctx["curr"],
            node_type=s_ctx["ntype"],
            narrative_key=s_ctx["nkey"],
            text_source=s_ctx["text_source"],
            raw_text=s_ctx["raw_text"],
            hydrated_text=s_ctx["hydrated_text"],
            available_choices=choices,
            character_snapshot=s_ctx["current_char"],
            applied_mutations=[],
            history_depth=len(history_stack),
            is_terminal=s_ctx["is_term"],
            error_code="ERR_INVALID_CHOICE",
            error_message=f"分支目标 '{choice_raw}' 不合法，可选分支列表: {choices}",
        )
        emit_json_line(err_obs)
        return False

    history_stack.append({
        "step_index": s_ctx["step_index"],
        "curr": s_ctx["curr"],
        "raw_text": s_ctx["raw_text"],
        "text_source": s_ctx["text_source"],
        "hydrated_text": s_ctx["hydrated_text"],
        "choices": list(choices),
        "char": dict(s_ctx["current_char"]),
        "context": dict(s_ctx["context"]),
        "visited": list(s_ctx["visited"]),
        "mutations": list(s_ctx["all_applied_mutations"]),
        "transcript_steps": [dict(s) for s in s_ctx["transcript_steps"]],
    })

    if s_ctx["transcript_steps"]:
        s_ctx["transcript_steps"][-1]["selected_next_node"] = target_node

    s_ctx["step_index"] += 1
    s_ctx["curr"] = target_node
    s_ctx["visited"].append(target_node)
    nd = nodes.get(target_node, {})
    ntype = str(nd.get("node_type", "UNKNOWN"))
    nkey = str(nd.get("narrative_key", ""))
    raw_text, text_source = resolve_node_text(nd, i18n_catalog)
    hydrated_text = hydrate(raw_text, s_ctx["context"])
    nxt_choices = list(adj.get(target_node, []))
    mutations = list(nd.get("mutations_on_complete", []))
    s_ctx["all_applied_mutations"].extend(mutations)
    apply_mutations_to_state(mutations, s_ctx["current_char"], s_ctx["context"])

    s_ctx["ntype"] = ntype
    s_ctx["nkey"] = nkey
    s_ctx["raw_text"] = raw_text
    s_ctx["text_source"] = text_source
    s_ctx["hydrated_text"] = hydrated_text
    s_ctx["choices"] = nxt_choices

    s_ctx["transcript_steps"].append({
        "step_index": s_ctx["step_index"],
        "branch_index": 1,
        "node_id": target_node,
        "node_type": ntype,
        "narrative_key": nkey,
        "text_source": text_source,
        "raw_text": raw_text,
        "hydrated_text": hydrated_text,
        "available_choices": nxt_choices,
        "selected_next_node": None,
        "mutations_on_complete": mutations,
    })

    is_term = (target_node in terminals or ntype == "TERMINAL_EXIT")
    s_ctx["is_term"] = is_term
    step_obs = build_observation_payload(
        session_id=session_id,
        step_index=s_ctx["step_index"],
        current_node_id=target_node,
        node_type=ntype,
        narrative_key=nkey,
        text_source=text_source,
        raw_text=raw_text,
        hydrated_text=hydrated_text,
        available_choices=nxt_choices,
        character_snapshot=s_ctx["current_char"],
        applied_mutations=mutations,
        history_depth=len(history_stack),
        is_terminal=is_term,
    )
    emit_json_line(step_obs)
    return is_term


def play_mod_interactive(
    mod_paths: list[Path],
    player_name: str,
    race_id: str,
    gender: str,
    origin_id_param: str | None,
    trait_pair_param: str | None,
    reroll_nonce: int,
    seed: str,
) -> tuple[dict[str, Any], bool]:
    """启动基于 stdio 的 Agent 长程交互式单步推演会话。"""
    session_id = f"SESSION_{hashlib.sha256(f'{seed}:{player_name}'.encode('utf-8')).hexdigest()[:12]}"

    bundle, fail_transcript = prepare_session(
        mod_paths=mod_paths,
        player_name=player_name,
        race_id=race_id,
        gender=gender,
        origin_id_param=origin_id_param,
        trait_pair_param=trait_pair_param,
        reroll_nonce=reroll_nonce,
        seed=seed,
        choice_strategy="interactive",
    )
    if bundle is None:
        err_msg = str(fail_transcript.get("final_state", {}).get("error", "预检或初始化失败"))
        err_obs = build_observation_payload(
            session_id=session_id,
            step_index=0,
            current_node_id=None,
            node_type="UNKNOWN",
            narrative_key="",
            text_source="system",
            raw_text="",
            hydrated_text=f"MOD 启动失败: {err_msg}",
            available_choices=[],
            character_snapshot={},
            applied_mutations=[],
            history_depth=0,
            is_terminal=True,
            error_code="ERR_PRECHECK_FAILED",
            error_message=err_msg,
        )
        emit_json_line(err_obs)
        return fail_transcript, False

    dag_data = bundle["target_dag_data"]
    nodes = dag_data.get("nodes", {})
    edges = dag_data.get("edges", [])
    i18n_catalog = bundle["merged_i18n_catalog"]
    context = dict(bundle["context"])
    current_char = dict(bundle["char_sheet"])
    current_char.setdefault("gold", current_char.get("initial_gold", 0))

    entry_id, terminals, adj = parse_dag_topology(nodes, edges)

    if not entry_id:
        fail_transcript = {
            "schema_version": SCHEMA_VERSION,
            "is_success": False,
            "precheck_report": bundle["precheck_report"],
            "creation_ui_snapshot": bundle["creation_ui_snapshot"],
            "character_sheet": current_char,
            "dag_routing": bundle["dag_routing"],
            "transcript_steps": [],
            "final_state": {"reached_terminal": False, "error": "DAG 缺少入口节点"},
        }
        err_obs = build_observation_payload(
            session_id=session_id,
            step_index=0,
            current_node_id=None,
            node_type="UNKNOWN",
            narrative_key="",
            text_source="system",
            raw_text="",
            hydrated_text="DAG 缺少入口节点",
            available_choices=[],
            character_snapshot=current_char,
            applied_mutations=[],
            history_depth=0,
            is_terminal=True,
            error_code="ERR_DAG_NO_ENTRY",
            error_message="DAG 缺少入口节点 (START_ENTRY)",
        )
        emit_json_line(err_obs)
        return fail_transcript, False

    curr = entry_id
    nd = nodes.get(curr, {})
    ntype = str(nd.get("node_type", "START_ENTRY"))
    nkey = str(nd.get("narrative_key", ""))
    raw_text, text_source = resolve_node_text(nd, i18n_catalog)
    hydrated_text = hydrate(raw_text, context)
    choices = list(adj.get(curr, []))
    mutations = list(nd.get("mutations_on_complete", []))

    apply_mutations_to_state(mutations, current_char, context)
    is_term = (curr in terminals or ntype == "TERMINAL_EXIT")

    s_ctx: dict[str, Any] = {
        "step_index": 0,
        "curr": curr,
        "ntype": ntype,
        "nkey": nkey,
        "raw_text": raw_text,
        "text_source": text_source,
        "hydrated_text": hydrated_text,
        "choices": choices,
        "current_char": current_char,
        "context": context,
        "visited": [curr],
        "all_applied_mutations": list(mutations),
        "transcript_steps": [{
            "step_index": 0,
            "branch_index": 1,
            "node_id": curr,
            "node_type": ntype,
            "narrative_key": nkey,
            "text_source": text_source,
            "raw_text": raw_text,
            "hydrated_text": hydrated_text,
            "available_choices": choices,
            "selected_next_node": None,
            "mutations_on_complete": mutations,
        }],
        "history_stack": [],
        "is_term": is_term,
    }

    step_0_obs = build_observation_payload(
        session_id=session_id,
        step_index=0,
        current_node_id=curr,
        node_type=ntype,
        narrative_key=nkey,
        text_source=text_source,
        raw_text=raw_text,
        hydrated_text=hydrated_text,
        available_choices=choices,
        character_snapshot=current_char,
        applied_mutations=mutations,
        history_depth=0,
        is_terminal=is_term,
    )
    emit_json_line(step_0_obs)

    while not s_ctx["is_term"]:
        line = sys.stdin.readline()
        if not line:
            break

        action_dict, parse_err = parse_action_input(line)
        if parse_err:
            err_obs = build_observation_payload(
                session_id=session_id,
                step_index=s_ctx["step_index"],
                current_node_id=s_ctx["curr"],
                node_type=s_ctx["ntype"],
                narrative_key=s_ctx["nkey"],
                text_source=s_ctx["text_source"],
                raw_text=s_ctx["raw_text"],
                hydrated_text=s_ctx["hydrated_text"],
                available_choices=s_ctx["choices"],
                character_snapshot=s_ctx["current_char"],
                applied_mutations=[],
                history_depth=len(s_ctx["history_stack"]),
                is_terminal=s_ctx["is_term"],
                error_code="ERR_ACTION_INVALID",
                error_message=parse_err,
            )
            emit_json_line(err_obs)
            continue

        if action_dict is None:
            continue

        req_session_id = action_dict.get("session_id")
        if req_session_id and str(req_session_id) != session_id:
            err_obs = build_observation_payload(
                session_id=session_id,
                step_index=s_ctx["step_index"],
                current_node_id=s_ctx["curr"],
                node_type=s_ctx["ntype"],
                narrative_key=s_ctx["nkey"],
                text_source=s_ctx["text_source"],
                raw_text=s_ctx["raw_text"],
                hydrated_text=s_ctx["hydrated_text"],
                available_choices=s_ctx["choices"],
                character_snapshot=s_ctx["current_char"],
                applied_mutations=[],
                history_depth=len(s_ctx["history_stack"]),
                is_terminal=s_ctx["is_term"],
                error_code="ERR_SESSION_MISMATCH",
                error_message=f"会话 ID 不匹配: 传入 '{req_session_id}', 当前 '{session_id}'",
            )
            emit_json_line(err_obs)
            continue

        act_type = str(action_dict.get("action_type") or action_dict.get("action") or "").strip().lower()

        if act_type == "quit":
            break

        if act_type == "rollback":
            handle_interactive_rollback(session_id, nodes, terminals, s_ctx)
            continue

        if act_type == "choose":
            handle_interactive_choose(action_dict, session_id, nodes, adj, terminals, i18n_catalog, s_ctx)
            continue

        err_obs = build_observation_payload(
            session_id=session_id,
            step_index=s_ctx["step_index"],
            current_node_id=s_ctx["curr"],
            node_type=s_ctx["ntype"],
            narrative_key=s_ctx["nkey"],
            text_source=s_ctx["text_source"],
            raw_text=s_ctx["raw_text"],
            hydrated_text=s_ctx["hydrated_text"],
            available_choices=s_ctx["choices"],
            character_snapshot=s_ctx["current_char"],
            applied_mutations=[],
            history_depth=len(s_ctx["history_stack"]),
            is_terminal=s_ctx["is_term"],
            error_code="ERR_UNKNOWN_ACTION_TYPE",
            error_message=f"不支持的动作类型: '{act_type}'，仅支持 choose, rollback, quit",
        )
        emit_json_line(err_obs)

    visited = s_ctx["visited"]
    all_applied = s_ctx["all_applied_mutations"]
    reached_term = len(visited) > 0 and (
        visited[-1] in terminals
        or nodes.get(visited[-1], {}).get("node_type") == "TERMINAL_EXIT"
    )
    prologue_completed = any(
        m.get("type") == "PrologueCompleted" for m in all_applied
    ) or reached_term

    final_state = {
        "prologue_completed": prologue_completed,
        "reached_terminal": reached_term,
        "terminal_node_id": visited[-1] if visited else None,
        "visited_nodes": visited,
        "applied_mutations": all_applied,
        "gold": s_ctx["current_char"].get("gold", 0),
        "location": s_ctx["current_char"].get("birth_region", "CENTRAL_CONTINENT"),
        "equipment": [s_ctx["current_char"].get("initial_equipment", "KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD")],
    }
    is_success = reached_term and bundle["is_valid"]
    transcript = {
        "schema_version": SCHEMA_VERSION,
        "is_success": is_success,
        "precheck_report": bundle["precheck_report"],
        "creation_ui_snapshot": bundle["creation_ui_snapshot"],
        "character_sheet": s_ctx["current_char"],
        "dag_routing": bundle["dag_routing"],
        "transcript_steps": s_ctx["transcript_steps"],
        "final_state": final_state,
    }
    return transcript, is_success
