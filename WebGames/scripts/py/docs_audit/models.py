#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 文档质量门禁模型层)
# 文件路径: WebGames/scripts/py/docs_audit/models.py
# 架构定位: 文档治理领域模型与规则常量基座 (Models, Constants & Baseline DTO)
# 依赖与触发: 触发方: docs_audit 内部模块 | 上游: docs_governance_rules.json | 下游: 门禁检查器 | 运行时: Python 3.10+
# 职责说明: 文档治理核心领域模型、真源规则加载器、正则常量集与基线棘轮序列化
# 退出语义与设计依据: 退出码: 纯数据模型与基线计算无独立退出码 | 设计依据: AGENTS.md 施工细则与文档门禁契约
# ------------------------------------------------------------------------------
# 用法示例:
#   from docs_audit.models import Finding, Doc, RULES
# ==============================================================================
"""文档治理核心领域模型、真源规则加载器与基线棘轮序列化。"""
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from audit_common import KALAR_DEV_PREFIX, resolve_repo_root

ROOT = resolve_repo_root()
DOCS_DIR = "docs"

SEV_ERROR = "error"
SEV_WARN = "warn"

DOC_RULES_FILE = ROOT / "scripts" / "config" / "docs_governance_rules.json"


def load_doc_rules() -> tuple:
    """加载文档治理规则真源（RULES + NAMING_RULES）。"""
    if not DOC_RULES_FILE.exists():
        print(f"[ERROR] 文档治理规则真源缺失: {DOC_RULES_FILE}（新增规则请改 JSON）", file=sys.stderr)
        sys.exit(2)
    try:
        data = json.loads(DOC_RULES_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[ERROR] 文档治理规则真源解析失败 {DOC_RULES_FILE}: {e}", file=sys.stderr)
        sys.exit(2)

    rules: dict = {}
    for rid, meta in (data.get("rules", {}) or {}).items():
        sev = SEV_ERROR if str(meta.get("severity", "error")) == "error" else SEV_WARN
        rules[str(rid)] = (sev, bool(meta.get("fixable", False)), str(meta.get("desc", "")))
    return rules, data.get("naming_rules", []) or []


RULES, NAMING_RULES = load_doc_rules()

CN_NUMERALS = "一二三四五六七八九十"

FENCE_RE = re.compile(r"^(\s*)```(\w*)")
TABLE_ROW_RE = re.compile(r"^\s*\|")
WS_TAIL_RE = re.compile(r"[ \t]+$")
BR_TAG_RE = re.compile(r"<br>")
HEADING_PLAIN_RE = re.compile(r"^#{1,6}\s+(.*)$")
HEADING_NOSPACE_RE = re.compile(r"^(#{1,6})([^#\s].*)$")
ABSLINK_RE = re.compile(r"\]\(\s*file:///[^)\s]+\s*\)")
RELLINK_RE = re.compile(r"\]\(([^)\s]+)\)")
LIST_PREFIX_RE = re.compile(r"^\s*(?:[-*+]\s|\d+[.)]\s)")


def slugify(text: str) -> str:
    """GitHub 风格标题锚 slug：小写、去标点、空格转 -，保留 CJK。"""
    t = text.strip().lower()
    t = re.sub(r"[^\w\u4e00-\u9fff\- ]", "", t)
    return t.replace(" ", "-")


@dataclass
class Finding:
    rule: str
    file: str            # 相对 WebGames 根的 posix 路径
    line: int = 0        # 1-based；目录级发现为 0
    message: str = ""
    suggestion: str = ""  # Agent 决策辅助：建议名 / 候选锚点 / 修复预览
    extra: dict = field(default_factory=dict)
    is_new: bool = False  # 基线棘轮模式下：True=超出基线的新增违规（阻断门禁）

    def to_dict(self) -> dict:
        d = {
            "rule": self.rule,
            "severity": RULES[self.rule][0],
            "file": self.file,
            "line": self.line,
            "message": self.message,
            "fixable": RULES[self.rule][1],
            "new": self.is_new,
        }
        if self.suggestion:
            d["suggestion"] = self.suggestion
        if self.extra:
            d["extra"] = self.extra
        return d


@dataclass
class Doc:
    path: Path
    rel: str
    text: str
    eol: str
    lines: list
    inside: list          # 每行是否处于代码围栏内
    heading_slugs: set = field(default_factory=set)
    has_mermaid: bool = False   # 装载期预判，审查期快速跳过非图表文件


def split_fences(lines: list) -> list:
    """标记每行是否处于围栏内（成对切换；奇数围栏 → 末行 inside=True，供审查）。"""
    inside, state = [], False
    for ln in lines:
        inside.append(state)
        if FENCE_RE.match(ln):
            state = not state
    return inside


def load_baseline(path: str) -> dict:
    """读取基线文件 → {(rule, file): count}。"""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("schema") != "docs-audit-baseline/v1":
        raise ValueError(f"基线 schema 不受支持: {data.get('schema')}")
    return {(e["rule"], e["file"]): e["count"] for e in data.get("entries", [])}


def apply_baseline(findings: list, base: dict) -> int:
    """棘轮比对：每 (rule,file) 前 base.get(key,0) 条视为已接受存量，超出部分标记 is_new。"""
    emitted: dict = {}
    new = 0
    for f in findings:
        key = (f.rule, f.file)
        emitted[key] = emitted.get(key, 0) + 1
        f.is_new = emitted[key] > base.get(key, 0)
        if f.is_new:
            new += 1
    return new


def write_baseline(path: str, findings: list) -> None:
    """以当前 findings 快照写入基线（--update-baseline 专用，仅限真实消化存量后）。"""
    from collections import Counter
    c = Counter((f.rule, f.file) for f in findings)
    payload = {
        "schema": "docs-audit-baseline/v1",
        "generated": datetime.now().isoformat(timespec="seconds"),
        "summary": {
            "errors": sum(1 for f in findings if RULES[f.rule][0] == SEV_ERROR),
            "warnings": sum(1 for f in findings if RULES[f.rule][0] == SEV_WARN),
        },
        "entries": [{"rule": r, "file": fl, "count": n} for (r, fl), n in sorted(c.items())],
    }
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

