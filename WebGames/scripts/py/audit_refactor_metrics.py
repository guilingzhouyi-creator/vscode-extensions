#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 复杂度度量体系)
# 文件路径: WebGames/scripts/py/audit_refactor_metrics.py
# 架构定位: 代码健康度分析器 (Code Quality Metrics Analyzer)
# 依赖与触发: 触发方: 本地 CLI / 架构评估 | 上游: backend/ | 下游: 指标大盘 | 运行时: Python 3.10+
# 职责说明: 度量代码圈复杂度、架构纯洁性、性能热点与重构建议，提供十维质量分
# 退出语义与设计依据: 退出码: 0=合规, 1=超标严重, 2=用法错误 | 设计依据: 架构复杂度有界收敛契约与十维质量评估模型
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_refactor_metrics.py
#   python scripts/py/audit_refactor_metrics.py --score
#   python scripts/py/audit_refactor_metrics.py --json
#   python scripts/py/audit_refactor_metrics.py --format markdown
# ==============================================================================
"""audit_refactor_metrics.py — auto-refactor 静态复杂度与多维代码健康度分析器。

通过 auto-refactor 引擎通用 runner（templates/consumer/run.mjs）对 WebGames 仓库实施深层静态代码审查：
1. 十维量化质量评分模型（架构一致性、语义纯洁度、代码安全性、性能效率等）；
2. 单函数圈复杂度与超大文件拆分候选定位；
3. 高频重复字面量常量提炼建议与语义归类；
4. 性能高承压热点（循环内堆分配、深层嵌套循环）检测；
5. 架构分层契约（领域层倒置、越层渗透）守卫；
6. 严格工程化退出语义与报告格式（text/json/markdown/sarif/badge）导出。
"""
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

from audit_common import ensure_utf8_stdout, resolve_repo_root
ensure_utf8_stdout()

ROOT = resolve_repo_root()
WORKSPACE_ROOT = ROOT.parent
AUTO_REFACTOR_DIR = WORKSPACE_ROOT / "auto-refactor"
AUTO_REFACTOR_CLI = AUTO_REFACTOR_DIR / "dist" / "index.js"

LINE_WIDTH = 80
DETAILED_SCORE_THRESHOLD = 95
BORDER_HORIZ = "─"
MINUS_CHAR = "-"
ARG_ENGINE_ARG = "--engine-arg"
DEFAULT_TOP_LIMIT = 3


@dataclass(slots=True)
class RefactorAuditOptions:
    """auto-refactor 分析配置选项（消除 GOV-DAT-001 形参泥团）。"""

    strict: bool = False
    json_output: bool = False
    score_only: bool = False
    report_format: str = "text"
    slice_name: str = ""
    diff_mode: bool = False
    baseline: str = ""
    update_baseline: str = ""
    analyzers: str = ""
    config_path: str = ""
    maturity_tier: str = ""
    security_level: str = ""
    classify_literals: bool = False
    cli_path: str = ""


@dataclass(slots=True)
class RefactorCommandContext:
    """底层 CLI 执行命令上下文 (GOV-DAT-001)。"""

    node_bin: str
    runner: Path
    target_root: Path
    cli_format: str
    report_path: Path
    opts: RefactorAuditOptions


def find_node_executable() -> str:
    """寻找系统 Node.js 执行路径。"""
    node = shutil.which("node")
    if node:
        return node
    if sys.platform == "win32" or os.name == "nt":
        try:
            r = subprocess.run(["where.exe", "node"], capture_output=True, text=True)
            if r.returncode == 0 and r.stdout.strip():
                first = r.stdout.strip().splitlines()[0].strip()
                if Path(first).exists():
                    return first
        except (OSError, subprocess.SubprocessError) as exc:
            # where.exe 探测失败时记录调试信息并回退至标准固定安装路径扫描
            sys.stderr.write(f"[DEBUG] where.exe node 探测跳过: {exc}\n")
    win_paths = [
        Path(os.environ.get("ProgramFiles", "C:\\Program Files")) / "nodejs" / "node.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "node" / "node.exe",
    ]
    for p in win_paths:
        if p.exists():
            return str(p)
    return ""


def _next_string_state(ch: str, esc: bool) -> tuple[bool, bool]:
    """计算字符串字面量内部的转义与闭合状态 (in_str, esc)。"""
    if esc:
        return True, False
    if ch == "\\":
        return True, True
    if ch == '"':
        return False, False
    return True, False


