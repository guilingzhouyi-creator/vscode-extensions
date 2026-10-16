#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 门禁调度中枢)
# 文件路径: WebGames/scripts/py/audit_runner.py
# 架构定位: 并行任务调度总控 (Parallel Audit Dispatcher)
# 依赖与触发: 触发方: audit-all / CI | 上游: 全域子审计脚本 | 下游: 控制台汇总报告与 JSON | 运行时: Python 3.10+
# 职责说明: 统一编排并异步并行调度 20 项静态门禁，支持差异范围过滤、工作线程池与结构化聚合输出
# 退出语义与设计依据: 退出码: 0=全部门禁通过, 1=存在阻断违规, 2=环境异常 | 设计依据: AGENTS.md 构建门禁通用契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_runner.py
#   python scripts/py/audit_runner.py --diff
#   python scripts/py/audit_runner.py -j 4
# ==============================================================================
import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field, replace
from pathlib import Path
from audit_common import ensure_utf8_stdout, resolve_repo_root
from typing import List, Set, Optional, Dict

ensure_utf8_stdout()

ROOT_DIR = resolve_repo_root()
PY_SCRIPTS_DIR = Path(__file__).resolve().parent
# 基准规范（脚本库治理）：注册表完备性自检引擎前缀（与磁盘 snake_case 命名一致）
ENGINE_PREFIXES = ("audit_", "report_", "archive_")
# 基准规范（脚本库治理）：注册表完备性自检豁免清单（driver / 共享底座 / legacy 占位，均非独立任务引擎）
REGISTRY_EXEMPT = {
    "audit_runner.py",   # driver：统一调度入口
    "audit_common.py",   # 共享底座：resolve_repo_root/ensure_utf8_stdout 等
    "audit_arch.py",     # headless runner：无头 Godot 运行器，保留供回归验证，调度中枢统一采用原生静态 audit_arch_static.py
}

# 调度引擎版本（单一真源：SARIF tool.version / --version / 报告元数据统一引用本常量）
AUDIT_RUNNER_VERSION = "1.3.0"

# ANSI 颜色定义
C_RESET = "\033[0m"
C_BOLD = "\033[1m"
C_RED = "\033[31m"
C_GREEN = "\033[32m"
C_YELLOW = "\033[33m"
C_BLUE = "\033[34m"
C_CYAN = "\033[36m"
C_GRAY = "\033[90m"

# 常量定义
SCOPE_DOCS = "docs"
SCOPE_ALL = "all"
ENCODING_UTF8 = "utf-8"


@dataclass
class AuditTask:
    task_id: str
    name: str
    script_name: str
    default_args: List[str] = field(default_factory=list)
    scopes: Set[str] = field(default_factory=set)  # 'config', 'gd', 'docs', 'all', 'test'
    group: str = "audit"        # audit | bench | archive（统一调度入口）
    exclusive: bool = False     # True=独享串行（写操作任务，如归档，防并行写冲突）


@dataclass
class TaskResult:
    task: AuditTask
    returncode: int
    stdout: str
    stderr: str
    elapsed_sec: float
    skipped: bool = False
    skip_reason: str = ""


