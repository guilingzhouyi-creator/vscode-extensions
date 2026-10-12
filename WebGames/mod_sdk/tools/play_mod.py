#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Playtester)
# 文件路径: WebGames/mod_sdk/tools/play_mod.py
# 架构定位: MOD全自动端到端试玩推演与战报发生器 (Headless Mod Agent Playtester & Transcript Generator)
# 依赖与触发: 触发方: CLI / 外部 Agent / CI 自动化 | 上游: check_mod.py / MOD 包目录 | 下游: kalar.mod_sdk.playthrough_transcript.v1 JSON 战报 | 运行时: Python 3.10+
# 职责说明: 预检 MOD 目录、解算创角六维属性与因果天赋、解析四级路由、逐步推演剧情节点并产出权威结构化战报
# 退出语义与设计依据: 退出码: 0=推演成功通关, 1=预检失败/推演中断, 2=参数解析或IO异常 | 设计依据: 《卡拉尔数据契约规范 v1.0》与第一性原理
# ------------------------------------------------------------------------------
# 用法示例:
#   python mod_sdk/tools/play_mod.py ./my_mod --json
#   python mod_sdk/tools/play_mod.py ./mod_a ./mod_b --race ELF --origin ORIGIN_VALAN_SCOUT --json
#   python mod_sdk/tools/play_mod.py ./my_mod --choice-strategy random --seed MY_SEED --json
# ==============================================================================
"""卡拉尔世界引擎 MOD 无头试玩推演引擎与结构化战报发生器。"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

# 将本脚本所在目录加入 sys.path，以便无缝导入模块
TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from play_mod_character import (
    BUILTIN_DAG_TEMPLATES,
    BUILTIN_ORIGINS,
    BUILTIN_PAIRED_PRESETS,
    BUILTIN_STARTER_KITS,
    BUILTIN_TRAITS,
    build_character_context,
    generate_base_attributes,
    pick_origin,
    pick_starter_kit,
    pick_trait_pair,
    resolve_character_sheet,
)
from play_mod_common import (
    PARAM_REGEX,
    SCHEMA_VERSION,
    SCHEMA_VERSION_ACTION,
    SCHEMA_VERSION_OBSERVATION,
    SCHEMA_VERSION_TRANSCRIPT,
    DiagnosticItem,
    ensure_utf8_stdout,
    extract_rules,
    flatten_i18n_dict,
    hydrate,
    load_and_merge_assets,
    match_rule,
    merge_dag_and_i18n,
    merge_destinies_from_mod,
    normalize_items,
    parse_dag_topology,
    prepare_session,
    resolve_dag_routing,
    resolve_node_text,
    safe_load_json,
    score_rule,
    validate_mod,
    validate_multi_mods,
)
from play_mod_interactive import (
    apply_mutations_to_state,
    apply_single_mutation,
    build_observation_payload,
    emit_json_line,
    handle_interactive_choose,
    handle_interactive_rollback,
    parse_action_input,
    play_mod_interactive,
    resolve_choice_target,
)

# 兼容私有符号别名
_ensure_utf8_stdout = ensure_utf8_stdout
_safe_load_json = safe_load_json
_flatten_i18n_dict = flatten_i18n_dict
_normalize_items = normalize_items
_extract_rules = extract_rules
_generate_base_attributes = generate_base_attributes
_pick_origin = pick_origin
_pick_trait_pair = pick_trait_pair
_pick_starter_kit = pick_starter_kit
_resolve_character_sheet = resolve_character_sheet
_build_context = build_character_context
_hydrate = hydrate
_resolve_node_text = resolve_node_text
_parse_dag_topology = parse_dag_topology
_score_rule = score_rule
_match_rule = match_rule
_resolve_dag_routing = resolve_dag_routing
_merge_destinies_from_mod = merge_destinies_from_mod
_merge_dag_and_i18n = merge_dag_and_i18n
_load_and_merge_assets = load_and_merge_assets
_prepare_session = prepare_session
_build_observation_payload = build_observation_payload
_emit_json_line = emit_json_line
_apply_single_mutation = apply_single_mutation
_apply_mutations_to_state = apply_mutations_to_state
_parse_action_input = parse_action_input
_resolve_choice_target = resolve_choice_target
_handle_interactive_rollback = handle_interactive_rollback
_handle_interactive_choose = handle_interactive_choose


def _pick_batch_next_node(
    candidates: list[str],
    choice_tokens: list[str],
    token_idx: int,
    strategy: str,
    seed: str,
    step_num: int,
) -> tuple[str | None, int]:
    """在批处理推演模式下依据预设决策序列或策略选取后继节点。"""
    if not candidates:
        return None, token_idx
    if token_idx < len(choice_tokens):
        tok = choice_tokens[token_idx]
        nxt_idx = token_idx + 1
        if tok in candidates:
            return tok, nxt_idx
        if tok.isdigit() and 0 <= int(tok) < len(candidates):
            return candidates[int(tok)], nxt_idx
        return candidates[0], nxt_idx

    if strategy == "random":
        salt = hashlib.sha256(f"{seed}:{step_num}".encode("utf-8")).digest()
        pick_idx = salt[0] % len(candidates)
        return candidates[pick_idx], token_idx

    return candidates[0], token_idx


def _simulate_steps(
    dag_data: dict[str, Any],
    i18n_catalog: dict[str, str],
    context: dict[str, Any],
    choices_param: str | None,
    choice_strategy: str,
    seed: str,
) -> tuple[list[dict[str, Any]], dict[str, Any], bool]:
    """依照选择分支推演 DAG 节点并返回步进记录与终态状态。"""
    nodes = dag_data.get("nodes", {})
    edges = dag_data.get("edges", [])
    entry_id, terminals, adj = parse_dag_topology(nodes, edges)

    if not entry_id:
        return [], {"reached_terminal": False, "error": "DAG 缺少入口节点"}, False

    choice_tokens = [c.strip() for c in choices_param.split(",") if c.strip()] if choices_param else []
    token_idx = 0
    curr = entry_id
    steps: list[dict[str, Any]] = []
    visited: list[str] = []
    applied_mutations: list[dict[str, Any]] = []
    step_num = 1

    while curr:
        visited.append(curr)
        nd = nodes.get(curr, {})
        ntype = str(nd.get("node_type", "UNKNOWN"))
        nkey = str(nd.get("narrative_key", ""))
        bg_asset = nd.get("background_asset") or nd.get("bg_asset")
        bgm_asset = nd.get("bgm_asset") or nd.get("bgm")
        raw_text, text_source = resolve_node_text(nd, i18n_catalog)
        hydrated_text = hydrate(raw_text, context)
        mutations = list(nd.get("mutations_on_complete", []))
        applied_mutations.extend(mutations)

        next_candidates = list(adj.get(curr, []))
        chosen_next, token_idx = _pick_batch_next_node(
            next_candidates, choice_tokens, token_idx, choice_strategy, seed, step_num
        )

        steps.append({
            "step_index": step_num,
            "branch_index": 1,
            "node_id": curr,
            "node_type": ntype,
            "narrative_key": nkey,
            "background_asset": bg_asset,
            "bgm_asset": bgm_asset,
            "text_source": text_source,
            "raw_text": raw_text,
            "hydrated_text": hydrated_text,
            "available_choices": next_candidates,
            "selected_next_node": chosen_next,
            "mutations_on_complete": mutations,
        })

        if curr in terminals or ntype == "TERMINAL_EXIT":
            break
        curr = chosen_next
        step_num += 1

    reached_term = len(visited) > 0 and (visited[-1] in terminals or nodes.get(visited[-1], {}).get("node_type") == "TERMINAL_EXIT")
    prologue_completed = any(m.get("type") == "PrologueCompleted" for m in applied_mutations) or reached_term

    final_state = {
        "prologue_completed": prologue_completed,
        "reached_terminal": reached_term,
        "terminal_node_id": visited[-1] if visited else None,
        "visited_nodes": visited,
        "applied_mutations": applied_mutations,
        "gold": context.get("initial_gold", 0),
        "location": context.get("start_location", "CENTRAL_CONTINENT"),
        "equipment": [context.get("initial_equipment", "KALAR:EQUIP:WEAPON_BLADE:IRON_SWORD")],
    }
    return steps, final_state, reached_term


def play_mod_suite(
    mod_paths: list[Path],
    player_name: str,
    race_id: str,
    gender: str,
    origin_id_param: str | None,
    trait_pair_param: str | None,
    reroll_nonce: int,
    seed: str,
    choices_param: str | None,
    choice_strategy: str,
) -> tuple[dict[str, Any], bool]:
    """执行完整的预检、面板解算、路由装配与批处理推演闭环（100% 向后兼容）。"""
    bundle, fail_transcript = prepare_session(
        mod_paths=mod_paths,
        player_name=player_name,
        race_id=race_id,
        gender=gender,
        origin_id_param=origin_id_param,
        trait_pair_param=trait_pair_param,
        reroll_nonce=reroll_nonce,
        seed=seed,
        choice_strategy=choice_strategy,
    )
    if bundle is None:
        return fail_transcript, False

    steps, final_state, reached_term = _simulate_steps(
        dag_data=bundle["target_dag_data"],
        i18n_catalog=bundle["merged_i18n_catalog"],
        context=bundle["context"],
        choices_param=choices_param,
        choice_strategy=choice_strategy,
        seed=seed,
    )

    is_success = reached_term and bundle["is_valid"]
    transcript = {
        "schema_version": SCHEMA_VERSION,
        "is_success": is_success,
        "precheck_report": bundle["precheck_report"],
        "creation_ui_snapshot": bundle["creation_ui_snapshot"],
        "character_sheet": bundle["char_sheet"],
        "dag_routing": bundle["dag_routing"],
        "transcript_steps": steps,
        "final_state": final_state,
    }
    return transcript, is_success


def print_transcript_text(transcript: dict[str, Any]) -> None:
    """输出人类可读的战报日志。"""
    char = transcript.get("character_sheet") or {}
    routing = transcript.get("dag_routing") or {}
    precheck = transcript.get("precheck_report") or {}
    final_st = transcript.get("final_state") or {}
    steps = transcript.get("transcript_steps") or []

    print("==============================================================================")
    print("🎮 卡拉尔 MOD Agent 试玩推演战报 (Playthrough Transcript)")
    print("------------------------------------------------------------------------------")
    print(f"  • 预检结论   : {'PASS (100% 合规)' if precheck.get('valid') else 'FAIL (存在违规)'}")
    print(f"  • 推演结论   : {'🏆 SUCCESS (通关终态)' if transcript.get('is_success') else '⚠️ FAILED (推演未达成)'}")
    print(f"  • 角色标识   : {char.get('name')} (种族: {char.get('race')}, 身世: {char.get('origin_name')})")
    print(f"  • 六维面板   : {char.get('attributes')} (基底: 21 点)")
    print(f"  • 生存属性   : HP {char.get('hp')}/{char.get('max_hp')} | MP {char.get('mp')}/{char.get('max_mp')} | 负重 {char.get('carry_weight')}")
    print(f"  • 天赋行囊   : [{char.get('trait_summary')}] | {char.get('starter_kit_name')} (金币: {char.get('initial_gold')})")
    print(f"  • 激活图元   : {routing.get('target_dag_id')} (来源: {routing.get('routing_source')})")
    print("------------------------------------------------------------------------------")
    for s in steps:
        print(f"  [{s.get('step_index')}] {s.get('node_id')} ({s.get('node_type')}) [来源: {s.get('text_source')}]")
        if s.get("background_asset") or s.get("bgm_asset"):
            bg_info = s.get("background_asset") or "无"
            bgm_info = s.get("bgm_asset") or "无"
            print(f"      视听绑定: 背景: {bg_info} | BGM: {bgm_info}")
        print(f"      水化台词: \"{s.get('hydrated_text')}\"")
        if s.get("mutations_on_complete"):
            print(f"      状态突变: {json.dumps(s.get('mutations_on_complete'), ensure_ascii=False)}")
    print("------------------------------------------------------------------------------")
    print(f"  🏁 终态节点 : {final_st.get('terminal_node_id')} | 序章完结: {final_st.get('prologue_completed')}")
    print("==============================================================================")


def main() -> None:
    """命令行主入口。"""
    ensure_utf8_stdout()
    parser = argparse.ArgumentParser(
        description="卡拉尔 MOD 全自动端到端试玩推演与战报发生器 (Agent Playtester)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("mod_dirs", nargs="+", help="参与试玩演习的一个或多个 MOD 根目录路径")
    parser.add_argument("--name", default="阿尔温", dest="player_name", help="模拟角色自定义名称 (默认: 阿尔温)")
    parser.add_argument("--race", default="HUMAN", dest="race_id", help="模拟角色种族 (默认: HUMAN)")
    parser.add_argument("--gender", default="FEMALE", dest="gender", help="模拟角色性别 (默认: FEMALE)")
    parser.add_argument("--origin", default=None, dest="origin_id", help="指定演习创角身世 ID")
    parser.add_argument("--trait-pair", default=None, dest="trait_pair", help="指定演习因果天赋配对预设 ID")
    parser.add_argument("--reroll-nonce", type=int, default=0, dest="reroll_nonce", help="六维属性重掷随机数 (默认: 0)")
    parser.add_argument("--seed", default="KALAR_SEED_DEFAULT", dest="seed", help="确定性创角与推演种子 (默认: KALAR_SEED_DEFAULT)")
    parser.add_argument("--choices", default=None, dest="choices", help="交互分支决策序列 (逗号分隔，如 0,1 或 NODE_ID)")
    parser.add_argument(
        "--choice-strategy",
        choices=["first", "random", "all-branches"],
        default="first",
        dest="choice_strategy",
        help="交互分支遍历决策策略 (默认: first)",
    )
    parser.add_argument("--json", action="store_true", dest="as_json", help="输出机器可读的结构化 JSON 战报")
    parser.add_argument(
        "--interactive",
        action="store_true",
        dest="interactive",
        help="启动长程交互式单步推演会话 (Agent stdio 流式推演)",
    )
    parser.add_argument("--simulate", action="store_true", dest="simulate", help="启动推演模式（保留与 preview_mod 的参数对称性）")

    args = parser.parse_args()
    paths = [Path(p).resolve() for p in args.mod_dirs]

    for p in paths:
        if not p.is_dir():
            err_msg = f"MOD 目标目录不存在: {p}"
            if args.as_json:
                print(json.dumps({"error": err_msg}, ensure_ascii=False))
            else:
                print(f"❌ 错误: {err_msg}", file=sys.stderr)
            sys.exit(2)

    if args.interactive:
        transcript, is_success = play_mod_interactive(
            mod_paths=paths,
            player_name=args.player_name,
            race_id=args.race_id,
            gender=args.gender,
            origin_id_param=args.origin_id,
            trait_pair_param=args.trait_pair,
            reroll_nonce=args.reroll_nonce,
            seed=args.seed,
        )
        if args.as_json:
            print(json.dumps(transcript, ensure_ascii=False))
        else:
            print_transcript_text(transcript)
    else:
        transcript, is_success = play_mod_suite(
            mod_paths=paths,
            player_name=args.player_name,
            race_id=args.race_id,
            gender=args.gender,
            origin_id_param=args.origin_id,
            trait_pair_param=args.trait_pair,
            reroll_nonce=args.reroll_nonce,
            seed=args.seed,
            choices_param=args.choices,
            choice_strategy=args.choice_strategy,
        )
        if args.as_json:
            print(json.dumps(transcript, ensure_ascii=False, indent=2))
        else:
            print_transcript_text(transcript)

    sys.exit(0 if is_success else 1)


if __name__ == "__main__":
    main()
