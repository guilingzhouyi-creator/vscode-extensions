#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 静态架构规则扩展)
# 文件路径: WebGames/scripts/py/lib/arch_guard_logging_rules.py
# 架构定位: 日志收敛与英文动态占位符注入静态断言子模块
# 依赖与触发: 触发方: arch_guard_rules / audit_arch_static | 上游: backend/ 与 frontend/ | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 执行 TC-ARCH-11A/B 裸打印与上报收敛白名单断言及 TC-ARCH-12 英文占位符纯净性检查
# 退出语义与设计依据: 规则库模块，无进程退出码 | 设计依据: 全域日志收敛与 i18n 动态注入契约
# ------------------------------------------------------------------------------
# 用法示例:
#   from lib.arch_guard_logging_rules import check_tc_arch_11, check_tc_arch_12
# ==============================================================================
"""架构护栏日志与占位符静态规则子模块 (TC-ARCH-11 / TC-ARCH-12)。"""

from __future__ import annotations
from pathlib import Path
from typing import Any, Callable
import json
import re

from lib.arch_guard_common import RES_PREFIX, iter_gd_sources, strip_string_contents

# 全库 push_error/push_warning 散落收敛白名单（仅保留 T0 启动极早期未就绪 EventBus 时的 Config 装载站点）
ALLOWED_PUSH_FILES: frozenset[str] = frozenset(
    {
        "backend/infrastructure/game_config.gd",
    }
)

# 全库底层应急 stderr 回退白名单（仅允许在日志基础设施双汇点内部使用 printerr）
ALLOWED_PRINTERR_FILES: frozenset[str] = frozenset(
    {
        "backend/infrastructure/event_bus/event_bus_core.gd",
        "backend/infrastructure/logging/unified_logger_service.gd",
    }
)


def check_tc_arch_11(
    ctx: Any,
    make_result: Callable[[str, list[str]], dict[str, Any]],
    strip_comments: Callable[[str], str],
) -> list[dict[str, Any]]:
    """TC-ARCH-11A & TC-ARCH-11B: 全库业务与视图零裸 print/printerr 及 push_error/push_warning 收敛守卫。"""
    violations_print: list[str] = []
    violations_push: list[str] = []

    bare_print_re = re.compile(r"(?<![a-zA-Z0-9_.])print\s*\(")
    bare_printerr_re = re.compile(r"(?<![a-zA-Z0-9_.])printerr\s*\(")
    push_call_re = re.compile(r"\b(push_error|push_warning)\s*\(")

    for rel_posix, code in iter_gd_sources(ctx, strip_comments):
        rel_res = RES_PREFIX + rel_posix
        masked = strip_string_contents(code)
        allow_printerr = rel_posix in ALLOWED_PRINTERR_FILES
        allow_push = rel_posix in ALLOWED_PUSH_FILES

        for line_idx, line in enumerate(masked.splitlines(), 1):
            if bare_print_re.search(line):
                violations_print.append(
                    f"{rel_res}:{line_idx}: 严禁裸调用 print()，请改用 EventBusCore.emit_log 或 NavManager.show_toast"
                )
            if not allow_printerr and bare_printerr_re.search(line):
                violations_print.append(
                    f"{rel_res}:{line_idx}: 严禁在日志汇点外裸调用 printerr()，请改用 ErrorReporter 或 EventBusCore.emit_log"
                )
            if not allow_push:
                m = push_call_re.search(line)
                if m:
                    violations_push.append(
                        f"{rel_res}:{line_idx}: 散落调用 {m.group(1)}()（不在收敛白名单中，必须经 ErrorReporter）"
                    )

    return [
        make_result(
            "TC-ARCH-11A: 全库业务与视图零裸 print/printerr 静态断言", violations_print
        ),
        make_result(
            "TC-ARCH-11B: 全库 push_error/push_warning 散落收敛与白名单守卫",
            violations_push,
        ),
    ]