# 注册全量 10 大门禁审查任务
AUDIT_TASKS: List[AuditTask] = [
    AuditTask(
        task_id="config",
        name="配置表结构与基础约束",
        script_name="audit_config.py",
        default_args=["--strict"],
        scopes={"config"}
    ),
    AuditTask(
        task_id="gd",
        name="GDScript 质量治理统一审查（Style+Advanced+Simplification）",
        script_name="audit_gd.py",
        default_args=[],
        scopes={"gd"}
    ),
    AuditTask(
        task_id="hardcode",
        name="零硬编码与调试残留扫描",
        script_name="audit_hardcode.py",
        default_args=[],
        scopes={"gd"}
    ),
    AuditTask(
        task_id="perf",
        name="性能热点与循环开销扫描",
        script_name="audit_perf_hotspots.py",
        default_args=[],
        scopes={"gd"}
    ),
    AuditTask(
        task_id="coverage",
        name="测试套件覆盖率基线",
        script_name="audit_test_coverage.py",
        default_args=[],
        scopes={"gd", "test"}
    ),
    AuditTask(
        task_id="config_unused",
        name="配置表死配置与未引用扫描",
        script_name="audit_config_unused.py",
        default_args=[],
        scopes={"config", "gd"}
    ),
    AuditTask(
        task_id="item_keys",
        name="物品标准三元组与命名空间",
        script_name="audit_item_keys.py",
        default_args=[],
        scopes={"config", "gd"}
    ),
    AuditTask(
        task_id="secrets",
        name="密钥与敏感凭证泄露扫描",
        script_name="audit_secrets.py",
        default_args=[],
        scopes={"all"}
    ),
    AuditTask(
        task_id="bounds",
        name="数值上下界与物理量守恒溢出",
        script_name="audit_bounds.py",
        default_args=[],
        scopes={"gd", "config"}
    ),
    AuditTask(
        task_id="name_keys",
        name="全局名称键统一注册表",
        script_name="audit_name_keys.py",
        default_args=[],
        scopes={"config", "gd"}
    ),
    AuditTask(
        task_id="copywriting",
        name="统一文案配置系统",
        script_name="audit_copywriting.py",
        default_args=[],
        scopes={"config", "gd"}
    ),
    AuditTask(
        task_id="magic_dimensions",
        name="魔法双维度体系",
        script_name="audit_magic_dimensions.py",
        default_args=[],
        scopes={"config", "gd"}
    ),
    AuditTask(
        task_id="event_probability",
        name="事件流关联动态概率系统",
        script_name="audit_event_probability.py",
        default_args=[],
        scopes={"config"}
    ),
    AuditTask(
        task_id="cdc",
        name="配置驱动收口与单一真源审查",
        script_name="audit_cdc.py",
        default_args=[],
        scopes={"config", "gd"}
    ),
    AuditTask(
        task_id="event_channels",
        name="EventBus 频道纪律与叙事契约",
        script_name="audit_event_channels.py",
        default_args=[],
        scopes={"config", "gd"}
    ),
    AuditTask(
        task_id="refactor_metrics",
        name="auto-refactor 静态复杂度与重构建议",
        script_name="audit_refactor_metrics.py",
        default_args=[],
        scopes={"gd", "config"}
    ),
    AuditTask(
        task_id="arch",
        name="架构护栏与领域清单一致性",
        script_name="audit_arch_static.py",
        default_args=[],
        scopes={"gd", "config"}
    ),
    AuditTask(
        task_id="docs",
        name="文档四域规范与基线棘轮",
        script_name="audit_docs.py",
        default_args=["--baseline", "benchmarks/reports/docs_baseline.json"],
        scopes={"docs"}
    ),
    # ---- bench 组（性能门禁报告）----
    AuditTask(
        task_id="report_aggregate",
        name="性能门禁聚合报告（--gate/--promote）",
        script_name="report_aggregate.py",
        default_args=[],
        scopes={"bench"},
        group="bench"
    ),
    AuditTask(
        task_id="report_sweep",
        name="bench 报告合并扫描",
        script_name="report_sweep.py",
        default_args=[],
        scopes={"bench"},
        group="bench"
    ),
    # ---- archive 组（归档系统，exclusive 串行防写冲突）----
    AuditTask(
        task_id="archive_volume",
        name="短期施工区周期归档（--detect/--cycle/--all）",
        script_name="archive_volume.py",
        default_args=[],
        scopes={"archive"},
        group="archive",
        exclusive=True
    ),
    AuditTask(
        task_id="pair_parity",
        name="sh/ps1 同构双实现参数面一致性校验",
        script_name="audit_pair_parity.py",
        default_args=[],
        scopes={"scripts"}
    ),
    AuditTask(
        task_id="script_comment",
        name="脚本库头注释规范审计",
        script_name="audit_script_comment.py",
        default_args=[],
        scopes={"scripts"}
    ),
    AuditTask(
        task_id="sdk_sync",
        name="MOD SDK 契约自动萃取与零漂移审查",
        script_name="audit_sdk_sync.py",
        default_args=[],
        scopes={"config", "docs"}
    ),
]


def _classify_scripts_path(
    base: str,
    registered_by_name: dict[str, str],
    engine_hits: set[str],
) -> bool:
    """分类 scripts 目录下的脚本变更，返回是否需回退全量门禁。"""
    if base.endswith(".sh") or base.endswith(".ps1"):
        engine_hits.add("pair_parity")
        return False
    if base.endswith(".py"):
        tid = registered_by_name.get(base)
        if tid:
            engine_hits.add(tid)
            return False
        return True
    return False


