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

# 全库 push_error/push_warning 散落收敛白名单（仅保留 T0 启动极早期且未就绪 EventBus 时的 Config 装载站点；所有 T1/T2 均已清零迁移）
ALLOWED_PUSH_FILES: frozenset[str] = frozenset({
  "backend/infrastructure/game_config.gd",
})

# 全库底层应急 stderr 回退 白名单（仅允许在日志基础设施底座双汇点内部使用 printerr）
ALLOWED_PRINTERR_FILES: frozenset[str] = frozenset({
  "backend/infrastructure/event_bus/event_bus_core.gd",
  "backend/infrastructure/logging/unified_logger_service.gd",
})

# 存量旧模块错误消息硬编码中文与裸格式符渐进演进白名单（已全部清零完成英文底座改造）
LEGACY_ERROR_MESSAGE_WHITELIST: frozenset[str] = frozenset()

_STRING_TOKEN_RE = re.compile(r'("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\')')


def _strip_string_contents(comment_stripped: str) -> str:
  """将注释已剥离的源码中的字符串字面量内部替换为空格，保留行偏移与引号边界。"""
  def repl(m: re.Match[str]) -> str:
    s = m.group(0)
    return s[0] + (" " * (len(s) - 2)) + s[-1]
  return _STRING_TOKEN_RE.sub(repl, comment_stripped)


def _iter_gd_sources(
    ctx: Any,
    strip_comments: Callable[[str], str],
) -> list[tuple[str, str]]:
  """遍历 backend 与 frontend 全量 .gd 源码并返回 (relative_posix, comment_stripped_code)。"""
  entries: list[tuple[str, str]] = []
  for sub in ("backend", "frontend"):
    root_dir: Path = ctx.root / sub
    if not root_dir.exists():
      continue
    for gd_file in sorted(root_dir.rglob("*.gd")):
      rel_posix = gd_file.relative_to(ctx.root).as_posix()
      cached = ctx.gd_sources.get(gd_file)
      if cached is not None:
        entries.append((rel_posix, cached[1]))
      else:
        raw = gd_file.read_text(encoding="utf-8")
        entries.append((rel_posix, strip_comments(raw)))
  return entries

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
  """TC-ARCH-11A & TC-ARCH-11B: 全库业务与视图零裸 print/printerr 及 push_error/push_warning 收敛守卫。"""
  violations_print: list[str] = []
  violations_push: list[str] = []

  # 11A: 全库业务与视图零裸 print() / printerr() (mirrors TC-LS-22)
  bare_print_re = re.compile(r"(?<![a-zA-Z0-9_.])print\s*\(")
  bare_printerr_re = re.compile(r"(?<![a-zA-Z0-9_.])printerr\s*\(")
  push_call_re = re.compile(r"\b(push_error|push_warning)\s*\(")

  for rel_posix, code in _iter_gd_sources(ctx, strip_comments):
    rel_res = RES_PREFIX + rel_posix
    masked = _strip_string_contents(code)
    allow_printerr = rel_posix in ALLOWED_PRINTERR_FILES
    allow_push = rel_posix in ALLOWED_PUSH_FILES

    for line_idx, line in enumerate(masked.splitlines(), 1):
      if bare_print_re.search(line):
        violations_print.append(f"{rel_res}:{line_idx}: 严禁裸调用 print()，请改用 EventBusCore.emit_log 或 NavManager.show_toast")
      if not allow_printerr and bare_printerr_re.search(line):
        violations_print.append(f"{rel_res}:{line_idx}: 严禁在日志底座双汇点外裸调用 printerr()，请改用 ErrorReporter 或 EventBusCore.emit_log")
      if not allow_push:
        m = push_call_re.search(line)
        if m:
          violations_push.append(
            f"{rel_res}:{line_idx}: 散落调用 {m.group(1)}()（不在收敛白名单中，必须经 ErrorReporter）"
          )

  return [
    make_result("TC-ARCH-11A: 全库业务与视图零裸 print/printerr 静态断言", violations_print),
    make_result("TC-ARCH-11B: 全库 push_error/push_warning 散落收敛与白名单守卫", violations_push),
  ]