def _parse_json_dict_candidate(text: str) -> dict[str, Any] | None:
    """尝试将截取的 JSON 文本切片解析为字典对象。"""
    try:
        result = json.loads(text)
        return result if isinstance(result, dict) else None
    except Exception:
        return None


def _extract_json_object(raw: str) -> dict[str, Any] | None:
    """括号计数法从 stdout 中截取首个完整 JSON 对象（容忍上游 reporters.ts 转义缺陷/尾随杂讯）。"""
    start = raw.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(raw)):
        ch = raw[i]
        if in_str:
            in_str, esc = _next_string_state(ch, esc)
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return _parse_json_dict_candidate(raw[start:i + 1])
    return None


def _warn_threshold_divergence(config_path: str) -> None:
    """交叉断言：auto-refactor.config.json 顶层 thresholds 与分析器 options 双处声明须同值。"""
    try:
        with open(config_path, encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception:
        return
    top = cfg.get("thresholds") or {}
    for analyzer_key in ("constants", "complexity", "large-file"):
        opts = (cfg.get("analyzers") or {}).get(analyzer_key, {}).get("options") or {}
        for k, v in opts.items():
            if k in top and top[k] != v:
                print(f"【WARN】阈值双处声明不一致: thresholds.{k}={top[k]} ≠ "
                      f"analyzers.{analyzer_key}.options.{k}={v}，引擎以 options 覆盖生效，请同步唯一源。")


def _format_score_bar(score: int, width: int = 20) -> str:
    """生成字符式进度条。"""
    clamped = max(0, min(100, score))
    filled = int(round(clamped * width / 100))
    empty = width - filled
    return "█" * filled + "░" * empty


def _render_quality_score_card(qs: dict[str, Any], show_detailed: bool = False) -> None:
    """渲染十维质量评分看板。"""
    composite = qs.get("compositeScore", 0)
    grade = qs.get("grade", "N/A")
    confidence = qs.get("confidence", 1.0)
    indices = qs.get("indices", {})
    rationales = qs.get("rationales", [])

    print("📊 工程化十维质量评估看板 (10-Dimension Quality Score Card):")
    print(f"  🏆 综合评分: [{_format_score_bar(composite)}] {composite}/100 | 等级: {grade} | 置信度: {confidence:.2f}")

    dim_labels: dict[str, str] = {
        "architectureConsistency": "架构一致性 (Arch Consistency)",
        "semanticPurity": "语义纯洁度 (Semantic Purity)",
        "codeSecurity": "代码安全性 (Code Security)",
        "performanceEfficiency": "性能与高承压 (Perf Efficiency)",
        "standardization": "规范标准化 (Standardization)",
        "modernity": "现代性演进 (Modernity)",
        "maintainability": "认知可维护性 (Maintainability)",
        "commentQuality": "注释契约质量 (Comment Quality)",
        "duplication": "冗余与克隆抑制 (Duplication)",
        "techDebtRisk": "技术债务收敛 (Tech Debt Risk)",
    }

    if show_detailed or composite < DETAILED_SCORE_THRESHOLD:
        print("  ┌" + BORDER_HORIZ * 46 + "┬" + BORDER_HORIZ * 28 + "┐")
        print("  │ 评估维度                                     │ 指标得分                   │")
        print("  ├" + BORDER_HORIZ * 46 + "┼" + BORDER_HORIZ * 28 + "┤")
        for dim_key, dim_title in dim_labels.items():
            val = indices.get(dim_key, 100)
            bar = _format_score_bar(val, width=10)
            print(f"  │ {dim_title:<44} │ [{bar}] {val:>3}/100 │")
        print("  └" + BORDER_HORIZ * 46 + "┴" + BORDER_HORIZ * 28 + "┘")

    if rationales:
        print("  💡 扣分主因与优化导引 (Top Penalties):")
        for r in rationales[:4]:
            dim_name = r.get("dimension", "")
            delta = r.get("delta", 0)
            reason = r.get("reason", "")
            line = r.get("line", 1)
            print(f"    • [{dim_name}] {delta:+d}分 (L{line}): {reason}")
    print(MINUS_CHAR * LINE_WIDTH)


def _resolve_audit_config(opts: RefactorAuditOptions) -> str | None:
    """解析并校验 auto-refactor 配置文件路径。"""
    resolved = opts.config_path or str(ROOT / "auto-refactor.config.json")
    if resolved and Path(resolved).exists():
        _warn_threshold_divergence(resolved)
        return resolved
    if opts.config_path:
        print(f"【WARN】指定的 --config 不存在: {opts.config_path}，回退引擎默认阈值。")
    return None


def _append_engine_flags(cmd: list[str], opts: RefactorAuditOptions, resolved_config: str | None) -> None:
    """按选项追加 auto-refactor CLI 运行参数。"""
    if resolved_config:
        cmd.extend(["--config", resolved_config])
    if opts.analyzers:
        cmd.extend([ARG_ENGINE_ARG, "--analyzers", ARG_ENGINE_ARG, opts.analyzers])
    if opts.diff_mode:
        cmd.extend([ARG_ENGINE_ARG, "--diff"])
    if opts.security_level:
        cmd.extend([ARG_ENGINE_ARG, "--security-level", ARG_ENGINE_ARG, opts.security_level])
    if opts.baseline:
        cmd.extend(["--baseline", opts.baseline])
    if opts.update_baseline:
        cmd.extend(["--update-baseline", opts.update_baseline])


def _build_refactor_cmd(
    ctx: RefactorCommandContext | None = None,
    **kwargs: Any,
) -> list[str]:
    """组装底层 auto-refactor CLI 调用命令行数组 (GOV-DAT-001)。"""
    if ctx is None:
        ctx = RefactorCommandContext(
            node_bin=kwargs.get("node_bin", "node"),
            runner=kwargs.get("runner", Path(".")),
            target_root=kwargs.get("target_root", Path(".")),
            cli_format=kwargs.get("cli_format", "json"),
            report_path=kwargs.get("report_path", Path(".")),
            opts=kwargs.get("opts", RefactorAuditOptions()),
        )
    opts = ctx.opts
    resolved_config = _resolve_audit_config(opts)
    if opts.maturity_tier:
        print("【提示】--maturity-tier 由项目配置 maturityTier 承载（引擎 CLI 无此开关），本次按配置执行。")
    if opts.classify_literals:
        print("【提示】--classify-literals 由项目配置 classifyLiterals 承载（引擎 CLI 无此开关），本次按配置执行。")

    cli_target = Path(opts.cli_path).resolve() if opts.cli_path else AUTO_REFACTOR_CLI
    engine_dir = cli_target.parent.parent if opts.cli_path else AUTO_REFACTOR_DIR
    cmd = [
        ctx.node_bin,
        str(ctx.runner),
        "--engine", str(engine_dir),
        "--root", str(ctx.target_root),
        "--format", ctx.cli_format,
        "--out", str(ctx.report_path),
        "--report-only",
        "--quiet",
    ]
    _append_engine_flags(cmd, opts, resolved_config)
    return cmd


def _render_category_issues(title: str, issues: list[dict[str, Any]], tag: str, limit: int = DEFAULT_TOP_LIMIT) -> None:
    """渲染特定分析器分类下的问题列表。"""
    if not issues:
        return
    print(f"{title} (Top {limit}):")
    for iss in issues[:limit]:
        loc = iss.get("location", {})
        file_loc = f"{loc.get('file', '')}:{loc.get('start', {}).get('line', 1)}"
        rule_tag = f"{tag}/{iss.get('rule', '')}" if iss.get('rule') else tag
        print(f"  ⚠️ [{rule_tag}] {file_loc} — {iss.get('message', '')}")
        if iss.get("suggestion"):
            print(f"     💡 建议: {iss.get('suggestion')}")
    print(MINUS_CHAR * LINE_WIDTH)


def _render_summary_stats(summary: dict[str, Any]) -> None:
    """渲染扫描宏观统计与分析器分布。"""
    files_scanned = summary.get("filesScanned", 0)
    issues_total = summary.get("issuesTotal", 0)
    by_sev = summary.get("bySeverity", {})
    by_analyzer = summary.get("byAnalyzer", {})
    duration_ms = summary.get("durationMs", 0)
    suppressed = summary.get("suppressedCount", 0)

    print(f"  • 扫描源文件数: {files_scanned} 个 | 引擎耗时: {duration_ms} ms | 规则抑制: {suppressed} 处")
    print(f"  • 待优化项总计: {issues_total} 处 (ERROR {by_sev.get('error', 0)} / WARN {by_sev.get('warning', 0)} / INFO {by_sev.get('info', 0)})")
    analyzer_stats = " | ".join(f"{k}({v})" for k, v in sorted(by_analyzer.items()) if v > 0)
    if analyzer_stats:
        print(f"  • 分析器发现: {analyzer_stats}")
    print(MINUS_CHAR * LINE_WIDTH)


def _render_duplicate_literals(issues: list[dict[str, Any]]) -> None:
    """渲染高频重复字面量常量提炼建议。"""
    dups = [it for it in issues if it.get("rule") == "duplicate-literal"]
    if not dups:
        return
    print(f"💎 高频重复字面量常量提炼建议 (Top {DEFAULT_TOP_LIMIT}):")
    for iss in dups[:DEFAULT_TOP_LIMIT]:
        loc = iss.get("location", {})
        file_loc = f"{loc.get('file', '')}:{loc.get('start', {}).get('line', 1)}"
        val = iss.get("detail", {}).get("value", "")
        occ = iss.get("detail", {}).get("occurrences", 0)
        print(f"  💡 [constants] {file_loc} — 字面量「{val}」在文件中重复出现 {occ} 次")
        if iss.get("suggestion"):
            print(f"     ↳ 提炼建议: {iss.get('suggestion')}")
    print(MINUS_CHAR * LINE_WIDTH)


def _partition_issues(issues: list[dict[str, Any]]) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    """单趟聚合分析器与重复字面量发现，消除列表推导复杂度 (ADV-PRF-002)。"""
    by_an: dict[str, list[dict[str, Any]]] = {}
    dups: list[dict[str, Any]] = []
    for it in issues:
        if it.get("clusteredInto") or it.get("suppression"):
            continue
        an = it.get("analyzer", "")
        if an:
            by_an.setdefault(an, []).append(it)
        if it.get("rule") == "duplicate-literal":
            dups.append(it)
    return by_an, dups


def _render_all_issue_categories(issues: list[dict[str, Any]]) -> None:
    """分流渲染各领域分析器发现。"""
    by_an, dups = _partition_issues(issues)
    _render_category_issues("🧠 单函数高圈复杂度发现", by_an.get("complexity", []), "complexity", 5)
    _render_category_issues("📦 超大文件拆分候选", by_an.get("large-file", []), "large-file")
    _render_duplicate_literals(dups)
    _render_category_issues("⚡ 性能与高承压热点隐患", by_an.get("performance", []), "performance")
    _render_category_issues("🏗️ 架构分层契约守卫发现", by_an.get("architecture", []), "architecture")
    security_issues = by_an.get("security", []) + by_an.get("secrets", [])
    _render_category_issues("🛡️ 安全合规与凭据合规发现", security_issues, "security")
    _render_category_issues("🏛️ 治理规范与静态类型发现", by_an.get("governance", []), "governance")
    _render_category_issues("🧹 代码卫生与工程整洁度发现", by_an.get("hygiene", []), "hygiene")


def _render_audit_console_report(report: dict[str, Any], opts: RefactorAuditOptions) -> int:
    """输出控制台明细与十维质量大盘。"""
    summary = report.get("summary", {})
    by_sev = summary.get("bySeverity", {})
    quality_score = report.get("qualityScore", {})

    _render_summary_stats(summary)
    if quality_score:
        _render_quality_score_card(quality_score, show_detailed=opts.score_only)

    issues: list[dict[str, Any]] = report.get("issues", [])
    _render_all_issue_categories(issues)

    errors = by_sev.get("error", 0)
    arbitration = summary.get("arbitration", {}) if isinstance(summary, dict) else {}
    governance = report.get("governance") or {}
    gate_verdict = str(
        arbitration.get("gateVerdict", governance.get("gateVerdict", ""))
    ).strip().lower()
    if opts.strict and errors > 0:
        print(f"【审查结论】--strict 模式未通过（存在 {errors} 处 error 级发现）")
        return 1
    if opts.strict and gate_verdict == "blocked":
        blocking_count = arbitration.get("blockingCount", governance.get("blockingCount", 0))
        print(f"【审查结论】--strict 模式未通过（arbitration gateVerdict=blocked, blockingCount={blocking_count}）")
        return 1

    print("【审查结论】通过（auto-refactor 静态度量与多维重构建议就绪）")
    return 0


def _resolve_audit_runtime(opts: RefactorAuditOptions | None = None) -> tuple[str, Path] | None:
    """验证并定位 Node.js 运行时及通用 runner 路径（缺失即 fail-closed 阻断）。"""
    node_bin = find_node_executable()
    if not node_bin:
        print("【ERROR】未检测到 Node.js 运行时环境，auto-refactor 门禁阻断（fail-closed）。")
        return None
    cli_target = Path(opts.cli_path).resolve() if (opts and opts.cli_path) else AUTO_REFACTOR_CLI
    if not cli_target.exists():
        print(f"【ERROR】auto-refactor CLI 入口不存在 ({cli_target})，门禁阻断（fail-closed）。")
        return None
    engine_dir = cli_target.parent.parent if (opts and opts.cli_path) else AUTO_REFACTOR_DIR
    runner = engine_dir / "templates" / "consumer" / "run.mjs"
    if not runner.exists():
        print(f"【ERROR】引擎未提供通用 runner ({runner})，门禁阻断（fail-closed）。")
        return None
    return node_bin, runner


def _execute_refactor_process(cmd: list[str]) -> tuple[int, str, str]:
    """执行 auto-refactor 引擎子进程并捕获输出。"""
    try:
        r = subprocess.run(
            cmd,
            cwd=AUTO_REFACTOR_DIR,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        return r.returncode, r.stdout, r.stderr
    except Exception as exc:
        print(f"【ERROR】调用 auto-refactor 执行异常: {exc}，审查阻断（fail-closed）。")
        return 2, "", str(exc)


def _parse_report_payload(raw_output: str, stderr: str) -> dict[str, Any] | None:
    """从原始字符串解析 JSON 报告数据结构。"""
    try:
        return json.loads(raw_output)
    except Exception:
        parsed = _extract_json_object(raw_output or "")
        if parsed is None:
            print("【ERROR】auto-refactor 输出无法解析为 JSON，审查阻断（fail-closed）：")
            print((raw_output or stderr or "无输出")[:800])
        return parsed


def _resolve_target_root(slice_name: str | None) -> Path:
    """计算扫描目标根目录。"""
    if not slice_name:
        return ROOT
    target = ROOT / slice_name
    return target if target.exists() else ROOT


def _resolve_cli_format(opts: RefactorAuditOptions) -> str:
    """判定传给底层 runner 的输出格式（run.mjs 仅支持 json/sarif/text/compact）。"""
    if opts.json_output or opts.score_only:
        return "json"
    if opts.report_format == "sarif":
        return "sarif"
    return "json"


def _read_temp_report(report_path: Path) -> str | None:
    """读取并安全清理临时报告文件。"""
    try:
        return report_path.read_text(encoding="utf-8")
    except Exception:
        return None
    finally:
        try:
            report_path.unlink(missing_ok=True)
        except OSError as exc:
            print(f"【WARN】清理临时报告失败: {exc}", file=sys.stderr)


def _dispatch_audit_output(report: dict[str, Any], opts: RefactorAuditOptions) -> int:
    """派发审查报告输出或控制台卡片，并持久化最新质量快照供工作区门禁读取。"""
    try:
        latest_dir = ROOT / "reports"
        latest_dir.mkdir(parents=True, exist_ok=True)
        latest_path = latest_dir / "auto-refactor-latest.json"
        latest_path.write_text(
            json.dumps(
                {
                    "tool": report.get("tool", "auto-refactor"),
                    "version": report.get("version", ""),
                    "generatedAt": report.get("createdAt", ""),
                    "summary": report.get("summary", {}),
                    "qualityScore": report.get("qualityScore", {}),
                    "triPlaneQuality": report.get("triPlaneQuality", {}),
                    "governance": report.get("governance"),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
            newline="\n",
        )
    except OSError:
        pass
    if opts.json_output:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    return _render_audit_console_report(report, opts)


def run_refactor_audit(opts: RefactorAuditOptions | None = None, **kwargs: Any) -> int:
    """执行 auto-refactor 审查流水线。"""
    active_opts = opts if opts is not None else RefactorAuditOptions(**kwargs)
    mode_tag = "动态增量极速审查 (Dynamic Diff Mode)" if active_opts.diff_mode else "全量静态深度审查 (Full Static Mode)"
    print("=" * LINE_WIDTH)
    print(f"🔭 卡拉尔世界引擎：auto-refactor {mode_tag}")
    print("=" * LINE_WIDTH)

    runtime = _resolve_audit_runtime(active_opts)
    if not runtime:
        return 1
    node_bin, runner = runtime

    target_root = _resolve_target_root(active_opts.slice_name)
    cli_format = _resolve_cli_format(active_opts)
    report_path = Path(tempfile.gettempdir()) / f"webgames-auto-refactor-{os.getpid()}.json"

    cmd = _build_refactor_cmd(RefactorCommandContext(
        node_bin=node_bin, runner=runner, target_root=target_root,
        cli_format=cli_format, report_path=report_path, opts=active_opts,
    ))

    ret_code, stdout, stderr = _execute_refactor_process(cmd)
    if ret_code not in (0, 1):
        print(f"【ERROR】auto-refactor 返回非零崩溃码 {ret_code}: {stderr.strip()[:400]}，审查阻断（fail-closed）。")
        return 1

    raw_output = _read_temp_report(report_path)
    if raw_output is None:
        diag = (stderr or stdout or "").strip()[:600]
        detail = f"（exit={ret_code}，stderr: {diag}）" if diag else f"（exit={ret_code}）"
        print(f"【ERROR】auto-refactor 未产出报告文件{detail}，审查阻断（fail-closed）。")
        return 2

    if cli_format == "sarif":
        print(raw_output)
        return 0

    report = _parse_report_payload(raw_output, stderr)
    if report is None:
        return 2
    return _dispatch_audit_output(report, active_opts)


def main() -> int:
    """CLI 入口与参数解析。"""
    ap = argparse.ArgumentParser(description="auto-refactor 静态复杂度与多维代码健康度分析门禁")
    ap.add_argument("--strict", action="store_true", help="当存在 error 级发现时阻断门禁 (exit 1)")
    ap.add_argument("--json", action="store_true", help="输出完整 JSON 格式聚合报告")
    ap.add_argument("--score", action="store_true", help="打印完整十维质量评估明细看板")
    ap.add_argument(
        "--format",
        type=str,
        default="text",
        choices=["text", "json", "markdown", "sarif", "badge"],
        help="报告输出格式 (text, json, markdown, sarif, badge)",
    )
    ap.add_argument("--slice", type=str, default="", help="仅审查特定目录切片")
    ap.add_argument("--diff", action="store_true", help="仅审查 Git 增量变更文件")
    ap.add_argument("--baseline", type=str, default="", help="基线文件路径")
    ap.add_argument("--update-baseline", type=str, default="", help="更新基线文件路径")
    ap.add_argument("--analyzers", type=str, default="", help="透传 auto-refactor 分析器子集（逗号分隔）")
    ap.add_argument("--config", type=str, default="", help="透传 auto-refactor 配置文件路径")
    ap.add_argument("--cli-path", type=str, default="", help="覆盖 auto-refactor CLI 入口路径")
    ap.add_argument(
        "--maturity-tier",
        type=str,
        default="",
        choices=["", "demo", "prototype", "production", "industrial"],
        help="指定项目成熟度层级，动态调整审查严格度",
    )
    ap.add_argument(
        "--security-level",
        type=str,
        default="",
        choices=["", "off", "basic", "full"],
        help="安全扫描级别 (off, basic, full)",
    )
    ap.add_argument(
        "--classify-literals",
        action="store_true",
        help="开启高阶语义字面量识别分类 (URL, 端口, 路径, 时间等)",
    )
    args = ap.parse_args()

    opts = RefactorAuditOptions(
        strict=args.strict,
        json_output=args.json,
        score_only=args.score,
        report_format=args.format,
        slice_name=args.slice,
        diff_mode=args.diff,
        baseline=args.baseline,
        update_baseline=args.update_baseline,
        analyzers=args.analyzers,
        config_path=args.config,
        maturity_tier=args.maturity_tier,
        security_level=args.security_level,
        classify_literals=args.classify_literals,
        cli_path=args.cli_path,
    )
    return run_refactor_audit(opts)


if __name__ == "__main__":
    sys.exit(main())
