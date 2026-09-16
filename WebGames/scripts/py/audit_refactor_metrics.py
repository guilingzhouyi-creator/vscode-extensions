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
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

ROOT = resolve_repo_root()
WORKSPACE_ROOT = ROOT.parent
AUTO_REFACTOR_DIR = WORKSPACE_ROOT / "auto-refactor"
AUTO_REFACTOR_CLI = AUTO_REFACTOR_DIR / "dist" / "index.js"


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
        except Exception:
            pass
    win_paths = [
        Path(os.environ.get("ProgramFiles", "C:\\Program Files")) / "nodejs" / "node.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "node" / "node.exe",
        Path("E:/jiuguanNodeSystem/Node/node.exe"),
    ]
    for p in win_paths:
        if p.exists():
            return str(p)
    return ""


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
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    result: Any = json.loads(raw[start:i + 1])
                    if isinstance(result, dict):
                        return result
                    return None
                except Exception:
                    return None
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

    if show_detailed or composite < 80:
        print("  ┌" + "─" * 46 + "┬" + "─" * 28 + "┐")
        print("  │ 评估维度                                     │ 指标得分                   │")
        print("  ├" + "─" * 46 + "┼" + "─" * 28 + "┤")
        for dim_key, dim_title in dim_labels.items():
            val = indices.get(dim_key, 100)
            bar = _format_score_bar(val, width=10)
            print(f"  │ {dim_title:<44} │ [{bar}] {val:>3}/100 │")
        print("  └" + "─" * 46 + "┴" + "─" * 28 + "┘")

    if rationales:
        print("  💡 扣分主因与优化导引 (Top Penalties):")
        for r in rationales[:4]:
            dim_name = r.get("dimension", "")
            delta = r.get("delta", 0)
            reason = r.get("reason", "")
            line = r.get("line", 1)
            print(f"    • [{dim_name}] {delta:+d}分 (L{line}): {reason}")
    print("-" * 80)