def check_tc_arch_12(
    ctx: Any,
    make_result: Callable[[str, list[str]], dict[str, Any]],
    strip_comments: Callable[[str], str],
) -> dict[str, Any]:
  """TC-ARCH-12: 全库英文底座日志、错误上报与前端提示动态占位符注入规范静态断言。"""
  violations: list[str] = []
  channel_patterns: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("错误上报", re.compile(r'ErrorReporter\.emit_(?:error|warning|fatal)\s*\(\s*[^,()]+\s*,\s*[^,()]+\s*,\s*"([^"\n]*)"')),
    ("错误迁移", re.compile(r'ErrorReporter\.migrate_push_error\s*\(\s*[^,()]+\s*,\s*"([^"\n]*)"')),
    ("日志采集", re.compile(r'LogCollector\.log\s*\(\s*[^,()]+\s*,\s*[^,()]+\s*,\s*"([^"\n]*)"')),
    ("失败提示", re.compile(r'\b_fail\s*\([^()\n]*"([^"\n]*)"')),
    ("日志输出", re.compile(r'\bemit_log\s*\(\s*[^,()\n]+\s*,\s*"([^"\n]*)"')),
    ("占位符模版", re.compile(r'TemplateFormatter\.format\s*\(\s*"([^"\n]*)"')),
    ("界面轻提示", re.compile(r'\bshow_toast\s*\(\s*"([^"\n]*)"')),
  )
  chinese_re = re.compile(r'[\u4e00-\u9fff]')
  c_fmt_re = re.compile(r'%[0-9.]*[sdf]|\{\d+\}')

  for rel_posix, code in _iter_gd_sources(ctx, strip_comments):
    if rel_posix in LEGACY_ERROR_MESSAGE_WHITELIST:
      continue

    rel_res = RES_PREFIX + rel_posix
    for label, pat in channel_patterns:
      for m in pat.finditer(code):
        msg = m.group(1)
        line_idx = code[:m.start()].count("\n") + 1
        if chinese_re.search(msg):
          target_hint = " UIIntermediary.text" if label == "界面轻提示" else "英文底座并经动态占位符注入"
          violations.append(
            f"{rel_res}:{line_idx}: {label}包含硬编码中文「{msg}」，须使用{target_hint}"
          )
        if c_fmt_re.search(msg):
          violations.append(
            f"{rel_res}:{line_idx}: {label}使用裸格式符「{msg}」，须使用 {{param}} 英文命名占位符并经 TemplateFormatter 注入"
          )

  # 校验基础设施持久化文案表零裸格式符（统一使用 {param} 命名占位符）
  pers_cfg = ctx.root / "config" / "infrastructure" / "persistence.json"
  if pers_cfg.exists():
    try:
      p_data = json.loads(pers_cfg.read_text(encoding="utf-8"))
      msgs = p_data.get("messages", {})
      if isinstance(msgs, dict):
        for mk, mv in msgs.items():
          if isinstance(mv, str) and c_fmt_re.search(mv):
            violations.append(
              f"res://config/infrastructure/persistence.json: messages.{mk} 使用裸格式符「{mv}」，须改为 {{param}} 命名占位符"
            )
    except Exception:
      pass

  # 校验合规标准英文底座文本库：MSG_* 严禁混入中文或裸 %s/%d/{0} 占位符
  base_msg_file: Path = ctx.root / "backend" / "infrastructure" / "logging" / "system_base_messages.gd"
  if base_msg_file.exists():
    b_raw = base_msg_file.read_text(encoding="utf-8")
    b_code = strip_comments(b_raw)
    for m_const in re.finditer(r'const\s+(MSG_[A-Z0-9_]+)\s*:\s*String\s*=\s*"([^"\n]*)"', b_code):
      const_name, tmpl_val = m_const.group(1), m_const.group(2)
      if chinese_re.search(tmpl_val) or c_fmt_re.search(tmpl_val):
        violations.append(
          f"res://backend/infrastructure/logging/system_base_messages.gd: {const_name} 违反英文 {{param}} 底座纯洁性契约"
        )

  # 校验 log.json 事件模板全部使用 {param} 命名占位符（防 %s/%d/{0} 回流）
  log_cfg: Path = ctx.root / "config" / "infrastructure" / "log.json"
  if log_cfg.exists():
    try:
      l_data = json.loads(log_cfg.read_text(encoding="utf-8"))
      for section_key in ("events", "unified_events"):
        evs = l_data.get(section_key, {})
        if isinstance(evs, dict):
          for ek, ev in evs.items():
            if isinstance(ev, str) and c_fmt_re.search(ev):
              violations.append(
                f"res://config/infrastructure/log.json: {section_key}.{ek} 禁止使用裸 %s/%d/{{0}} 占位符「{ev}」"
              )
    except (OSError, ValueError):
      pass

  return make_result("TC-ARCH-12: 英文底座日志与错误动态占位符注入规范断言", violations)


