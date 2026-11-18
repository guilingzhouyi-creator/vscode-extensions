#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 模组开发者工具链 (MOD SDK · 调试工作区反向还原器)
# 文件路径: WebGames/scripts/py/lib/kmod_debug_exporter.py
# 架构定位: Debug JSON Workspace Reconstructor for Compiled .kmod Archives
# 依赖与触发: 触发方: kmod_bundler.inspect_kmod_package | 上游: manifest.kdat + mod_data.kdat | 下游: 可编辑 JSON 调试目录
# 职责说明: 将正式二进制 .kmod 中的 manifest.kdat、mod_data.kdat 与流式媒体反编译重建为
#           结构完整的开发期 JSON 调试工作区目录，保障调试态与发布态无损双向往返。
# 退出语义与设计依据: 无状态导出算子 | 依据: 《卡拉尔数据契约规范》
# ==============================================================================
"""kmod_debug_exporter.py — 将 .kmod 二进制归档反向导出为 JSON 调试工作区目录。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
import zipfile

DESTINIES_KEYS: tuple[str, ...] = (
    "ui_capabilities",
    "custom_races",
    "creation_rule_overrides",
    "custom_origins",
    "custom_traits",
    "paired_presets",
    "custom_starter_kits",
    "custom_routing_rules",
    "prologue_routing_rules",
)


def _write_json_file(target_path: Path, payload: Any) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def export_mod_debug_workspace(
    export_dir: Path,
    manifest_data: dict[str, Any],
    mod_data: dict[str, Any],
    zf: zipfile.ZipFile,
    media_files: list[str],
) -> None:
    """将已验证的 .kmod 二进制段与流式媒体反向导出为可编辑 JSON 调试工作区。"""
    export_dir.mkdir(parents=True, exist_ok=True)
    pack_meta = mod_data.get("pack_metadata")
    if not isinstance(pack_meta, dict) or not pack_meta:
        skip_keys = (
            "files_manifest",
            "content_sha256",
            "archive_format_version",
            "manifest_schema",
            "created_timestamp_utc",
            "bundle_id",
            "bundle_name",
        )
        pack_meta = {k: v for k, v in manifest_data.items() if k not in skip_keys}
    _write_json_file(export_dir / "pack.json", pack_meta)

    for dag_id, dag_payload in (mod_data.get("dag_graphs") or {}).items():
        _write_json_file(export_dir / "dag_graphs" / f"{dag_id}.json", dag_payload)

    for locale, flat_map in (mod_data.get("custom_i18n_by_locale") or {}).items():
        if isinstance(flat_map, dict):
            _write_json_file(
                export_dir / "i18n" / f"{locale}.json",
                {k: v for k, v in flat_map.items() if "/" not in str(k)},
            )

    destinies_payload = {k: mod_data[k] for k in DESTINIES_KEYS if k in mod_data}
    if destinies_payload:
        _write_json_file(export_dir / "destinies.json", destinies_payload)

    routing_payload: dict[str, Any] = {}
    if mod_data.get("prologue_routing_rules"):
        routing_payload["prologue_routing_rules"] = mod_data["prologue_routing_rules"]
    if mod_data.get("custom_routing_rules"):
        routing_payload["custom_routing_rules"] = mod_data["custom_routing_rules"]
    if routing_payload:
        _write_json_file(export_dir / "routing_rules.json", routing_payload)

    assets_manifest = mod_data.get("assets_manifest")
    if isinstance(assets_manifest, dict) and assets_manifest:
        _write_json_file(export_dir / "assets" / "manifest.json", assets_manifest)

    for rec in mod_data.get("content_records") or []:
        if isinstance(rec, dict) and rec.get("relative_path") and "payload" in rec:
            _write_json_file(export_dir / Path(str(rec["relative_path"])), rec["payload"])

    for media_rel in media_files:
        dest = (export_dir / media_rel).resolve()
        if export_dir.resolve() in dest.parents:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(zf.read(media_rel))
