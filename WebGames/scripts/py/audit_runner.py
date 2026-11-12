#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 门禁调度中枢)
# 文件路径: WebGames/scripts/py/audit_runner.py
# 架构定位: 并行任务调度总控门面 (Parallel Audit Dispatcher Facade)
# 依赖与触发: 触发方: audit-all / CI | 上游: 全域子审计脚本 | 下游: 控制台汇总报告与 JSON | 运行时: Python 3.10+
# 职责说明: 统一编排并异步并行调度全域静态门禁，支持差异范围过滤、工作线程池与结构化聚合输出
# 退出语义与设计依据: 退出码: 0=全部门禁通过, 1=存在阻断违规, 2=环境异常 | 设计依据: AGENTS.md 构建门禁通用契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_runner.py
#   python scripts/py/audit_runner.py --diff
#   python scripts/py/audit_runner.py -j 4
# ==============================================================================
"""WebGames 全脚本库统一调度入口（audit/bench/archive 异步并行调度门面）。"""

from __future__ import annotations
from dataclasses import replace
from pathlib import Path
import argparse
import os
import sys

from audit_common import ensure_utf8_stdout, resolve_repo_root
from lib.runner_reporter import (
    C_BOLD,
    C_GRAY,
    C_GREEN,
    C_RED,
    C_RESET,
    C_YELLOW,
    PipelineExecutionSummary,
    finalize_audit_outputs,
)
from lib.runner_scheduler import (
    AuditTask,
    PipelineSchedulerContext,
    TaskResult,
    check_registry_completeness,
    detect_git_changed_scope_tasks,
    execute_audit_pipeline,
    run_single_task,
)
ensure_utf8_stdout()

ROOT_DIR = resolve_repo_root()
PY_SCRIPTS_DIR = Path(__file__).resolve().parent
ENGINE_PREFIXES = ("audit_", "report_", "archive_")
REGISTRY_EXEMPT = {
    "audit_runner.py",
    "audit_common.py",
    "audit_arch.py",
}

GROUP_AUDIT = "audit"
GROUP_BENCH = "bench"
GROUP_ARCHIVE = "archive"

AUDIT_RUNNER_VERSION = "1.3.0"

