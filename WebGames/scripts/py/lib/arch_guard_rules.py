#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 静态架构规则扩展)
# 文件路径: WebGames/scripts/py/lib/arch_guard_rules.py
# 架构定位: 架构护栏扩展断言规则库与分发聚合入口 (Architecture Guard Extension Rules)
# 依赖与触发: 触发方: audit_arch_static.py | 上游: config/ 与 backend/ | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 提供错误码登记一致性、持久化实体对称性断言，并聚合日志与安全子模块规则导出
# 退出语义与设计依据: 规则库模块，无进程退出码 | 设计依据: test_architecture_guard.gd 原生等价实现与全域代码规范
# ------------------------------------------------------------------------------
# 用法示例:
#   from lib.arch_guard_rules import check_tc_arch_09, check_tc_arch_10, check_tc_arch_11
# ==============================================================================
"""架构护栏原生静态扩展规则：错误码一致性、持久化对称性与聚合子模块入口。"""

from __future__ import annotations
from pathlib import Path
from typing import Any, Callable
import json
import re

from lib.arch_guard_common import (
    RES_PREFIX,
    iter_gd_sources as _iter_gd_sources,
    strip_string_contents as _strip_string_contents,
)
from lib.arch_guard_logging_rules import (
    ALLOWED_PRINTERR_FILES,
    ALLOWED_PUSH_FILES,
    check_tc_arch_11,
    check_tc_arch_12,
)
from lib.arch_guard_security_rules import (
    ALLOWED_CRYPTO_FILES,
    check_tc_arch_13,
    check_tc_arch_14,
)

# 持久化核心实体聚合根列表与声明文件路径映射
CORE_PERSISTENCE_CLASSES: tuple[tuple[str, str], ...] = (
    ("AccountProfile", "backend/domains/account/account_profile.gd"),
    ("CharacterProfile", "backend/domains/account/character_profile.gd"),
    (
        "CharacterPrologueContext",
        "backend/domains/character_creation/character_prologue_context.gd",
    ),
    (
        "WearableInventoryAggregate",
        "backend/domains/inventory/wearable_inventory_aggregate.gd",
    ),
    ("WorldInstance", "backend/domains/world_state/world_instance.gd"),
    ("SaveSlotDTO", "backend/domains/account/save_slot_dto.gd"),
    (
        "EquipmentLoadoutAggregate",
        "backend/domains/equipment_loadout/equipment_loadout_aggregate.gd",
    ),
    ("SkillSubgraphAST", "backend/domains/lattice_skill_book/skill_subgraph_ast.gd"),
)


def check_tc_arch_09(
    ctx: Any, make_result: Callable[[str, list[str]], dict[str, Any]]
) -> dict[str, Any]:
    """TC-ARCH-09: 统一错误上报错误码全域登记与 i18n 键一致性断言。"""
    violations: list[str] = []
    catalog_file: Path = ctx.root / "config" / "infrastructure" / "errors_catalog.json"
    narr_file: Path = ctx.root / "config" / "narratives" / "errors.json"

    if not catalog_file.exists():
        violations.append(
            "缺失全域错误码目录真源: res://config/infrastructure/errors_catalog.json"
        )
        return make_result(
            "TC-ARCH-09: 统一错误上报错误码全域登记与 i18n 键一致性断言", violations
        )

    catalog_errors: dict[str, Any] = {}
    try:
        c_data = json.loads(catalog_file.read_text(encoding="utf-8"))
        catalog_errors = c_data.get("errors", {})
    except Exception as exc:
        violations.append(f"解析 errors_catalog.json 异常: {exc}")
        return make_result(
            "TC-ARCH-09: 统一错误上报错误码全域登记与 i18n 键一致性断言", violations
        )

    narr_errors: dict[str, Any] = {}
    if narr_file.exists():
        try:
            narr_errors = json.loads(narr_file.read_text(encoding="utf-8"))
        except Exception as exc:
            violations.append(f"解析 narratives/errors.json 异常: {exc}")

    for code, entry in catalog_errors.items():
        if not isinstance(entry, dict):
            continue
        mk = str(entry.get("message_key", ""))
        if mk.startswith("errors/"):
            sub_key = mk.split("/", 1)[1]
            if narr_errors and sub_key not in narr_errors:
                violations.append(
                    f"错误码 {code} 的 message_key 「{mk}」未在 narratives.errors 中登记"
                )

    error_call_patterns = [
        re.compile(r'ErrorReporter\.emit_error\s*\([^,]+,\s*"([A-Za-z0-9_]+)"'),
        re.compile(r'ErrorReporter\.emit_warning\s*\([^,]+,\s*"([A-Za-z0-9_]+)"'),
        re.compile(r'ErrorReporter\.emit\s*\(\s*"([A-Za-z0-9_]+)"'),
    ]

    for gd_file in ctx.backend_files:
        _, code = ctx.gd_sources[gd_file]
        rel = RES_PREFIX + gd_file.relative_to(ctx.root).as_posix()
        for pat in error_call_patterns:
            for m in pat.finditer(code):
                err_code = m.group(1)
                if err_code not in catalog_errors:
                    line_num = code[: m.start()].count("\n") + 1
                    violations.append(
                        f"{rel}:{line_num}: 错误码 「{err_code}」未在 errors_catalog.json 中登记"
                    )

    return make_result(
        "TC-ARCH-09: 统一错误上报错误码全域登记与 i18n 键一致性断言", violations
    )


def check_tc_arch_10(
    ctx: Any,
    make_result: Callable[[str, list[str]], dict[str, Any]],
    strip_comments: Callable[[str], str],
) -> dict[str, Any]:
    """TC-ARCH-10: 持久化核心实体序列化与反序列化双向契约一致性断言。"""
    violations: list[str] = []
    ser_fn_re = re.compile(r"^\s*(?:static\s+)?func\s+serialize\s*\(", re.MULTILINE)
    deser_fn_re = re.compile(r"^\s*(?:static\s+)?func\s+deserialize\s*\(", re.MULTILINE)

    for cls_name, rel_path in CORE_PERSISTENCE_CLASSES:
        target_path = ctx.root / rel_path
        rel_res = RES_PREFIX + rel_path
        if not target_path.exists():
            violations.append(f"核心持久化实体文件缺失: {rel_res} ({cls_name})")
            continue

        raw, code = ctx.gd_sources.get(target_path, ("", ""))
        if not raw:
            raw = target_path.read_text(encoding="utf-8")
            code = strip_comments(raw)

        if not ser_fn_re.search(code):
            violations.append(
                f"{rel_res}: 持久化类 {cls_name} 缺失 func serialize() -> Dictionary 实现"
            )
        if not deser_fn_re.search(code):
            violations.append(
                f"{rel_res}: 持久化类 {cls_name} 缺失 static func deserialize() 实现"
            )

    return make_result(
        "TC-ARCH-10: 持久化核心实体序列化与反序列化双向契约一致性断言", violations
    )


__all__ = [
    "ALLOWED_CRYPTO_FILES",
    "ALLOWED_PRINTERR_FILES",
    "ALLOWED_PUSH_FILES",
    "CORE_PERSISTENCE_CLASSES",
    "RES_PREFIX",
    "_iter_gd_sources",
    "_strip_string_contents",
    "check_tc_arch_09",
    "check_tc_arch_10",
    "check_tc_arch_11",
    "check_tc_arch_12",
    "check_tc_arch_13",
    "check_tc_arch_14",
]
