#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · GDScript 审查共享工具库)
# 文件路径: WebGames/scripts/py/gd/gd_common.py
# 架构定位: GDScript 源码单趟文件缓存与规则配置共享底盘 (GDScript File & Rules Cache)
# 依赖与触发: 触发方: gd/*.py | 上游: backend/**/*.gd | 下游: 规则检测器 | 运行时: Python 3.10+
# 职责说明: 提供全进程单趟 GDScript 文本缓存、配置规则加载与基础标识符正则是
# 退出语义与设计依据: 纯支持模块，无退出码 | 设计依据: 零瞬态磁盘分配与单趟缓存公理
# ------------------------------------------------------------------------------
# 用法示例:
#   from gd.gd_common import GDFileCache, get_gd_files, get_rules_config
# ==============================================================================
"""GDScript 质量审计共享缓存与正则常量模块。"""

from __future__ import annotations
from pathlib import Path
from typing import Any
import functools
import json
import re
import sys

from audit_common import GD_LOOP_HEAD_RE, resolve_repo_root
ROOT = resolve_repo_root()
CONFIG_RULES_FILE = ROOT / "scripts" / "config" / "code_governance_rules.json"

# ---- 共享命名正则是 ----
FILE_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*\.gd$")
CLASS_NAME_RE = re.compile(r"^[A-Z][A-Za-z0-9_]*$")
SNAKE_RE = re.compile(r"^_?[a-z][a-z0-9_]*$")
UPPER_RE = re.compile(r"^_?[A-Z][A-Z0-9_]*$")
LOOP_RE = GD_LOOP_HEAD_RE


class GDFileCache:
    """全进程单趟 GDScript 文本与行切片内存缓存，消除跨节多趟重复读盘。"""

    _cache: dict[Path, tuple[str, list[str]]] = {}

    @classmethod
    def get(cls, path: Path) -> tuple[str, list[str]]:
        """获取或缓存单个文件的文本与按行切片列表。"""
        res = cls._cache.get(path)
        if res is None:
            text = path.read_text(encoding="utf-8")
            res = (text, text.splitlines())
            cls._cache[path] = res
        return res


@functools.lru_cache(maxsize=None)
def get_gd_files(include_tests: bool = False) -> list[Path]:
    """全库 .gd 文件表单例缓存（含可选 tests 目录）。"""
    roots = [ROOT / "backend", ROOT / "frontend", ROOT / "benchmarks"]
    if include_tests:
        roots.append(ROOT / "tests")
    return sorted(p for r in roots for p in r.rglob("*.gd") if p.is_file())


@functools.lru_cache(maxsize=1)
def get_rules_config() -> dict[str, Any]:
    """code_governance_rules.json 单例加载；缺失/解析失败返回空字典。"""
    if not CONFIG_RULES_FILE.exists():
        return {}
    try:
        return json.loads(CONFIG_RULES_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"[WARN] 无法读取规则文件 {CONFIG_RULES_FILE}: {exc}", file=sys.stderr)
        return {}