def _classify_git_path_item(
    path_str: str,
    registered_by_name: dict[str, str],
    scopes: set[str],
    engine_hits: set[str],
) -> bool:
    """分析单个 git 路径并归类到 scopes/engine_hits，返回是否触发全量 scripts 回退。"""
    if "WebGames/" in path_str:
        path_str = path_str.split("WebGames/", 1)[1]

    if path_str.endswith(".gd"):
        scopes.add("gd")
        if "tests/" in path_str:
            scopes.add("test")
        return False

    if path_str.startswith("config/") or path_str.endswith(".json"):
        scopes.add("config")
        return False

    if path_str.startswith("docs/") or path_str.endswith(".md"):
        scopes.add("docs")
        return False

    if path_str.startswith("scripts/"):
        scopes.add("scripts")
        base = path_str.rsplit("/", 1)[-1]
        return _classify_scripts_path(base, registered_by_name, engine_hits)

    scopes.add("all")
    return False


def detect_git_changed_scope_tasks(root: Path) -> set[str]:
    """通过 git 状态分析返回 (scopes, engine_hits, scripts_need_full) 三要素。

    脚本库变更定向映射：scripts/ 变更——sh/ps1 同构对 → pair_parity；
    引擎 py → 对应注册 task_id；audit_runner/audit_common 或未注册引擎 → scripts_need_full
    （调用方回退全量 audit 保守兜底）；gd/config/docs 切片语义保持原样。
    """
    scopes: Set[str] = set()
    engine_hits: Set[str] = set()
    scripts_need_full = False
    registered_by_name = {t.script_name: t.task_id for t in AUDIT_TASKS}
    try:
        r = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace"
        )
        if r.returncode != 0:
            return {"all"}, set(), False

        lines = r.stdout.strip().splitlines()
        if not lines:
            return {"gd", "config", "docs"}, set(), False

        for line in lines:
            parts = line.strip().split(maxsplit=1)
            if len(parts) >= 2:
                path_str = parts[1].replace("\\", "/")
                if _classify_git_path_item(path_str, registered_by_name, scopes, engine_hits):
                    scripts_need_full = True
    except Exception:
        return {"all"}, set(), True

    return (scopes if scopes else {SCOPE_ALL}), engine_hits, scripts_need_full


def _find_orphan_engine_files(engine_files: set, registered: set) -> List[str]:
    """检查未注册到 AUDIT_TASKS 的孤儿引擎文件。"""
    return [
        f"孤儿引擎文件未注册进 AUDIT_TASKS: scripts/py/{f}（新增门禁须先登记 task_id）"
        for f in sorted(engine_files - registered)
    ]


def _find_missing_registered_files(registered: set) -> List[str]:
    """检查 AUDIT_TASKS 中注册但在磁盘上缺失的文件。"""
    return [
        f"注册任务脚本文件缺失: {name}"
        for name in sorted(registered)
        if not (PY_SCRIPTS_DIR / name).exists()
    ]


def check_registry_completeness() -> List[str]:
    """基准规范（脚本库治理，2026-09-04）：py 引擎目录 ↔ AUDIT_TASKS 注册表双向完备性自检。

    孤儿引擎：scripts/py/ 下 audit-*/report_*/archive_*.py 未被任何任务注册 → 阻断；
    悬空注册：AUDIT_TASKS.script_name 指向的文件缺失 → 阻断。
    豁免：audit_runner.py（driver）与 audit_common.py（共享底座）非独立任务引擎。
    """
    registered = {t.script_name for t in AUDIT_TASKS}
    try:
        files = {f for f in os.listdir(PY_SCRIPTS_DIR) if f.endswith(".py")}
    except OSError as ex:
        return [f"无法扫描 scripts/py 目录: {ex}"]

    engine_files = {
        f for f in files
        if f not in REGISTRY_EXEMPT and f.startswith(ENGINE_PREFIXES)
    }
    issues = _find_orphan_engine_files(engine_files, registered)
    issues.extend(_find_missing_registered_files(registered))
    return issues


