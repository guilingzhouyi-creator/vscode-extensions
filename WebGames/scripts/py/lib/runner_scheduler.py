#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 门禁任务调度)
# 文件路径: WebGames/scripts/py/lib/runner_scheduler.py
# 架构定位: 并行/串行流水线执行器与 Git 增量作用域探测器 (Audit Pipeline Scheduler)
# 依赖与触发: 触发方: audit_runner.py | 上游: 各 audit_*.py 脚本 | 下游: TaskResult 列表 | 运行时: Python 3.10+
# 职责说明: 提供子进程带超时 fail-fast 执行、线程池并发控制、Git diff 作用域智能探测与注册表完备性自检
# 退出语义与设计依据: 纯调度模块，无退出码 | 设计依据: AGENTS.md 双层门禁与 fail-fast 原则
# ------------------------------------------------------------------------------
# 用法示例:
#   from lib.runner_scheduler import execute_audit_pipeline, PipelineSchedulerContext
# ==============================================================================
"""门禁调度执行引擎、超时熔断与 Git 作用域分析模块。"""

from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
import concurrent.futures
import os
import subprocess
import sys
import time

from audit_common import resolve_repo_root
ROOT_DIR = resolve_repo_root()
TASK_TIMEOUT_SEC = 300

C_RESET = "\033[0m"
C_BOLD = "\033[1m"
C_RED = "\033[31m"
C_GREEN = "\033[32m"


@dataclass(slots=True)
class AuditTask:
    """门禁审计任务定义载荷。"""

    task_id: str
    name: str
    script_name: str
    default_args: list[str] = field(default_factory=list)
    scopes: set[str] = field(default_factory=set)
    group: str = "audit"
    exclusive: bool = False


@dataclass(slots=True)
class TaskResult:
    """单个门禁任务执行结果载荷。"""

    task: AuditTask
    returncode: int
    stdout: str
    stderr: str
    elapsed_sec: float
    skipped: bool = False
    skip_reason: str = ""


@dataclass(slots=True)
class PipelineSchedulerContext:
    """流水线调度环境与任务配置上下文（消除 Data Clump）。"""

    tasks_to_run: list[AuditTask]
    all_registered_tasks: list[AuditTask]
    workers: int
    py_exec: str
    py_scripts_dir: Path
    is_quiet_mode: bool


def run_single_task(task: AuditTask, extra_args: list[str], py_exec: str, py_scripts_dir: Path) -> TaskResult:
    """执行单个审查任务子进程并统计指标（带超时 fail-fast）。"""
    script_path = py_scripts_dir / task.script_name
    if not script_path.exists():
        return TaskResult(
            task=task,
            returncode=1,
            stdout="",
            stderr=f"脚本文件不存在: {script_path}",
            elapsed_sec=0.0,
        )

    cmd = (
        [py_exec, "-X", "utf8", str(script_path)]
        + task.default_args
        + extra_args
    )
    t0 = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd,
            cwd=ROOT_DIR,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=TASK_TIMEOUT_SEC,
        )
        elapsed = time.perf_counter() - t0
        return TaskResult(
            task=task,
            returncode=proc.returncode,
            stdout=proc.stdout,
            stderr=proc.stderr,
            elapsed_sec=elapsed,
        )
    except subprocess.TimeoutExpired as exc:
        elapsed = time.perf_counter() - t0
        return TaskResult(
            task=task,
            returncode=1,
            stdout="",
            stderr=f"执行超时（>{TASK_TIMEOUT_SEC}s，fail-fast 截断）: {task.task_id}\n{exc}",
            elapsed_sec=elapsed,
        )
    except Exception as exc:
        elapsed = time.perf_counter() - t0
        return TaskResult(
            task=task,
            returncode=1,
            stdout="",
            stderr=f"执行异常: {exc}",
            elapsed_sec=elapsed,
        )


def _log_task_result(
    res: TaskResult, is_quiet_mode: bool, extra_tag: str = ""
) -> None:
    """打印单任务执行结果徽标与耗时。"""
    if is_quiet_mode:
        return
    badge = (
        f"{C_GREEN}✔ PASS{C_RESET}"
        if res.returncode == 0
        else f"{C_RED}✖ BLOCK({res.returncode}){C_RESET}"
    )
    tag_str = f" [{extra_tag}]" if extra_tag else ""
    print(
        f"  [{badge}] {C_BOLD}{res.task.name:<30s}{C_RESET} ({res.task.script_name}) — {res.elapsed_sec:5.2f}s{tag_str}"
    )