def check_tc_arch_12(
    ctx: Any,
    make_result: Callable[[str, list[str]], dict[str, Any]],
    strip_comments: Callable[[str], str],
) -> dict[str, Any]:
    """TC-ARCH-12: 全库英文日志、错误上报与前端提示动态占位符注入规范静态断言。"""
    violations: list[str] = []
    channel_patterns: tuple[tuple[str, re.Pattern[str]], ...] = (
        ("错误上报", re.compile(r'ErrorReporter\.emit_(?:error|warning|fatal)\s*\(\s*[^,()]+\s*,\s*[^,()]+\s*,\s*"([^"\n]*)"')),
        ("日志采集", re.compile(r'LogCollector\.log\s*\(\s*[^,()]+\s*,\s*[^,()]+\s*,\s*"([^"\n]*)"')),
        ("失败提示", re.compile(r'\b_fail\s*\([^()\n]*"([^"\n]*)"')),
        ("日志输出", re.compile(r'\bemit_log\s*\(\s*[^,()\n]+\s*,\s*"([^"\n]*)"')),
        ("占位符模版", re.compile(r'TemplateFormatter\.format\s*\(\s*"([^"\n]*)"')),
        ("界面轻提示", re.compile(r'\bshow_toast\s*\(\s*"([^"\n]*)"')),
    )
    chinese_re = re.compile(r"[\u4e00-\u9fff]")
    c_fmt_re = re.compile(r"%[0-9.]*[sdf]|\{\d+\}")

    for rel_posix, code in iter_gd_sources(ctx, strip_comments):
        rel_res = RES_PREFIX + rel_posix
        for label, pat in channel_patterns:
            for m in pat.finditer(code):
                msg = m.group(1)
                line_idx = code[: m.start()].count("\n") + 1
                if chinese_re.search(msg):
                    target_hint = " UIIntermediary.text" if label == "界面轻提示" else "英文模板并经动态占位符注入"
                    violations.append(f"{rel_res}:{line_idx}: {label}包含硬编码中文「{msg}」，须使用{target_hint}")
                if c_fmt_re.search(msg):
                    violations.append(
                        f"{rel_res}:{line_idx}: {label}使用裸格式符「{msg}」，须使用 {{param}} 英文命名占位符并经 TemplateFormatter 注入"
                    )

    _check_json_placeholder_configs(ctx, chinese_re, c_fmt_re, strip_comments, violations)
    return make_result("TC-ARCH-12: 英文日志与错误动态占位符注入规范断言", violations)


def _check_json_placeholder_configs(
    ctx: Any,
    chinese_re: re.Pattern[str],
    c_fmt_re: re.Pattern[str],
    strip_comments: Callable[[str], str],
    violations: list[str],
) -> None:
    pers_cfg = ctx.root / "config" / "infrastructure" / "persistence.json"
    if pers_cfg.exists():
        try:
            msgs = json.loads(pers_cfg.read_text(encoding="utf-8")).get("messages", {})
            if isinstance(msgs, dict):
                for mk, mv in msgs.items():
                    if isinstance(mv, str) and c_fmt_re.search(mv):
                        violations.append(
                            f"res://config/infrastructure/persistence.json: messages.{mk} 使用裸格式符「{mv}」，须改为 {{param}} 命名占位符"
                        )
        except Exception as exc:
            violations.append(f"res://config/infrastructure/persistence.json 解析异常: {exc}")

    base_msg_file: Path = ctx.root / "backend" / "infrastructure" / "logging" / "system_base_messages.gd"
    if base_msg_file.exists():
        b_code = strip_comments(base_msg_file.read_text(encoding="utf-8"))
        for m_const in re.finditer(r'const\s+(MSG_[A-Z0-9_]+)\s*:\s*String\s*=\s*"([^"\n]*)"', b_code):
            if chinese_re.search(m_const.group(2)) or c_fmt_re.search(m_const.group(2)):
                violations.append(
                    f"res://backend/infrastructure/logging/system_base_messages.gd: {m_const.group(1)} 违反英文 {{param}} 模板纯洁性契约"
                )

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
        except (OSError, ValueError) as exc:
            violations.append(f"res://config/infrastructure/log.json 解析异常: {exc}")