# 单任务超时（秒）：任一审查引擎挂起/死锁时 fail-fast，避免拖死整个门禁
TASK_TIMEOUT_SEC = 300


def run_single_task(task: AuditTask, extra_args: List[str], py_exec: str) -> TaskResult:
    """执行单个审查任务子进程并统计指标（带超时 fail-fast：TASK_TIMEOUT_SEC 内未完成按 TIMEOUT 处理）"""
    script_path = PY_SCRIPTS_DIR / task.script_name
    if not script_path.exists():
        return TaskResult(
            task=task,
            returncode=1,
            stdout="",
            stderr=f"脚本文件不存在: {script_path}",
            elapsed_sec=0.0
        )

    cmd = [py_exec, "-X", "utf8", str(script_path)] + task.default_args + extra_args
    t0 = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd,
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=TASK_TIMEOUT_SEC
        )
        elapsed = time.perf_counter() - t0
        return TaskResult(
            task=task,
            returncode=proc.returncode,
            stdout=proc.stdout,
            stderr=proc.stderr,
            elapsed_sec=elapsed
        )
    except subprocess.TimeoutExpired as tex:
        elapsed = time.perf_counter() - t0
        return TaskResult(
            task=task,
            returncode=1,
            stdout="",
            stderr=f"执行超时（>{TASK_TIMEOUT_SEC}s，fail-fast 截断）: {task.task_id}\n{tex}",
            elapsed_sec=elapsed
        )
    except Exception as ex:
        elapsed = time.perf_counter() - t0
        return TaskResult(
            task=task,
            returncode=1,
            stdout="",
            stderr=f"执行异常: {ex}",
            elapsed_sec=elapsed
        )


# 抽取任务 stderr 的 warning 级内容透出（失败任务保持全文）
_WARN_PATTERN_RE = re.compile(r"WARN|Warning|warning|警告|提示级|⚠")


def _warning_slice(stderr: str, max_chars: int = 2000) -> str:
    """从通过任务 stderr 中抽取 warning 级行，供 JSON 报告透出（空/无命中返回空串）。"""
    if not stderr:
        return ""
    keep = [ln for ln in stderr.splitlines() if _WARN_PATTERN_RE.search(ln)]
    if not keep:
        return ""
    text = "\n".join(keep)
    return text[-max_chars:] if len(text) > max_chars else text


# 从审查输出行提取文件:行号 形态（如 docs/foo.md:123 / res://backend/x.gd:45），供 SARIF region 定位
_LOCATION_LINE_RE = re.compile(r"([A-Za-z0-9_./\\-]+\.(?:gd|md|json|py)):(\d+)")


def _extract_region(message: str) -> dict:
    """从消息中解析首处 文件:行号，返回 SARIF region（未命中返回空 dict）。"""
    m = _LOCATION_LINE_RE.search(message)
    if not m:
        return {}
    return {
        "startLine": int(m.group(2)),
        "artifactLocation": {"uri": m.group(1).replace("\\", "/")}
    }


def _stable_fingerprint(content: str) -> str:
    """SARIF 稳定指纹：SHA-256 截断取 12 位十六进制。
    不得使用内建 hash()——字符串 hash 受 PYTHONHASHSEED 随机化，跨进程不稳定，
    会破坏 GitHub code scanning 的跨 run 增量去重。"""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:12]


def _build_sarif_finding(task: AuditTask, level: str, text: str) -> dict:
    """构建单个 SARIF finding 字典项。"""
    region = _extract_region(text)
    loc = {
        "physicalLocation": {
            "artifactLocation": {
                "uri": region.get("artifactLocation", {}).get("uri", f"scripts/py/{task.script_name}")
            }
        }
    }
    if "startLine" in region:
        loc["physicalLocation"]["region"] = {"startLine": region["startLine"]}
    return {
        "ruleId": task.task_id,
        "level": level,
        "message": {"text": text[:4000]},
        "locations": [loc],
        "partialFingerprints": {
            "primaryLocationLineHash": _stable_fingerprint(f"{task.task_id}:{text[:200]}")
        }
    }


