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
import re
import sys

## 唯一仓库根解析（消除 parents[2] / parent.parent.parent / parent 三变体深度漂移）
def resolve_repo_root() -> Path:
    return Path(__file__).resolve().parents[2]

## utf-8 输出样板（Windows 控制台安全；幂等）
def ensure_utf8_stdout() -> None:
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

## 容错 JSON 读取（不抛 Fatal；路径不存在返回空 dict）
def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        return {}

@dataclass
class Finding:
    rule: str
    file: str
    line: int
    message: str
    suggestion: str = ""
    severity: str = "error"
    category: str = "general"
    context: dict = field(default_factory=dict)

    @property
    def rule_id(self) -> str:
        return self.rule

    @rule_id.setter
    def rule_id(self, val: str) -> None:
        self.rule = val

    @property
    def file_path(self) -> str:
        return self.file

    @file_path.setter
    def file_path(self, val: str) -> None:
        self.file = val

    @property
    def line_number(self) -> int:
        return self.line

    @line_number.setter
    def line_number(self, val: int) -> None:
        self.line = val

    def to_dict(self) -> dict:
        return {
            "rule": self.rule,
            "rule_id": self.rule,
            "file": self.file,
            "line": self.line,
            "severity": self.severity,
            "category": self.category,
            "message": self.message,
            "suggestion": self.suggestion,
            "context": self.context,
        }

## 统一结论打印（「审查结论」分级一致性；返回进程退出码）
def print_conclusion(violations: list, hints: list, name: str) -> int:
    print(f"违规总数: {len(violations)} / 提示: {len(hints)}")
    for v in violations:
        print(f"  ✗ {v}")
    for h in hints:
        print(f"  · {h}")
    print("-" * 80)
    if violations:
        print(f"【审查结论】未通过（{name} 违规，已阻断！）")
        return 1
    print(f"【审查结论】通过（{name} 合规）")
    return 0

## ---- 三检查项共享助手（收敛跨脚本重写，语义与原逻辑一致）----

## 旧式占位符残留（%s / %.1f / 空 {}）
LEGACY_PLACEHOLDER_RE = re.compile(r"%[sd]|%\.\d*f|\{\}")

def scan_legacy_placeholders(text: str) -> list:
    return LEGACY_PLACEHOLDER_RE.findall(text)

## 档号编号体系前缀（G2 审查收敛：集中单一声明，替换散落字面量）。
## KALAR-DEV-<年度> 为卡拉尔开发档体系唯一前缀，audit_docs.py / archive_volume.py
## 归档命名正则与档号生成均引用本常量——年度/体系演进只改此处。
KALAR_DEV_PREFIX = "KALAR-DEV-2026"

## 中文（CJK）检测：含 \u4e00-\u9fff 区间即判定含中文
CJK_RE = re.compile(r"[\u4e00-\u9fff]")

def contains_cjk(text: str) -> bool:
    return bool(CJK_RE.search(text))

## 键契约正则：三段式点分小写键（<域>.<条目>.<字段>）
def key_contract_re() -> re.Pattern:
    return re.compile(r"[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+")

## ---- GDScript 循环/配置共享正则（Phase 60 收敛：audit_gd.py 与 audit_perf_hotspots.py 同字面量）----
## GD 循环头（for/while …:，尾随注释容忍）；GameConfig 类型化读取（循环内热点判定用）
GD_LOOP_HEAD_RE = re.compile(r"^\s*(for|while)\s+.+:\s*(#.*)?$")
GD_GAMECONFIG_GETTER_RE = re.compile(r"GameConfig\.\w+\(")