AUDIT_TASKS: list[AuditTask] = [
    AuditTask(
        task_id="config",
        name="配置表结构与基础约束",
        script_name="audit_config.py",
        default_args=["--strict"],
        scopes={"config"},
    ),
    AuditTask(
        task_id="gd",
        name="GDScript 质量治理统一审查（Style+Advanced+Simplification）",
        script_name="audit_gd.py",
        default_args=[],
        scopes={"gd"},
    ),
    AuditTask(
        task_id="hardcode",
        name="零硬编码与调试残留扫描",
        script_name="audit_hardcode.py",
        default_args=[],
        scopes={"gd"},
    ),
    AuditTask(
        task_id="perf",
        name="性能热点与循环开销扫描",
        script_name="audit_perf_hotspots.py",
        default_args=[],
        scopes={"gd"},
    ),
    AuditTask(
        task_id="coverage",
        name="测试套件覆盖率基线",
        script_name="audit_test_coverage.py",
        default_args=[],
        scopes={"gd", "test"},
    ),
    AuditTask(
        task_id="config_unused",
        name="配置表死配置与未引用扫描",
        script_name="audit_config_unused.py",
        default_args=[],
        scopes={"config", "gd"},
    ),
    AuditTask(
        task_id="item_keys",
        name="物品标准三元组与命名空间",
        script_name="audit_item_keys.py",
        default_args=[],
        scopes={"config", "gd"},
    ),
    AuditTask(
        task_id="secrets",
        name="密钥与敏感凭证泄露扫描",
        script_name="audit_secrets.py",
        default_args=["--strict"],
        scopes={"all"},
    ),
    AuditTask(
        task_id="bounds",
        name="数值上下界与物理量守恒溢出",
        script_name="audit_bounds.py",
        default_args=[],
        scopes={"gd", "config"},
    ),
    AuditTask(
        task_id="name_keys",
        name="全局名称键统一注册表",
        script_name="audit_name_keys.py",
        default_args=[],
        scopes={"config", "gd"},
    ),
    AuditTask(
        task_id="copywriting",
        name="统一文案配置系统",
        script_name="audit_copywriting.py",
        default_args=[],
        scopes={"config", "gd"},
    ),
    AuditTask(
        task_id="magic_dimensions",
        name="魔法双维度体系",
        script_name="audit_magic_dimensions.py",
        default_args=[],
        scopes={"config", "gd"},
    ),
    AuditTask(
        task_id="event_probability",
        name="事件流关联动态概率系统",
        script_name="audit_event_probability.py",
        default_args=[],
        scopes={"config"},
    ),
    AuditTask(
        task_id="cdc",
        name="配置驱动收口与单一真源审查",
        script_name="audit_cdc.py",
        default_args=[],
        scopes={"config", "gd"},
    ),
    AuditTask(
        task_id="event_channels",
        name="EventBus 频道纪律与叙事契约",
        script_name="audit_event_channels.py",
        default_args=[],
        scopes={"config", "gd"},
    ),
    AuditTask(
        task_id="refactor_metrics",
        name="auto-refactor 静态复杂度与重构建议",
        script_name="audit_refactor_metrics.py",
        default_args=["--strict"],
        scopes={"gd", "config"},
    ),
    AuditTask(
        task_id="arch",
        name="架构护栏与领域清单一致性",
        script_name="audit_arch_static.py",
        default_args=[],
        scopes={"gd", "config"},
    ),
    AuditTask(
        task_id="docs",
        name="文档四域规范与基线棘轮",
        script_name="audit_docs.py",
        default_args=["--baseline", "benchmarks/reports/docs_baseline.json"],
        scopes={"docs"},
    ),
    AuditTask(
        task_id="report_aggregate",
        name="性能门禁聚合报告（--gate/--promote）",
        script_name="report_aggregate.py",
        default_args=[],
        scopes={"bench"},
        group="bench",
    ),
    AuditTask(
        task_id="report_sweep",
        name="bench 报告合并扫描",
        script_name="report_sweep.py",
        default_args=[],
        scopes={"bench"},
        group="bench",
    ),
    AuditTask(
        task_id="archive_volume",
        name="短期施工区周期归档（--detect/--cycle/--all）",
        script_name="archive_volume.py",
        default_args=[],
        scopes={"archive"},
        group="archive",
        exclusive=True,
    ),
    AuditTask(
        task_id="pair_parity",
        name="sh/ps1 同构双实现参数面一致性校验",
        script_name="audit_pair_parity.py",
        default_args=[],
        scopes={"scripts"},
    ),
    AuditTask(
        task_id="script_comment",
        name="脚本库头注释规范审计",
        script_name="audit_script_comment.py",
        default_args=[],
        scopes={"scripts"},
    ),
    AuditTask(
        task_id="sdk_sync",
        name="MOD SDK 契约自动萃取与零漂移审查",
        script_name="audit_sdk_sync.py",
        default_args=[],
        scopes={"config", "docs"},
    ),
    AuditTask(
        task_id="code_clones",
        name="跨文件代码克隆与重复逻辑域守卫",
        script_name="audit_code_clones.py",
        default_args=[],
        scopes={"gd"},
    ),
    AuditTask(
        task_id="script_adversarial",
        name="脚本库对抗性逃逸自检守卫",
        script_name="selftest_adversarial_guards.py",
        default_args=[],
        scopes={"scripts"},
    ),
]

__all__ = [
    "AUDIT_RUNNER_VERSION",
    "AUDIT_TASKS",
    "AuditTask",
    "TaskResult",
    "main",
    "run_single_task",
]