def run_refactor_audit(
    strict: bool = False,
    json_output: bool = False,
    score_only: bool = False,
    report_format: str = "text",
    slice_name: str = "",
    diff_mode: bool = False,
    baseline: str = "",
    update_baseline: str = "",
    analyzers: str = "",
    config_path: str = "",
    maturity_tier: str = "",
    security_level: str = "",
    classify_literals: bool = False,
) -> int:
    """执行 auto-refactor 审查流水线。"""
    mode_tag = "动态增量极速审查 (Dynamic Diff Mode)" if diff_mode else "全量静态深度审查 (Full Static Mode)"
    print("=" * 80)
    print(f"🔭 卡拉尔世界引擎：auto-refactor {mode_tag}")
    print("=" * 80)

    node_bin = find_node_executable()
    if not node_bin:
        print("【提示】未检测到 Node.js 运行时环境，自动安全跳过 auto-refactor 分析（优雅降级）。")
        return 0

    if not AUTO_REFACTOR_CLI.exists():
        print(f"【提示】auto-refactor 尚未编译构建 ({AUTO_REFACTOR_CLI} 不存在)，自动跳过分析。")
        return 0

    target_root = ROOT if not slice_name else (ROOT / slice_name)
    if not target_root.exists():
        target_root = ROOT

    cli_format = "json"
    if report_format in ("markdown", "sarif", "badge") and not json_output and not score_only:
        cli_format = report_format

    runner = AUTO_REFACTOR_DIR / "templates" / "consumer" / "run.mjs"
    if not runner.exists():
        print(f"【提示】引擎未提供通用 runner ({runner})，自动跳过分析。")
        return 0

    resolved_config = config_path or str(ROOT / "auto-refactor.config.json")
    if resolved_config and Path(resolved_config).exists():
        _warn_threshold_divergence(resolved_config)
    elif config_path:
        print(f"【WARN】指定的 --config 不存在: {config_path}，回退引擎默认阈值。")

    # 已由项目配置承载的开关：引擎 CLI 本就无此参数（旧实现是静默 no-op），这里显式提示
    if maturity_tier:
        print("【提示】--maturity-tier 由项目配置 maturityTier 承载（引擎 CLI 无此开关），本次按配置执行。")
    if classify_literals:
        print("【提示】--classify-literals 由项目配置 classifyLiterals 承载（引擎 CLI 无此开关），本次按配置执行。")

    # 调用收敛到引擎通用 runner：参数组装、基线粒度与退出码映射由引擎单一真源负责
    report_path = Path(tempfile.gettempdir()) / f"webgames-auto-refactor-{os.getpid()}.json"
    cmd = [
        node_bin,
        str(runner),
        "--engine", str(AUTO_REFACTOR_DIR),
        "--root", str(target_root),
        "--format", cli_format,
        "--out", str(report_path),
        "--report-only",   # 引擎退出码不承载审查结论，本项目自行裁决
        "--quiet",
    ]
    if resolved_config and Path(resolved_config).exists():
        cmd.extend(["--config", resolved_config])
    if analyzers:
        cmd.extend(["--engine-arg", "--analyzers", "--engine-arg", analyzers])
    if diff_mode:
        # 引擎 CLI 的 --diff = 基于 git status 的变更集扫描（只扫改动文件），本项目按其透传
        cmd.extend(["--engine-arg", "--diff"])
    if security_level:
        cmd.extend(["--engine-arg", "--security-level", "--engine-arg", security_level])
    if baseline:
        cmd.extend(["--baseline", baseline])
    if update_baseline:
        cmd.extend(["--update-baseline", update_baseline])

    try:
        r = subprocess.run(
            cmd,
            cwd=AUTO_REFACTOR_DIR,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except Exception as e:
        print(f"【WARN】调用 auto-refactor 执行异常: {e}，安全降级跳过。")
        return 0

    if r.returncode not in (0, 1):
        print(f"【WARN】auto-refactor 返回非零码 {r.returncode}: {r.stderr.strip()[:200]}，安全降级跳过。")
        return 0

    try:
        raw_output = report_path.read_text(encoding="utf-8")
    except Exception:
        print("【ERROR】auto-refactor 未产出报告文件，审查阻断（fail-closed）。")
        return 2

    # 非 JSON 输出直通 (markdown / sarif / badge)
    if cli_format in ("markdown", "sarif", "badge"):
        print(raw_output)
        return 0

    try:
        report: dict[str, Any] = json.loads(raw_output)
    except Exception:
        parsed = _extract_json_object(raw_output or "")
        if parsed is None:
            print("【ERROR】auto-refactor 输出无法解析为 JSON，审查阻断（fail-closed）：")
            print((raw_output or r.stderr or "无输出")[:800])
            return 2
        report = parsed

    if json_output:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    summary = report.get("summary", {})
    files_scanned = summary.get("filesScanned", 0)
    issues_total = summary.get("issuesTotal", 0)
    by_sev = summary.get("bySeverity", {})
    by_analyzer = summary.get("byAnalyzer", {})
    duration_ms = summary.get("durationMs", 0)
    suppressed = summary.get("suppressedCount", 0)
    quality_score = report.get("qualityScore", {})

    print(f"  • 扫描源文件数: {files_scanned} 个 | 引擎耗时: {duration_ms} ms | 规则抑制: {suppressed} 处")
    print(f"  • 待优化项总计: {issues_total} 处 (ERROR {by_sev.get('error', 0)} / WARN {by_sev.get('warning', 0)} / INFO {by_sev.get('info', 0)})")

    analyzer_stats = " | ".join(f"{k}({v})" for k, v in sorted(by_analyzer.items()) if v > 0)
    if analyzer_stats:
        print(f"  • 分析器发现: {analyzer_stats}")
    print("-" * 80)

    # 渲染十维质量看板
    if quality_score:
        _render_quality_score_card(quality_score, show_detailed=score_only)

    issues: list[dict[str, Any]] = report.get("issues", [])
    complexity_issues = [it for it in issues if it.get("analyzer") == "complexity"]
    large_file_issues = [it for it in issues if it.get("analyzer") == "large-file"]
    duplicate_literal_issues = [it for it in issues if it.get("rule") == "duplicate-literal"]
    perf_issues = [it for it in issues if it.get("analyzer") == "performance"]
    arch_issues = [it for it in issues if it.get("analyzer") == "architecture"]
    sec_issues = [it for it in issues if it.get("analyzer") in ("security", "secrets")]
    governance_issues = [it for it in issues if it.get("analyzer") == "governance"]
    hygiene_issues = [it for it in issues if it.get("analyzer") == "hygiene"]

    # 1. 圈复杂度告警
    if complexity_issues:
        print("🧠 单函数高圈复杂度发现 (Top 5):")
        for iss in complexity_issues[:5]:
            loc = iss.get("location", {})
            file_loc = f"{loc.get('file', '')}:{loc.get('start', {}).get('line', 1)}"
            print(f"  ⚠️ [complexity] {file_loc} — {iss.get('message', '')}")
            if iss.get("suggestion"):
                print(f"     💡 建议: {iss.get('suggestion')}")
        print("-" * 80)

    # 2. 超大文件拆分建议
    if large_file_issues:
        print("📦 超大文件拆分候选 (Top 3):")
        for iss in large_file_issues[:3]:
            loc = iss.get("location", {})
            file_loc = f"{loc.get('file', '')}:{loc.get('start', {}).get('line', 1)}"
            print(f"  ⚠️ [large-file] {file_loc} — {iss.get('message', '')}")
        print("-" * 80)

    # 3. 高频重复字面量常量提炼建议
    if duplicate_literal_issues:
        print("💎 高频重复字面量常量提炼建议 (Top 3):")
        for iss in duplicate_literal_issues[:3]:
            loc = iss.get("location", {})
            file_loc = f"{loc.get('file', '')}:{loc.get('start', {}).get('line', 1)}"
            val = iss.get("detail", {}).get("value", "")
            occ = iss.get("detail", {}).get("occurrences", 0)
            print(f"  💡 [constants] {file_loc} — 字面量「{val}」在文件中重复出现 {occ} 次")
            if iss.get("suggestion"):
                print(f"     ↳ 提炼建议: {iss.get('suggestion')}")
        print("-" * 80)

    # 4. 性能与高承压隐患 (PRF-*)
    if perf_issues:
        print("⚡ 性能与高承压热点隐患 (Top 3):")
        for iss in perf_issues[:3]:
            loc = iss.get("location", {})
            file_loc = f"{loc.get('file', '')}:{loc.get('start', {}).get('line', 1)}"
            print(f"  ⚠️ [performance/{iss.get('rule', '')}] {file_loc} — {iss.get('message', '')}")
            if iss.get("suggestion"):
                print(f"     💡 建议: {iss.get('suggestion')}")
        print("-" * 80)

    # 5. 架构分层契约 (ARCH-*)
    if arch_issues:
        print("🏗️ 架构分层契约守卫发现 (Top 3):")
        for iss in arch_issues[:3]:
            loc = iss.get("location", {})
            file_loc = f"{loc.get('file', '')}:{loc.get('start', {}).get('line', 1)}"
            print(f"  ⚠️ [architecture/{iss.get('rule', '')}] {file_loc} — {iss.get('message', '')}")
            if iss.get("suggestion"):
                print(f"     💡 建议: {iss.get('suggestion')}")
        print("-" * 80)

    # 6. 安全与凭据合规 (SEC-*)
    if sec_issues:
        print("🛡️ 安全合规与凭据合规发现 (Top 3):")
        for iss in sec_issues[:3]:
            loc = iss.get("location", {})
            file_loc = f"{loc.get('file', '')}:{loc.get('start', {}).get('line', 1)}"
            print(f"  ⚠️ [{iss.get('analyzer', '')}/{iss.get('rule', '')}] {file_loc} — {iss.get('message', '')}")
            if iss.get("suggestion"):
                print(f"     💡 建议: {iss.get('suggestion')}")
        print("-" * 80)

    # 7. 治理规则发现（GOV-*）
    if governance_issues:
        print("🏛️ 治理规范与静态类型发现 (Top 3):")
        for iss in governance_issues[:3]:
            loc = iss.get("location", {})
            file_loc = f"{loc.get('file', '')}:{loc.get('start', {}).get('line', 1)}"
            print(f"  ⚠️ [governance/{iss.get('rule', '')}] {file_loc} — {iss.get('message', '')}")
            if iss.get("suggestion"):
                print(f"     💡 建议: {iss.get('suggestion')}")
        print("-" * 80)

    # 8. 代码卫生与命名发现 (HYG-*)
    if hygiene_issues:
        print("🧹 代码卫生与工程整洁度发现 (Top 3):")
        for iss in hygiene_issues[:3]:
            loc = iss.get("location", {})
            file_loc = f"{loc.get('file', '')}:{loc.get('start', {}).get('line', 1)}"
            print(f"  ⚠️ [hygiene/{iss.get('rule', '')}] {file_loc} — {iss.get('message', '')}")
            if iss.get("suggestion"):
                print(f"     💡 建议: {iss.get('suggestion')}")
        print("-" * 80)

    errors = by_sev.get("error", 0)
    if strict and errors > 0:
        print(f"【审查结论】--strict 模式未通过（存在 {errors} 处 error 级发现）")
        return 1

    print("【审查结论】通过（auto-refactor 静态度量与多维重构建议就绪）")
    return 0


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

    return run_refactor_audit(
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
    )


if __name__ == "__main__":
    sys.exit(main())