def _generate_sarif(results: List[TaskResult]) -> dict:
    """将任务结果聚合为 OASIS SARIF 2.1.0 工业标准静态分析结果格式（含 region/指纹/调用元数据）。"""
    sarif_rules = []
    seen_rules = set()
    for r in results:
        tid = r.task.task_id
        if tid not in seen_rules:
            seen_rules.add(tid)
            sarif_rules.append({
                "id": tid,
                "name": r.task.name,
                "shortDescription": {"text": r.task.name},
                "fullDescription": {"text": r.task.name},
                "defaultConfiguration": {"level": "error"},
                "helpUri": f"scripts/py/{r.task.script_name}"
            })

    sarif_results = []
    for r in results:
        if r.returncode != 0:
            err = r.stderr.strip()
            out = r.stdout.strip()
            msg = err if err else (out if out else f"Task {r.task.name} failed with returncode {r.returncode}")
            sarif_results.append(_build_sarif_finding(r.task, "error", msg))
        else:
            w = _warning_slice(r.stderr)
            if w:
                sarif_results.append(_build_sarif_finding(r.task, "warning", w))

    return {
        "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
        "version": "2.1.0",
        "runs": [{
            "tool": {
                "driver": {
                    "name": "WebGames-AuditRunner",
                    "informationUri": "https://github.com/guilingzhouyi-creator/vscode-extensions",
                    "version": AUDIT_RUNNER_VERSION,
                    "rules": sarif_rules
                }
            },
            "invocations": [{
                "executionSuccessful": all(r.returncode == 0 for r in results),
                "toolExecutionNotifications": [],
                "endTimeUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            }],
            "results": sarif_results
        }]
    }


def _parse_and_validate_cli_args() -> tuple[argparse.Namespace, bool]:
    """解析并校验命令行参数，支持输出格式简写与静默模式判定。"""
    parser = argparse.ArgumentParser(description="WebGames 全脚本库统一调度入口（audit/bench/archive 异步并行）")
    parser.add_argument("--version", action="version", version=f"%(prog)s {AUDIT_RUNNER_VERSION}")
    parser.add_argument("--diff", action="store_true", help="增量切片模式：仅扫描当前 Git 变更相关域")
    parser.add_argument("--slice", type=str, default="", help="领域定向切片：仅扫描指定子域或路径")
    parser.add_argument("--task", type=str, default="", help="指定任务组合（逗号分隔 task_id，跨组任意组合，如 config,name_keys,report_aggregate）")
    parser.add_argument("--group", type=str, default="", help="指定组全量（audit/bench/archive，逗号可组合）")
    parser.add_argument("-j", "--jobs", type=int, default=0, help="并发 Worker 进程数 (0=自动适配 CPU 核心数)")
    parser.add_argument("--serial", action="store_true", help="强制单进程串行模式")
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式聚合报告")
    parser.add_argument("--format", type=str, default="text", choices=["text", "json", "sarif"], help="报告输出格式 (text/json/sarif)")
    parser.add_argument("--sarif-out", type=str, default="", help="SARIF 文件输出路径")
    parser.add_argument("--baseline", type=str, default="", help="覆盖 docs 审查的基线文件路径")
    args = parser.parse_args()

    if args.json:
        args.format = "json"
    is_quiet_mode = args.format in ("json", "sarif")
    return args, is_quiet_mode


def _resolve_task_combination(task_arg: str) -> tuple[List[AuditTask], int]:
    """解析指定 task_id 组合列表。"""
    wanted = [s.strip() for s in task_arg.split(",") if s.strip()]
    by_id = {t.task_id: t for t in AUDIT_TASKS}
    unknown = [w for w in wanted if w not in by_id]
    if unknown:
        print(f"未知任务 id: {unknown}\n可选任务: {', '.join(sorted(by_id))}")
        return [], 2
    return [by_id[w] for w in wanted], 0


def _resolve_group_combination(group_arg: str) -> tuple[List[AuditTask], int]:
    """解析指定 group 分组任务列表。"""
    groups = {s.strip() for s in group_arg.split(",") if s.strip()}
    valid = {"audit", "bench", "archive"}
    bad = groups - valid
    if bad:
        print(f"未知分组: {sorted(bad)}（可选: audit/bench/archive）")
        return [], 2
    return [t for t in AUDIT_TASKS if t.group in groups], 0


def _is_task_hit_by_diff(
    t: AuditTask,
    changed_scopes: set[str],
    script_engine_hits: set[str],
    scripts_need_full: bool,
) -> bool:
    """判定单个门禁任务是否被当前 git diff 变更命中。"""
    if t.group != "audit":
        return False
    if scripts_need_full:
        return True
    if "all" in changed_scopes or "all" in t.scopes:
        return True
    if bool(t.scopes & changed_scopes):
        return True
    return t.task_id in script_engine_hits


def _resolve_diff_combination() -> List[AuditTask]:
    """基于当前 Git 变更范围解析命中的任务集合。"""
    changed_scopes, script_engine_hits, scripts_need_full = detect_git_changed_scope_tasks(ROOT_DIR)
    return [
        t for t in AUDIT_TASKS
        if _is_task_hit_by_diff(t, changed_scopes, script_engine_hits, scripts_need_full)
    ]


def _resolve_slice_combination(slice_arg: str) -> tuple[List[AuditTask], int]:
    """基于子串大小写不敏感匹配切片任务。"""
    needle = slice_arg.strip().lower()
    if not needle:
        print("--slice 不可为空字符串")
        return [], 2
    tasks_to_run: List[AuditTask] = []
    for t in AUDIT_TASKS:
        if t.group != "audit":
            continue
        hay = " ".join([t.task_id.lower(), t.script_name.lower(), *[s.lower() for s in t.scopes]])
        if needle in hay:
            tasks_to_run.append(t)
    if not tasks_to_run:
        by_id = sorted(t.task_id for t in AUDIT_TASKS)
        print(f"--slice 无命中: {slice_arg!r}\n可选任务: {', '.join(by_id)}")
        return [], 2
    return tasks_to_run, 0


def _dispatch_target_task_resolution(args: argparse.Namespace) -> tuple[List[AuditTask], int]:
    """分发解析特定参数维度的任务集合。"""
    if args.task:
        return _resolve_task_combination(args.task)
    if args.group:
        return _resolve_group_combination(args.group)
    if args.diff:
        return _resolve_diff_combination(), 0
    if args.slice:
        return _resolve_slice_combination(args.slice)
    return [t for t in AUDIT_TASKS if t.group == "audit"], 0


def _resolve_target_tasks(args: argparse.Namespace) -> tuple[List[AuditTask], int]:
    """多策略解析目标任务列表并支持 baseline 动态覆盖。"""
    if args.slice and (args.task or args.group or args.diff):
        print("--slice 不可与 --task/--group/--diff 混用（切片只做减法，请单用）")
        return [], 2

    tasks, code = _dispatch_target_task_resolution(args)
    if code != 0:
        return [], code

    if args.baseline:
        tasks = [
            replace(t, default_args=["--baseline", args.baseline])
            if t.task_id == "docs" else t
            for t in tasks
        ]
    return tasks, 0


def _compute_worker_count(args: argparse.Namespace, task_count: int) -> int:
    """计算线程池最大并发工作进程数。"""
    if args.serial:
        return 1
    cpu_count = os.cpu_count() or 4
    return args.jobs if args.jobs > 0 else min(cpu_count, task_count)


def _handle_registry_warnings(registry_issues: List[str], is_json: bool) -> None:
    """非静默 JSON 模式下输出注册表自检告警。"""
    if not is_json and registry_issues:
        print(f"{C_RED}【registry】❌ 脚本库注册表完备性自检未通过:{C_RESET}")
        for issue in registry_issues:
            print(f"  - {issue}")


def _print_runner_header(args: argparse.Namespace, workers: int, task_count: int) -> None:
    """输出调度器启动时的模式与参数看板。"""
    mode_desc = f"定向切片 (--slice {args.slice})" if args.slice else ("Git 差异定向增量" if args.diff else f"全量并行 ({args.group} 组)")
    print("=" * 75)
    print(f"🚀 {C_BOLD}启动卡拉尔世界引擎全域质量门禁调度流水线 (v{AUDIT_RUNNER_VERSION}){C_RESET}")
    print("=" * 75)
    print(f"  • 运行模式: {C_YELLOW}{mode_desc}{C_RESET} | 并发工作池: {C_GREEN}{workers} Workers{C_RESET} | 目标任务数: {task_count}/{len(AUDIT_TASKS)}")
    print(f"  • 工作根目录: {C_GRAY}{ROOT_DIR}{C_RESET}\n")


def _log_task_result(res: TaskResult, is_quiet_mode: bool, extra_tag: str = "") -> None:
    """打印单任务执行结果徽标与耗时。"""
    if is_quiet_mode:
        return
    badge = f"{C_GREEN}✅ PASS{C_RESET}" if res.returncode == 0 else f"{C_RED}❌ FAIL({res.returncode}){C_RESET}"
    tag_str = f" [{extra_tag}]" if extra_tag else ""
    print(f"  [{badge}] {C_BOLD}{res.task.name:<30s}{C_RESET} ({res.task.script_name}) — {res.elapsed_sec:5.2f}s{tag_str}")


def _run_exclusive_tasks(tasks: List[AuditTask], py_exec: str, is_quiet_mode: bool) -> List[TaskResult]:
    """串行执行 exclusive 独占任务。"""
    results = []
    for t in tasks:
        res = run_single_task(t, [], py_exec)
        results.append(res)
        _log_task_result(res, is_quiet_mode, "串行 exclusive")
    return results


def _run_parallel_task_pool(tasks: List[AuditTask], workers: int, py_exec: str, is_quiet_mode: bool) -> List[TaskResult]:
    """通过线程池并发执行独立只读任务。"""
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_task = {
            executor.submit(run_single_task, t, [], py_exec): t
            for t in tasks
        }
        for future in concurrent.futures.as_completed(future_to_task):
            res = future.result()
            results.append(res)
            _log_task_result(res, is_quiet_mode)
    return results


def _run_serial_task_list(tasks: List[AuditTask], py_exec: str, is_quiet_mode: bool) -> List[TaskResult]:
    """单线程串行执行任务列表。"""
    results = []
    for t in tasks:
        res = run_single_task(t, [], py_exec)
        results.append(res)
        _log_task_result(res, is_quiet_mode)
    return results


def _execute_audit_pipeline(
    tasks_to_run: List[AuditTask],
    workers: int,
    py_exec: str,
    is_quiet_mode: bool,
) -> tuple[List[TaskResult], float, float, float]:
    """执行完整的门禁流水线调度，返回 (结果列表, 实际墙钟耗时, 串行累计耗时, 加速比)。"""
    wall_start = time.perf_counter()
    exclusive_tasks = [t for t in tasks_to_run if t.exclusive]
    parallel_tasks = [t for t in tasks_to_run if not t.exclusive]

    results = _run_exclusive_tasks(exclusive_tasks, py_exec, is_quiet_mode)
    if workers > 1 and len(parallel_tasks) > 1:
        results.extend(_run_parallel_task_pool(parallel_tasks, workers, py_exec, is_quiet_mode))
    else:
        results.extend(_run_serial_task_list(parallel_tasks, py_exec, is_quiet_mode))

    wall_elapsed = time.perf_counter() - wall_start
    sum_elapsed = sum(r.elapsed_sec for r in results)
    speedup = (sum_elapsed / wall_elapsed) if wall_elapsed > 0 else 1.0

    order_index = {t.task_id: i for i, t in enumerate(AUDIT_TASKS)}
    results.sort(key=lambda r: order_index.get(r.task.task_id, len(order_index)))
    return results, wall_elapsed, sum_elapsed, speedup


def _export_sarif_report(args: argparse.Namespace, results: List[TaskResult], all_passed: bool, is_quiet_mode: bool) -> None:
    """生成并导出 SARIF 报告。"""
    sarif_doc = _generate_sarif(results)
    if args.sarif_out:
        out_p = Path(args.sarif_out)
        out_p.parent.mkdir(parents=True, exist_ok=True)
        out_p.write_text(json.dumps(sarif_doc, ensure_ascii=False, indent=2), encoding="utf-8")
        if not is_quiet_mode:
            print(f"【SARIF】已成功导出行业标准分析报告至: {out_p}")
    if args.format == "sarif":
        print(json.dumps(sarif_doc, ensure_ascii=False, indent=2))
        sys.exit(0 if all_passed else 1)


def _export_json_report(
    results: List[TaskResult],
    all_passed: bool,
    wall_elapsed: float,
    sum_elapsed: float,
    speedup: float,
    workers: int,
    registry_issues: List[str],
) -> None:
    """输出 JSON 格式聚合报告。"""
    report = {
        "all_passed": all_passed,
        "wall_elapsed_sec": round(wall_elapsed, 3),
        "sum_cpu_sec": round(sum_elapsed, 3),
        "speedup_ratio": round(speedup, 2),
        "workers": workers,
        "registry_issues": registry_issues,
        "tasks": [
            {
                "task_id": r.task.task_id,
                "group": r.task.group,
                "name": r.task.name,
                "script": r.task.script_name,
                "passed": r.returncode == 0,
                "returncode": r.returncode,
                "elapsed_sec": round(r.elapsed_sec, 3),
                "stderr": r.stderr if r.returncode != 0 else _warning_slice(r.stderr),
            }
            for r in results
        ],
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    sys.exit(0 if all_passed else 1)


def _render_console_summary(
    results: List[TaskResult],
    failed_tasks: List[TaskResult],
    all_passed: bool,
    wall_elapsed: float,
    sum_elapsed: float,
    speedup: float,
    registry_issues: List[str],
) -> int:
    """渲染控制台汇总看板并返回退出码。"""
    print("\n" + "=" * 75)
    print(f"📊 {C_BOLD}门禁调度汇总报告 (Quality Gates Aggregation){C_RESET}")
    print("=" * 75)
    pass_cnt = len(results) - len(failed_tasks)
    print(f"  • 任务通过率: {C_GREEN if all_passed else C_RED}{pass_cnt} / {len(results)} PASS{C_RESET}")
    print(f"  • 并行实际耗时 (Wall Clock): {C_GREEN}{wall_elapsed:5.2f}s{C_RESET} (串行等效累计: {sum_elapsed:5.2f}s | 加速比: {C_CYAN}{speedup:.2f}x{C_RESET})")

    if failed_tasks or registry_issues:
        if failed_tasks:
            print(f"\n{C_RED}{C_BOLD}❌ 未通过任务诊断详情:{C_RESET}")
            for ft in failed_tasks:
                print(f"\n--- [{ft.task.name}] ({ft.task.script_name}) ---")
                if ft.stdout.strip():
                    print(ft.stdout.strip())
                if ft.stderr.strip():
                    print(f"{C_RED}{ft.stderr.strip()}{C_RESET}")
        print(f"\n{C_RED}【门禁结论】审查未通过，已阻断！{C_RESET}")
        return 1

    print(f"\n{C_GREEN}{C_BOLD}🎉 恭喜！全域门禁审查 100% 全部通过 (0 Error / 0 Warn)！{C_RESET}")
    return 0


def _finalize_audit_outputs(
    args: argparse.Namespace,
    results: List[TaskResult],
    all_passed: bool,
    wall_elapsed: float,
    sum_elapsed: float,
    speedup: float,
    workers: int,
    registry_issues: List[str],
    is_quiet_mode: bool,
) -> int:
    """统一输出 SARIF、JSON 报告或终端汇总面板。"""
    failed_tasks = [r for r in results if r.returncode != 0]
    if args.sarif_out or args.format == "sarif":
        _export_sarif_report(args, results, all_passed, is_quiet_mode)
    if args.format == "json":
        _export_json_report(results, all_passed, wall_elapsed, sum_elapsed, speedup, workers, registry_issues)
    return _render_console_summary(results, failed_tasks, all_passed, wall_elapsed, sum_elapsed, speedup, registry_issues)


def main() -> int:
    args, is_quiet_mode = _parse_and_validate_cli_args()
    tasks_to_run, err_code = _resolve_target_tasks(args)
    if err_code != 0:
        return err_code

    registry_issues = check_registry_completeness()
    _handle_registry_warnings(registry_issues, args.json)

    workers = _compute_worker_count(args, len(tasks_to_run))
    if not is_quiet_mode:
        _print_runner_header(args, workers, len(tasks_to_run))

    py_exec = sys.executable or "python"
    results, wall_elapsed, sum_elapsed, speedup = _execute_audit_pipeline(tasks_to_run, workers, py_exec, is_quiet_mode)

    all_passed = all(r.returncode == 0 for r in results) and not registry_issues
    return _finalize_audit_outputs(
        args, results, all_passed, wall_elapsed, sum_elapsed, speedup, workers, registry_issues, is_quiet_mode
    )


if __name__ == "__main__":
    sys.exit(main())
