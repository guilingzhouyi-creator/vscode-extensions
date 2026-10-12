#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Tools)
# 文件路径: WebGames/mod_sdk/tools/check_mod_multi.py
# 架构定位: 多MOD联合冲突与策略互斥预检子模块 (Multi-Mod Conflict & Compatibility Validator)
# 依赖与触发: 触发方: check_mod.py | 上游: 多个 MOD 包目录 | 下游: DiagnosticItem 诊断列表 | 运行时: Python 3.10+
# 职责说明: 校验多包联合启用时的 incompatible_packs 互斥、同名实体 ID 撞车及 UI 策略冲突
# 退出语义与设计依据: 纯计算与冲突诊断函数，返回布尔值与诊断列表 | 设计依据: 《卡拉尔数据契约规范 v1.0》
# ==============================================================================
"""多 MOD 联合冲突与策略互斥预检模块。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from check_mod_common import (
    DiagnosticItem,
    normalize_named_items as _normalize_named_items,
)


def check_multi_incompatible_packs(
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


def register_entity_ids(
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


def check_multi_duplicate_ids(
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
        register_entity_ids(origins, "origin_id", "origin_id", pid, rel_file, seen_origins, diags)

        traits = _normalize_named_items(destiny.get("custom_traits"), "trait_id")
        register_entity_ids(traits, "trait_id", "trait_id", pid, rel_file, seen_traits, diags)

        kits = _normalize_named_items(destiny.get("custom_starter_kits"), "kit_id")
        register_entity_ids(kits, "kit_id", "kit_id", pid, rel_file, seen_kits, diags)


def check_multi_ui_policy_conflicts(
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
    from check_mod import validate_mod
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
        check_multi_incompatible_packs(pack_records, all_diags)
        check_multi_duplicate_ids(pack_records, all_diags)
        check_multi_ui_policy_conflicts(pack_records, all_diags)

    return len(all_diags) == 0, all_diags