ALLOWED_CRYPTO_FILES: frozenset[str] = frozenset({
  "backend/infrastructure/pure/crypto_integrity_lib.gd",
})
_UNSAFE_MAC_EQ_RE = re.compile(
  r"\b(?:expected_mac|mac_hex|recorded_seal|expected_hmac|recorded_hash)\b\s*[!=]=\s*"
)
_HARDCODED_KEY_LITERAL_RE = re.compile(
  r'(?:const|var)\s+[a-z0-9_]*(?:seal_key|hmac_key|aes_key|private_key|master_secret|signing_key)\b[^=\n]*=\s*"([^"\n]{8,})"',
  re.IGNORECASE,
)


def check_tc_arch_13(
    ctx: Any,
    make_result: Callable[[str, list[str]], dict[str, Any]],
    strip_comments: Callable[[str], str],
) -> dict[str, Any]:
  """TC-ARCH-13: 密码学纯计算库边界隔离、常量时间比对与零静态密钥字面量断言。"""
  violations: list[str] = []
  crypto_raw_re = re.compile(r"\b(?:AESContext|Crypto)\.new\s*\(|\.hmac_digest\s*\(")

  for rel_posix, code in _iter_gd_sources(ctx, strip_comments):
    rel_res = RES_PREFIX + rel_posix
    is_crypto_lib = rel_posix in ALLOWED_CRYPTO_FILES
    masked = _strip_string_contents(code)

    for idx, (raw_ln, m_ln) in enumerate(zip(code.splitlines(), masked.splitlines()), 1):
      if not is_crypto_lib and crypto_raw_re.search(m_ln):
        violations.append(
          f"{rel_res}:{idx}: 禁止在 CryptoIntegrityLib 之外直接调用 AESContext/Crypto/hmac_digest（CRYPTO-ISOLATION-001）"
        )
      if not is_crypto_lib and _UNSAFE_MAC_EQ_RE.search(m_ln):
        violations.append(
          f"{rel_res}:{idx}: 敏感 MAC/Seal/Hash 校验禁止直接 ==/!= 比对，必须调用 CryptoIntegrityLib.constant_time_equals（CRYPTO-TIMING-001）"
        )
      km = _HARDCODED_KEY_LITERAL_RE.search(raw_ln)
      if km and not re.match(r"^[A-Z0-9_]+$", km.group(1)):
        violations.append(
          f"{rel_res}:{idx}: 疑似硬编码静态密钥字面量，必须由环境变量或安全 Vault 动态注入（CRYPTO-SECRET-001）"
        )

  return make_result("TC-ARCH-13: 密码学域库边界隔离与防时序侧信道合规断言", violations)
