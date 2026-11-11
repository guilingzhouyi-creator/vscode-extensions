#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 静态架构规则扩展)
# 文件路径: WebGames/scripts/py/lib/arch_guard_rules.py
# 架构定位: 架构护栏扩展断言规则库 (Architecture Guard Extension Rules)
# 依赖与触发: 触发方: audit_arch_static.py | 上游: config/ 与 backend/ | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 提供统一错误上报错误码登记、持久化核心实体对称性与全库日志收敛白名单静态断言
# 退出语义与设计依据: 规则库模块，无进程退出码 | 设计依据: test_architecture_guard.gd 原生等价实现与全域代码规范
# ------------------------------------------------------------------------------
# 用法示例:
#   from lib.arch_guard_rules import check_tc_arch_09, check_tc_arch_10, check_tc_arch_11
# ==============================================================================
"""架构护栏原生静态扩展规则：错误码闭环、持久化对称性与日志收敛静态断言。"""

from __future__ import annotations
from pathlib import Path
from typing import Any, Callable
import json
import re

RES_PREFIX = "res://"

# 全库 push_error/push_warning 散落收敛白名单（对齐 test_log_error_base_pipeline TC-LG-19）
ALLOWED_PUSH_FILES: frozenset[str] = frozenset({
  "backend/infrastructure/game_config.gd",
  "backend/infrastructure/save_manager.gd",
  "backend/domains/inventory/item_attribute_registry.gd",
  "backend/domains/item_namespace_registry/magic_tier_registry.gd",
  "backend/domains/gacha_wish/gacha_banner_entity.gd",
  "backend/domains/game_settings/game_settings_aggregate.gd",
  "backend/domains/notification_red_dot/red_dot_tree_fsm.gd",
  "backend/domains/inventory/wearable_inventory.gd",
  "backend/domains/contract_registry/domain_view_mapping_snapshot.gd",
})

# 存量旧模块错误消息硬编码中文与裸格式符渐进演进白名单（已全部清零完成英文底座改造）
LEGACY_ERROR_MESSAGE_WHITELIST: frozenset[str] = frozenset()

# 持久化核心实体聚合根列表与声明文件路径映射
CORE_PERSISTENCE_CLASSES: tuple[tuple[str, str], ...] = (
  ("AccountProfileAggregate", "backend/domains/account/account_profile.gd"),
  ("CharacterProfile", "backend/domains/account/character_profile.gd"),
  ("CharacterPrologueContext", "backend/domains/character_creation/character_prologue_context.gd"),
  ("WearableInventoryAggregate", "backend/domains/inventory/wearable_inventory.gd"),
  ("WorldInstance", "backend/domains/world_state/world_instance.gd"),
  ("SaveSlotSummaryDTO", "backend/domains/account/save_slot_dto.gd"),
  ("EquipmentLoadoutAggregate", "backend/domains/equipment_loadout/equipment_loadout_entity.gd"),
  ("SkillSubgraphAST", "backend/domains/lattice_skill_book/skill_lattice_entities.gd"),
)


def check_tc_arch_09(ctx: Any, make_result: Callable[[str, list[str]], dict[str, Any]]) -> dict[str, Any]:
  """TC-ARCH-09: 统一错误上报错误码全域登记与 i18n 键闭环断言。"""
  violations: list[str] = []
  catalog_file: Path = ctx.root / "config" / "infrastructure" / "errors_catalog.json"
  narr_file: Path = ctx.root / "config" / "narratives" / "errors.json"

  if not catalog_file.exists():
    violations.append("缺失全域错误码目录真源: res://config/infrastructure/errors_catalog.json")
    return make_result("TC-ARCH-09: 统一错误上报错误码全域登记与 i18n 键闭环断言", violations)

  catalog_errors: dict[str, Any] = {}
  try:
    c_data = json.loads(catalog_file.read_text(encoding="utf-8"))
    catalog_errors = c_data.get("errors", {})
  except Exception as exc:
    violations.append(f"解析 errors_catalog.json 异常: {exc}")
    return make_result("TC-ARCH-09: 统一错误上报错误码全域登记与 i18n 键闭环断言", violations)

  narr_errors: dict[str, Any] = {}
  if narr_file.exists():
    try:
      narr_errors = json.loads(narr_file.read_text(encoding="utf-8"))
    except Exception:
      pass

  # 1. 校验 catalog 内所有条目的 message_key 是否在 narratives/errors.json 落地
  for code, entry in catalog_errors.items():
    if not isinstance(entry, dict):
      continue
    mk = str(entry.get("message_key", ""))
    if mk.startswith("errors/"):
      sub_key = mk.split("/", 1)[1]
      if narr_errors and sub_key not in narr_errors:
        violations.append(f"错误码 {code} 的 message_key 「{mk}」未在 narratives.errors 中登记")

  # 2. 扫描 backend/ 下所有 ErrorReporter.emit* 调用中的字面量错误码
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
          line_num = code[:m.start()].count("\n") + 1
          violations.append(f"{rel}:{line_num}: 错误码 「{err_code}」未在 errors_catalog.json 中登记")

  return make_result("TC-ARCH-09: 统一错误上报错误码全域登记与 i18n 键闭环断言", violations)


def check_tc_arch_10(
    ctx: Any,
    make_result: Callable[[str, list[str]], dict[str, Any]],
    strip_comments: Callable[[str], str],
) -> dict[str, Any]:
  """TC-ARCH-10: 持久化核心实体序列化与反序列化双向契约闭环断言。"""
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
      violations.append(f"{rel_res}: 持久化类 {cls_name} 缺失 func serialize() -> Dictionary 实现")
    if not deser_fn_re.search(code):
      violations.append(f"{rel_res}: 持久化类 {cls_name} 缺失 static func deserialize() 实现")

  return make_result("TC-ARCH-10: 持久化核心实体序列化与反序列化双向契约闭环断言", violations)