def _parse_and_validate_cli_args() -> tuple[argparse.Namespace, bool]:
    """解析并校验命令行参数。"""
    parser = argparse.ArgumentParser(
        description="WebGames 全脚本库统一调度入口（audit/bench/archive 异步并行）"
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {AUDIT_RUNNER_VERSION}",
    )
    parser.add_argument(
        "--diff",
        action="store_true",
        help="增量切片模式：仅扫描当前 Git 变更相关域",
    )
    parser.add_argument(
        "--slice",
        type=str,
        default="",
        help="领域定向切片：仅扫描指定子域或路径",
    )
    parser.add_argument(
        "--task",
        type=str,
        default="",
        help="指定任务组合（逗号分隔 task_id，跨组任意组合）",
    )
    parser.add_argument(
        "--group",
        type=str,
        default="",
        help="指定组全量（audit/bench/archive，逗号可组合）",
    )
    parser.add_argument(
        "-j",
        "--jobs",
        type=int,
        default=0,
        help="并发 Worker 进程数 (0=自动适配 CPU 核心数)",
    )
    parser.add_argument(
        "--serial", action="store_true", help="强制单进程串行模式"
    )
    parser.add_argument(
        "--json", action="store_true", help="输出 JSON 格式聚合报告"
    )
    parser.add_argument(
        "--format",
        type=str,
        default="text",
        choices=["text", "json", "sarif"],
        help="报告输出格式 (text/json/sarif)",
    )
    parser.add_argument(
        "--sarif-out", type=str, default="", help="SARIF 文件输出路径"
    )
    parser.add_argument(
        "--baseline", type=str, default="", help="覆盖 docs 审查的基线文件路径"
    )
    args = parser.parse_args()

    if args.json:
        args.format = "json"
    is_quiet_mode = args.format in ("json", "sarif")
    return args, is_quiet_mode


def _resolve_task_combination(task_arg: str) -> tuple[list[AuditTask], int]:
    wanted = [s.strip() for s in task_arg.split(",") if s.strip()]
    by_id = {t.task_id: t for t in AUDIT_TASKS}
    unknown = [w for w in wanted if w not in by_id]
    if unknown:
        print(f"未知任务 id: {unknown}\n可选任务: {', '.join(sorted(by_id))}")
        return [], 2
    return [by_id[w] for w in wanted], 0


def _resolve_group_combination(group_arg: str) -> tuple[list[AuditTask], int]:
    groups = {s.strip() for s in group_arg.split(",") if s.strip()}
    valid = {GROUP_AUDIT, GROUP_BENCH, GROUP_ARCHIVE}
    bad = groups - valid
    if bad:
        print(f"未知分组: {sorted(bad)}（可选: {GROUP_AUDIT}/{GROUP_BENCH}/{GROUP_ARCHIVE}）")
        return [], 2
    return [t for t in AUDIT_TASKS if t.group in groups], 0


def _is_task_hit_by_diff(
    t: AuditTask,
    changed_scopes: set[str],
    script_engine_hits: set[str],
    scripts_need_full: bool,
) -> bool:
    if t.group != GROUP_AUDIT:
        return False
    if scripts_need_full:
        return True
    if "all" in changed_scopes or "all" in t.scopes:
        return True
    if bool(t.scopes & changed_scopes):
        return True
    return t.task_id in script_engine_hits


def _resolve_diff_combination() -> list[AuditTask]:
    scopes, hits, need_full = detect_git_changed_scope_tasks(
        ROOT_DIR, AUDIT_TASKS
    )
    return [
        t for t in AUDIT_TASKS if _is_task_hit_by_diff(t, scopes, hits, need_full)
    ]


def _resolve_slice_combination(slice_arg: str) -> tuple[list[AuditTask], int]:
    needle = slice_arg.strip().lower()
    if not needle:
        print("--slice 不可为空字符串")
        return [], 2
    tasks_to_run: list[AuditTask] = []
    for t in AUDIT_TASKS:
        if t.group != "audit":
            continue
        hay = " ".join(
            [
                t.task_id.lower(),
                t.script_name.lower(),
                *[s.lower() for s in t.scopes],
            ]
        )
        if needle in hay:
            tasks_to_run.append(t)
    if not tasks_to_run:
        by_id = sorted(t.task_id for t in AUDIT_TASKS)
        print(f"--slice 无命中: {slice_arg!r}\n可选任务: {', '.join(by_id)}")
        return [], 2
    return tasks_to_run, 0


