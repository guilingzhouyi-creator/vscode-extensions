#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 模组开发者工具链 (MOD SDK · 二进制归一化与反向导出核心)
# 文件路径: WebGames/scripts/py/lib/kmod_data_codec.py
# 架构定位: .kmod JSON 目录归一化编译与 JSON 调试工作区反向还原算子库
# 依赖与触发: 触发方: kmod_bundler.py | 上游: 开发期 JSON 目录 | 下游: mod_data.kdat / 调试目录
# 职责说明: 将模组开发期 JSON 目录归一化为结构化 mod_data 字典与媒体字节表，计算确定性
#           内容 SHA-256 指纹，并支持将二进制段反向还原导出为可编辑 JSON 调试工作区。
# 退出语义与设计依据: 无状态纯数据编解码算子 | 依据: 《卡拉尔数据契约规范》
# ==============================================================================
"""kmod_data_codec.py — .kmod 结构化数据归一化、内容摘要与调试工作区还原核心库。"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from kmod_debug_exporter import DESTINIES_KEYS

KMOD_MANIFEST_ENTRY: str = "manifest.kdat"
KMOD_DATA_ENTRY: str = "mod_data.kdat"

_IGNORED_NAMES: frozenset[str] = frozenset({".git", ".DS_Store", "Thumbs.db", "__pycache__"})
_IGNORED_SUFFIXES: tuple[str, ...] = (".tmp", ".swp", ".kmod", ".uid", ".import")
_TOP_LEVEL_CONTENT_FILES: frozenset[str] = frozenset({
    "items.json",
    "skills.json",
    "game_rules.json",
    "world.json",
    "races_catalog.json",
})


def compute_entries_content_sha256(entries: dict[str, bytes]) -> str:
    """计算非清单归档条目的确定性 SHA-256（与 GDScript ModPackageArchiveReader 一致）。"""
    sha = hashlib.sha256()
    for entry_path in sorted(entries.keys()):
        if entry_path == KMOD_MANIFEST_ENTRY or entry_path.endswith("/") or entry_path.endswith(".uid") or entry_path.endswith(".import"):
            continue
        sha.update(entry_path.encode("utf-8"))
        sha.update(entries[entry_path])
    return sha.hexdigest()


def classify_relative_content_path(relative_path: str) -> str:
    """与 GDScript Tier3ContentRecordParser.classify_relative_content_path 对齐的内容域分类器。"""
    normalized = relative_path.replace("\\", "/").strip().lower()
    prefix_map = (
        ("content/items/", "items"),
        ("content/skills/", "skills"),
        ("content/rules/", "rules"),
        ("content/world/", "world"),
        ("content/entities/", "entities"),
        ("content/quests/", "quests"),
        ("content/events/", "events"),
        ("content/narratives/", "narratives"),
        ("content/copywriting/", "copywriting"),
        ("content/races/", "races"),
        ("cutscenes/", "cutscenes"),
    )
    exact_map = {
        "items.json": "items",
        "skills.json": "skills",
        "game_rules.json": "rules",
        "world.json": "world",
        "races_catalog.json": "races",
    }
    if normalized in exact_map:
        return exact_map[normalized]
    for prefix, domain in prefix_map:
        if normalized.startswith(prefix):
            return domain
    return ""


def _flatten_i18n_dict(source_dict: dict[str, Any], prefix: str, target: dict[str, str]) -> None:
    for key, value in source_dict.items():
        full_key = f"{prefix}.{key}" if prefix else str(key)
        if isinstance(value, dict):
            _flatten_i18n_dict(value, full_key, target)
        else:
            text_val = str(value)
            target[full_key] = text_val
            target[full_key.replace(".", "/")] = text_val
            target[full_key.replace("/", ".")] = text_val


def _merge_i18n_payload(
    locale_data: dict[str, Any],
    locale_stem: str,
    custom_i18n: dict[str, str],
    i18n_by_locale: dict[str, dict[str, str]],
) -> None:
    if not locale_data:
        return
    clean_locale = locale_stem.strip().replace("-", "_") or "zh_CN"
    bucket = i18n_by_locale.setdefault(clean_locale, {})
    _flatten_i18n_dict(locale_data, "", bucket)
    if not custom_i18n or clean_locale == "zh_CN":
        _flatten_i18n_dict(locale_data, "", custom_i18n)
    else:
        for flat_key, flat_val in bucket.items():
            custom_i18n.setdefault(flat_key, flat_val)


def _merge_cutscene_entry(rel_path: str, data: dict[str, Any], mod_data: dict[str, Any]) -> None:
    cutscenes_node = data.get("cutscenes")
    if isinstance(cutscenes_node, dict):
        mod_data.setdefault("cutscene_registry", {}).update(cutscenes_node)
    elif isinstance(cutscenes_node, list):
        reg = mod_data.setdefault("cutscene_registry", {})
        for item in cutscenes_node:
            if isinstance(item, dict) and str(item.get("cutscene_id", "")).strip():
                reg[str(item["cutscene_id"]).strip()] = item
    if isinstance(data.get("hooks"), list):
        mod_data.setdefault("cutscene_hooks", []).extend(data["hooks"])
    mod_data["content_records"].append({"category": "cutscenes", "domain": "cutscenes", "relative_path": rel_path, "payload": data})


def _merge_json_source_entry(rel_path: str, raw_parsed: Any, mod_data: dict[str, Any]) -> None:
    if rel_path == "routing_rules.json" and isinstance(raw_parsed, list):
        mod_data["custom_routing_rules"].extend(raw_parsed)
        return
    if not isinstance(raw_parsed, dict):
        return
    if rel_path.startswith("dag_graphs/"):
        dag_id = str(raw_parsed.get("dag_id") or raw_parsed.get("graph_id") or Path(rel_path).stem)
        mod_data["dag_graphs"][dag_id] = raw_parsed
    elif rel_path.startswith("i18n/"):
        _merge_i18n_payload(raw_parsed, Path(rel_path).stem, mod_data["custom_i18n"], mod_data["custom_i18n_by_locale"])
    elif rel_path == "destinies.json":
        for cfg_key in DESTINIES_KEYS:
            if cfg_key in raw_parsed:
                mod_data[cfg_key] = raw_parsed[cfg_key]
    elif rel_path == "routing_rules.json":
        if isinstance(raw_parsed.get("prologue_routing_rules"), list):
            mod_data["prologue_routing_rules"].extend(raw_parsed["prologue_routing_rules"])
        raw_rules = raw_parsed.get("custom_routing_rules", raw_parsed.get("routing_rules"))
        if isinstance(raw_rules, list):
            mod_data["custom_routing_rules"].extend(raw_rules)
    elif rel_path == "assets/manifest.json":
        mod_data["assets_manifest"] = raw_parsed
    elif rel_path.startswith("cutscenes/"):
        _merge_cutscene_entry(rel_path, raw_parsed, mod_data)
    elif rel_path.startswith("content/") or rel_path in _TOP_LEVEL_CONTENT_FILES:
        domain = classify_relative_content_path(rel_path)
        if domain:
            mod_data["content_records"].append({"category": domain, "domain": domain, "relative_path": rel_path, "payload": raw_parsed})


def should_ignore_path(file_path: Path) -> bool:
    """判断路径是否应从 .kmod 编译打包中跳过。"""
    if any(part in _IGNORED_NAMES for part in file_path.parts):
        return True
    lower_name = file_path.name.lower()
    return any(lower_name.endswith(sfx) for sfx in _IGNORED_SUFFIXES)


def collect_mod_compile_inputs(
    mod_dir: Path,
    pack_meta: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, bytes]]:
    """从开发期 JSON 模组目录收集结构化数据（编入 mod_data.kdat）与流式媒体原始字节。"""
    sanitized_meta = {k: v for k, v in pack_meta.items() if k not in ("content_sha256", "files_manifest")}
    mod_data: dict[str, Any] = {
        "pack_metadata": sanitized_meta,
        "dag_graphs": {},
        "custom_i18n": {},
        "custom_i18n_by_locale": {},
        "custom_routing_rules": [],
        "prologue_routing_rules": [],
        "content_records": [],
    }
    media_entries: dict[str, bytes] = {}
    for p in sorted(mod_dir.rglob("*")):
        if p.is_dir() or should_ignore_path(p):
            continue
        rel_path = p.relative_to(mod_dir).as_posix()
        if rel_path in ("pack.json", "manifest.json"):
            continue
        if rel_path.lower().endswith(".json"):
            parsed = json.loads(p.read_text(encoding="utf-8"))
            _merge_json_source_entry(rel_path, parsed, mod_data)
        else:
            media_entries[rel_path] = p.read_bytes()
    return mod_data, media_entries