def check_tc_arch_11(
    ctx: Any,
    make_result: Callable[[str, list[str]], dict[str, Any]],
    strip_comments: Callable[[str], str],
) -> list[dict[str, Any]]:
  """TC-ARCH-11A & TC-ARCH-11B: 业务零裸 print 与 push_error/push_warning 散落白名单守卫。"""
  violations_print: list[str] = []
  violations_push: list[str] = []

  # 11A: 业务零裸 print (mirrors TC-LS-22)
  bare_print_re = re.compile(r"(?<![a-zA-Z0-9_])print\s*\(")
  for gd_file in ctx.backend_files:
    rel = RES_PREFIX + gd_file.relative_to(ctx.root).as_posix()
    _, code = ctx.gd_sources[gd_file]
    for line_idx, line in enumerate(code.splitlines(), 1):
      if bare_print_re.search(line):
        violations_print.append(f"{rel}:{line_idx}: 严禁裸调用 print()，请使用 print_rich() 或 UnifiedLogger")

  # 11B: push_error / push_warning 收敛白名单 (mirrors TC-LG-19)
  push_call_re = re.compile(r"\b(push_error|push_warning)\s*\(")
  scan_roots = [ctx.root / "backend", ctx.root / "frontend"]
  for s_root in scan_roots:
    if not s_root.exists():
      continue
    for gd_file in sorted(s_root.rglob("*.gd")):
      rel_str = gd_file.relative_to(ctx.root).as_posix()
      if rel_str in ALLOWED_PUSH_FILES:
        continue
      raw = gd_file.read_text(encoding="utf-8")
      code = strip_comments(raw)
      for line_idx, line in enumerate(code.splitlines(), 1):
        m = push_call_re.search(line)
        if m:
          rel_res = RES_PREFIX + rel_str
          violations_push.append(
            f"{rel_res}:{line_idx}: 散落调用 {m.group(1)}()（不在收敛白名单中，必须经 ErrorReporter）"
          )

  return [
    make_result("TC-ARCH-11A: 后端业务源码零裸 print 调试残留静态断言", violations_print),
    make_result("TC-ARCH-11B: 全库 push_error/push_warning 散落收敛与白名单守卫", violations_push),
  ]


def check_tc_arch_12(
    ctx: Any,
    make_result: Callable[[str, list[str]], dict[str, Any]],
    strip_comments: Callable[[str], str],
) -> dict[str, Any]:
  """TC-ARCH-12: 英文底座日志与错误动态占位符注入规范静态断言。"""
  violations: list[str] = []
  emit_err_re = re.compile(r'ErrorReporter\.emit_(?:error|warning|fatal)\s*\([^,]+,\s*"[^"]+",\s*"([^"]*)"')
  fail_call_re = re.compile(r'\b_fail\s*\(\s*"[^"]+",\s*"([^"]*)"')
  emit_log_re = re.compile(r'\bemit_log\s*\(\s*"[^"]*",\s*"([^"]*)"')
  chinese_re = re.compile(r'[\u4e00-\u9fff]')
  c_fmt_re = re.compile(r'%[0-9.]*[sdf]')

  for gd_file in ctx.backend_files:
    rel_posix = gd_file.relative_to(ctx.root).as_posix()
    if rel_posix in LEGACY_ERROR_MESSAGE_WHITELIST:
      continue

    _, code = ctx.gd_sources[gd_file]
    for line_idx, line in enumerate(code.splitlines(), 1):
      # 1. 检查 ErrorReporter.emit_* 静态字面量消息
      for m in emit_err_re.finditer(line):
        msg = m.group(1)
        rel_res = RES_PREFIX + rel_posix
        if chinese_re.search(msg):
          violations.append(
            f"{rel_res}:{line_idx}: 错误上报包含硬编码中文「{msg}」，须使用英文底座并在 narratives/errors.json 配置多语言文案"
          )
        if c_fmt_re.search(msg):
          violations.append(
            f"{rel_res}:{line_idx}: 错误上报使用裸格式符「{msg}」，须使用 {{param}} 英文命名占位符并经 TemplateFormatter 注入"
          )

      # 2. 检查 _fail(...) 状态机/解算器失败提示
      for m in fail_call_re.finditer(line):
        msg = m.group(1)
        rel_res = RES_PREFIX + rel_posix
        if chinese_re.search(msg):
          violations.append(
            f"{rel_res}:{line_idx}: 失败提示包含硬编码中文「{msg}」，须使用英文底座并在 narratives/errors.json 配置多语言文案"
          )
        if c_fmt_re.search(msg):
          violations.append(
            f"{rel_res}:{line_idx}: 失败提示使用裸格式符「{msg}」，须使用 {{param}} 英文命名占位符并经 TemplateFormatter 注入"
          )

      # 3. 检查 emit_log(...) 结构化日志消息
      for m in emit_log_re.finditer(line):
        msg = m.group(1)
        rel_res = RES_PREFIX + rel_posix
        if chinese_re.search(msg):
          violations.append(
            f"{rel_res}:{line_idx}: 日志输出包含硬编码中文「{msg}」，须使用英文底座并经占位符动态注入"
          )
        if c_fmt_re.search(msg):
          violations.append(
            f"{rel_res}:{line_idx}: 日志输出使用裸格式符「{msg}」，须使用 {{param}} 英文命名占位符并经 TemplateFormatter 注入"
          )

  return make_result("TC-ARCH-12: 英文底座日志与错误动态占位符注入规范断言", violations)