def _execute_serial_tasks(
    tasks: list[AuditTask], ctx: PipelineSchedulerContext, tag: str = ""
) -> list[TaskResult]:
    """串行执行给定的任务列表并记录输出。"""
    results: list[TaskResult] = []
    for t in tasks:
        res = run_single_task(t, [], ctx.py_exec, ctx.py_scripts_dir)
        results.append(res)
        _log_task_result(res, ctx.is_quiet_mode, tag)
    return results


def _execute_parallel_tasks(
    tasks: list[AuditTask], ctx: PipelineSchedulerContext
) -> list[TaskResult]:
    """并发线程池调度非互斥任务。"""
    if ctx.workers <= 1 or len(tasks) <= 1:
        return _execute_serial_tasks(tasks, ctx)

    results: list[TaskResult] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=ctx.workers) as executor:
        future_to_task = {
            executor.submit(
                run_single_task, t, [], ctx.py_exec, ctx.py_scripts_dir
            ): t
            for t in tasks
        }
        for future in concurrent.futures.as_completed(future_to_task):
            res = future.result()
            results.append(res)
            _log_task_result(res, ctx.is_quiet_mode)
    return results


def execute_audit_pipeline(ctx: PipelineSchedulerContext) -> tuple[list[TaskResult], float, float, float]:
    """执行完整的门禁流水线调度，返回 (结果列表, 实际墙钟耗时, 串行累计耗时, 加速比)。"""
    wall_start = time.perf_counter()
    exclusive_tasks = [t for t in ctx.tasks_to_run if t.exclusive]
    parallel_tasks = [t for t in ctx.tasks_to_run if not t.exclusive]

    results: list[TaskResult] = []
    results.extend(_execute_serial_tasks(exclusive_tasks, ctx, "串行 exclusive"))
    results.extend(_execute_parallel_tasks(parallel_tasks, ctx))

    wall_elapsed = time.perf_counter() - wall_start
    sum_elapsed = sum(r.elapsed_sec for r in results)
    speedup = (sum_elapsed / wall_elapsed) if wall_elapsed > 0 else 1.0

    order_index = {t.task_id: i for i, t in enumerate(ctx.all_registered_tasks)}
    results.sort(key=lambda r: order_index.get(r.task.task_id, len(order_index)))
    return results, wall_elapsed, sum_elapsed, speedup


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
    """分析单个 git 路径并归类到 scopes/engine_hits。"""
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


def _process_git_status_lines(
    lines: list[str],
    registered_by_name: dict[str, str],
    scopes: set[str],
    engine_hits: set[str],
) -> bool:
    """遍历 git status 变更行并统计触发的作用域与引擎任务。"""
    scripts_need_full = False
    for line in lines:
        parts = line.strip().split(maxsplit=1)
        if len(parts) < 2:
            continue
        path_str = parts[1].replace("\\", "/")
        if _classify_git_path_item(path_str, registered_by_name, scopes, engine_hits):
            scripts_need_full = True
    return scripts_need_full


def detect_git_changed_scope_tasks(root: Path, all_registered_tasks: list[AuditTask]) -> tuple[set[str], set[str], bool]:
    """通过 git 状态分析返回 (scopes, engine_hits, scripts_need_full) 三要素。"""
    scopes: set[str] = set()
    engine_hits: set[str] = set()
    registered_by_name = {t.script_name: t.task_id for t in all_registered_tasks}
    try:
        r = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if r.returncode != 0:
            return {"all"}, set(), False

        lines = r.stdout.strip().splitlines()
        if not lines:
            return {"gd", "config", "docs"}, set(), False

        scripts_need_full = _process_git_status_lines(
            lines, registered_by_name, scopes, engine_hits
        )
    except Exception:
        return {"all"}, set(), True

    return (scopes if scopes else {"all"}), engine_hits, scripts_need_full


def check_registry_completeness(py_scripts_dir: Path, all_registered_tasks: list[AuditTask], exempt_files: set[str], engine_prefixes: tuple[str, ...]) -> list[str]:
    """py 引擎目录 ↔ AUDIT_TASKS 注册表双向完备性自检。"""
    registered = {t.script_name for t in all_registered_tasks}
    try:
        files = {f for f in os.listdir(py_scripts_dir) if f.endswith(".py")}
    except OSError as exc:
        return [f"无法扫描 scripts/py 目录: {exc}"]

    engine_files = {
        f
        for f in files
        if f not in exempt_files and f.startswith(engine_prefixes)
    }
    issues = [
        f"孤儿引擎文件未注册进 AUDIT_TASKS: scripts/py/{f}（新增门禁须先登记 task_id）"
        for f in sorted(engine_files - registered)
    ]
    issues.extend(
        [
            f"注册任务脚本文件缺失: {name}"
            for name in sorted(registered)
            if not (py_scripts_dir / name).exists()
        ]
    )
    return issues
