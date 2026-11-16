#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Tools)
# 文件路径: WebGames/mod_sdk/tools/check_mod_schema.py
# 架构定位: MOD 全域 JSON Schema 强类型校验器 (Mod Schema Validator)
# 依赖与触发: 触发方: check_mod.py | 上游: mod_sdk/schemas/*.schema.json | 运行时: Python 3.10+ + jsonschema
# 职责说明: 使用 mod_sdk/schemas 强类型契约字典对 pack/destinies/routing_rules/dag_graphs/content/cutscenes 执行 Draft-07 / 2020-12 校验
# 退出语义与设计依据: 纯静态校验无独立退出码，违规经 DiagnosticItem 回传
# ==============================================================================
"""基于 mod_sdk/schemas/*.schema.json 的纯静态 MOD JSON Schema 校验器。"""

from __future__ import annotations
from pathlib import Path
from typing import Any
import json

try:
    import jsonschema
    from jsonschema import validators as _schema_validators
except ImportError:
    jsonschema = None  # type: ignore[assignment]
    _schema_validators = None  # type: ignore[assignment]

from check_mod_common import DiagnosticItem, add_diag

SCHEMA_DIR: Path = Path(__file__).resolve().parent.parent / "schemas"

CONTENT_SUBDIR_SCHEMA_MAP: dict[str, str] = {
    "items": "items",
    "rules": "game_rules",
    "entities": "entities",
    "quests": "quests",
    "skills": "skills",
    "events": "event_probability",
    "narratives": "narratives_overlay",
    "copywriting": "copywriting_overlay",
    "races": "races_catalog",
}


def _load_schema_cache() -> dict[str, dict[str, Any]]:
    cache: dict[str, dict[str, Any]] = {}
    if not SCHEMA_DIR.is_dir():
        return cache
    for schema_path in sorted(SCHEMA_DIR.glob("*.schema.json")):
        key = schema_path.name[:-12]  # strip .schema.json
        try:
            parsed = json.loads(schema_path.read_text(encoding="utf-8"))
            if isinstance(parsed, dict):
                cache[key] = parsed
        except (json.JSONDecodeError, OSError):
            continue
    return cache


def _validate_file_against_schema(
    target_path: Path,
    rel_name: str,
    schema_key: str,
    schemas: dict[str, dict[str, Any]],
    diags: list[DiagnosticItem],
) -> dict[str, Any] | None:
    if not target_path.is_file():
        return None
    try:
        payload = json.loads(target_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None

    schema_obj = schemas.get(schema_key)
    if schema_obj is None or jsonschema is None or _schema_validators is None:
        return payload if isinstance(payload, dict) else None

    validator_cls = _schema_validators.validator_for(schema_obj)
    validator_cls.check_schema(schema_obj)
    validator = validator_cls(schema_obj)
    errors = sorted(validator.iter_errors(payload), key=lambda err: list(err.path))
    for err in errors[:5]:
        path_tokens = ".".join(str(part) for part in err.path) or "<root>"
        add_diag(
            diags,
            "ERR_SCHEMA_VALIDATION",
            rel_name,
            f"[{schema_key}.schema.json] 路径 '{path_tokens}' 校验失败: {err.message}",
            f"请参照 mod_sdk/schemas/{schema_key}.schema.json 契约修正 {rel_name} 中 '{path_tokens}' 字段定义",
        )
    return payload if isinstance(payload, dict) else None


def _resolve_world_schema_key(payload: Any) -> str:
    if isinstance(payload, dict) and any(
        key in payload for key in ("regions", "landmarks", "worlds_catalog", "map_id", "nodes")
    ):
        return "world_topology"
    return "world"


def validate_mod_schemas(mod_dir: Path, diags: list[DiagnosticItem]) -> None:
    """对 MOD 包内全量配置文件执行 mod_sdk/schemas/*.schema.json 强类型契约校验。"""
    if jsonschema is None or not SCHEMA_DIR.is_dir():
        return
    schemas = _load_schema_cache()
    if not schemas:
        return

    _validate_file_against_schema(mod_dir / "pack.json", "pack.json", "pack", schemas, diags)
    _validate_file_against_schema(mod_dir / "destinies.json", "destinies.json", "destinies", schemas, diags)
    _validate_file_against_schema(mod_dir / "routing_rules.json", "routing_rules.json", "routing_rules", schemas, diags)
    _validate_file_against_schema(mod_dir / "assets" / "manifest.json", "assets/manifest.json", "assets_manifest", schemas, diags)
    _validate_file_against_schema(
        mod_dir / "cutscenes" / "cutscene_registry.json",
        "cutscenes/cutscene_registry.json",
        "cutscene_manifest",
        schemas,
        diags,
    )
    _validate_file_against_schema(
        mod_dir / "cutscenes" / "cutscene_hooks.json",
        "cutscenes/cutscene_hooks.json",
        "cutscene_manifest",
        schemas,
        diags,
    )

    dag_dir = mod_dir / "dag_graphs"
    if dag_dir.is_dir():
        for dag_file in sorted(dag_dir.glob("*.json")):
            _validate_file_against_schema(dag_file, f"dag_graphs/{dag_file.name}", "dag_graph", schemas, diags)

    content_dir = mod_dir / "content"
    if content_dir.is_dir():
        for content_file in sorted(content_dir.rglob("*.json")):
            rel_parts = content_file.relative_to(content_dir).parts
            if not rel_parts:
                continue
            domain_dir = rel_parts[0]
            rel_name = f"content/{content_file.relative_to(content_dir).as_posix()}"
            if domain_dir == "world":
                try:
                    raw_world = json.loads(content_file.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, OSError):
                    continue
                schema_key = _resolve_world_schema_key(raw_world)
            else:
                schema_key = CONTENT_SUBDIR_SCHEMA_MAP.get(domain_dir, "")
            if schema_key:
                _validate_file_against_schema(content_file, rel_name, schema_key, schemas, diags)