def _dispatch_target_task_resolution(
    args: argparse.Namespace,
) -> tuple[list[AuditTask], int]:
    if args.task:
        return _resolve_task_combination(args.task)
    if args.group:
        return _resolve_group_combination(args.group)
    if args.diff:
        return _resolve_diff_combination(), 0
    if args.slice:
        return _resolve_slice_combination(args.slice)
    return [t for t in AUDIT_TASKS if t.group == "audit"], 0


def _resolve_target_tasks(
    args: argparse.Namespace,
) -> tuple[list[AuditTask], int]:
    if args.slice and (args.task or args.group or args.diff):
        print("--slice 不可与 --task/--group/--diff 混用（切片只做减法，请单用）")
        return [], 2

    tasks, code = _dispatch_target_task_resolution(args)
    if code != 0:
        return [], code

    if args.baseline:
        tasks = [
            (
                replace(t, default_args=["--baseline", args.baseline])
                if t.task_id == "docs"
                else t
            )
            for t in tasks
        ]
    return tasks, 0


def _compute_worker_count(args: argparse.Namespace, task_count: int) -> int:
    if args.serial:
        return 1
    cpu_count = os.cpu_count() or 4
    return args.jobs if args.jobs > 0 else min(cpu_count, task_count)


def _handle_registry_warnings(
    registry_issues: list[str], is_json: bool
) -> None:
    if not is_json and registry_issues:
        print(f"{C_RED}【registry】❌ 脚本库注册表完备性自检未通过:{C_RESET}")
        for issue in registry_issues:
            print(f"  - {issue}")


def _print_runner_header(
    args: argparse.Namespace, workers: int, task_count: int
) -> None:
    mode_desc = (
        f"定向切片 (--slice {args.slice})"
        if args.slice
        else (
            "Git 差异定向增量"
            if args.diff
            else f"全量并行 ({args.group} 组)"
        )
    )
    print("=" * 75)
    print(
        f"🚀 {C_BOLD}启动卡拉尔世界引擎全域质量门禁调度流水线 (v{AUDIT_RUNNER_VERSION}){C_RESET}"
    )
    print("=" * 75)
    print(
        f"  • 运行模式: {C_YELLOW}{mode_desc}{C_RESET} | 并发工作池: {C_GREEN}{workers} Workers{C_RESET} | 目标任务数: {task_count}/{len(AUDIT_TASKS)}"
    )
    print(f"  • 工作根目录: {C_GRAY}{ROOT_DIR}{C_RESET}\n")


def main() -> int:
    """CLI 入口。"""
    args, is_quiet_mode = _parse_and_validate_cli_args()
    tasks_to_run, err_code = _resolve_target_tasks(args)
    if err_code != 0:
        return err_code

    registry_issues = check_registry_completeness(
        PY_SCRIPTS_DIR, AUDIT_TASKS, REGISTRY_EXEMPT, ENGINE_PREFIXES
    )
    _handle_registry_warnings(registry_issues, args.json)

    workers = _compute_worker_count(args, len(tasks_to_run))
    if not is_quiet_mode:
        _print_runner_header(args, workers, len(tasks_to_run))

    py_exec = sys.executable or "python"
    sched_ctx = PipelineSchedulerContext(
        tasks_to_run=tasks_to_run,
        all_registered_tasks=AUDIT_TASKS,
        workers=workers,
        py_exec=py_exec,
        py_scripts_dir=PY_SCRIPTS_DIR,
        is_quiet_mode=is_quiet_mode,
    )
    results, wall_elapsed, sum_elapsed, speedup = execute_audit_pipeline(sched_ctx)

    all_passed = (
        all(r.returncode == 0 for r in results) and not registry_issues
    )
    summary = PipelineExecutionSummary(
        results=results,
        wall_elapsed=wall_elapsed,
        sum_elapsed=sum_elapsed,
        speedup=speedup,
        workers=workers,
        registry_issues=registry_issues,
        all_passed=all_passed,
        is_quiet_mode=is_quiet_mode,
        version=AUDIT_RUNNER_VERSION,
    )
    return finalize_audit_outputs(args, summary)


if __name__ == "__main__":
    sys.exit(main())
