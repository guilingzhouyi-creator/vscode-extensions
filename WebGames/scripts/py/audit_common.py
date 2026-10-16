#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 通用底座)
# 文件路径: WebGames/scripts/py/audit_common.py
# 架构定位: 基础设施公共库 (Infrastructure Shared Base)
# 依赖与触发: 触发方: 全域 Python 审计工具 | 上游: 标准库 | 下游: 审计脚本 | 运行时: Python 3.10+
# 职责说明: 提供 UTF-8 控制台编码保障、跨平台仓库根路径解析与统一错误输出格式
# 退出语义与设计依据: 退出码: 纯工具库无直接退出码 | 设计依据: 跨平台一致性底座契约
# ------------------------------------------------------------------------------
# 用法示例:
#   from audit_common import ensure_utf8_stdout, resolve_repo_root
# ==============================================================================
"""脚本库共享底座：为各 audit_*.py 引擎提供公共工具与常量（被 import，无独立 CLI）。"""

from dataclasses import dataclass, field
from pathlib import Path
import json
import logging
import re
import sys
from typing import Any, Dict, List, Pattern

CHARSET_UTF8 = "utf-8"
ERR_IGNORE = "ignore"
ERR_REPLACE = "replace"
PLATFORM_WINDOWS = "win32"
SEVERITY_DEFAULT = "error"
CATEGORY_DEFAULT = "general"
SEPARATOR_WIDTH = 80
SEPARATOR_CHAR = "-"
KALAR_DEV_PREFIX = "KALAR-DEV-2026"

KEY_RULE = "rule"
KEY_RULE_ID = "rule_id"
KEY_FILE = "file"
KEY_LINE = "line"
KEY_SEVERITY = "severity"
KEY_CATEGORY = "category"
KEY_MESSAGE = "message"
KEY_SUGGESTION = "suggestion"
KEY_CONTEXT = "context"

LOGGER = logging.getLogger("audit_common")


def resolve_repo_root() -> Path:
    """唯一仓库根解析（消除 parents 深度漂移）。"""
    return Path(__file__).resolve().parents[2]


def ensure_utf8_stdout() -> None:
    """保障跨平台 UTF-8 控制台输出，避免 Windows 控制台异常编码。"""
    if sys.platform == PLATFORM_WINDOWS and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding=CHARSET_UTF8, errors=ERR_REPLACE)
            sys.stderr.reconfigure(encoding=CHARSET_UTF8, errors=ERR_REPLACE)
        except (AttributeError, io.UnsupportedOperation) as exc:
            LOGGER.debug("Console reconfigure suppressed: %s", exc)


def load_json(path: Path) -> Dict[str, Any]:
    """容错读取 JSON 文件，路径不存在或解析失败返回空字典。"""
    if not path.is_file():
        return {}
    try:
        raw_text = path.read_text(encoding=CHARSET_UTF8, errors=ERR_IGNORE)
        return json.loads(raw_text)
    except (json.JSONDecodeError, OSError) as exc:
        LOGGER.debug("Failed reading JSON %s: %s", path, exc)
        return {}


@dataclass
class Finding:
    """审计发现条目结构体。"""

    rule: str
    file: str
    line: int
    message: str
    suggestion: str = ""
    severity: str = SEVERITY_DEFAULT
    category: str = CATEGORY_DEFAULT
    context: Dict[str, Any] = field(default_factory=dict)

    @property
    def rule_id(self) -> str:
        """获取规则唯一标识符。"""
        return self.rule

    @rule_id.setter
    def rule_id(self, val: str) -> None:
        """设置规则唯一标识符。"""
        self.rule = val

    @property
    def file_path(self) -> str:
        """获取违规文件路径。"""
        return self.file

    @file_path.setter
    def file_path(self, val: str) -> None:
        """设置违规文件路径。"""
        self.file = val

    @property
    def line_number(self) -> int:
        """获取违规所在行号。"""
        return self.line

    @line_number.setter
    def line_number(self, val: int) -> None:
        """设置违规所在行号。"""
        self.line = val

    def to_dict(self) -> Dict[str, Any]:
        """将发现条目转换为标准字典表示。"""
        return {
            KEY_RULE: self.rule,
            KEY_RULE_ID: self.rule,
            KEY_FILE: self.file,
            KEY_LINE: self.line,
            KEY_SEVERITY: self.severity,
            KEY_CATEGORY: self.category,
            KEY_MESSAGE: self.message,
            KEY_SUGGESTION: self.suggestion,
            KEY_CONTEXT: self.context,
        }


def print_conclusion(violations: List[str], hints: List[str], name: str) -> int:
    """统一结论打印，输出标准结论行并返回进程退出码。"""
    count_summary = f"违规总数: {len(violations)} / 提示: {len(hints)}"
    print(count_summary)
    if violations:
        formatted_violations = "\n".join(f"  ✗ {v}" for v in violations)
        print(formatted_violations)
    if hints:
        formatted_hints = "\n".join(f"  · {h}" for h in hints)
        print(formatted_hints)

    divider = SEPARATOR_CHAR * SEPARATOR_WIDTH
    print(divider)
    if violations:
        print(f"【审查结论】未通过（{name} 违规，已阻断！）")
        return 1
    print(f"【审查结论】通过（{name} 合规）")
    return 0


LEGACY_PLACEHOLDER_RE = re.compile(r"%[sd]|%\.\d*f|\{\}")


def scan_legacy_placeholders(text: str) -> List[str]:
    """扫描文本中遗留的旧式占位符（如 %s, %.1f, 空 {}）。"""
    return LEGACY_PLACEHOLDER_RE.findall(text)


CJK_RE = re.compile(r"[\u4e00-\u9fff]")


def contains_cjk(text: str) -> bool:
    """检测输入文本是否包含中文字符。"""
    return bool(CJK_RE.search(text))


def key_contract_re() -> Pattern[str]:
    """生成三段式点分小写键契约正则表达式（<域>.<条目>.<字段>）。"""
    return re.compile(r"[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+")


GD_LOOP_HEAD_RE = re.compile(r"^\s*(for|while)\s+.+:\s*(#.*)?$")
GD_GAMECONFIG_GETTER_RE = re.compile(r"GameConfig\.\w+\(")
