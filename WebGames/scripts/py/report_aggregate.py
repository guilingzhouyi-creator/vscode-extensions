#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 门禁报告汇流引擎)
# 文件路径: WebGames/scripts/py/report_aggregate.py
# 架构定位: 报表聚合处理器 (Report Aggregator)
# 依赖与触发: 触发方: CI / audit_runner | 上游: 门禁 JSON 结果片段 | 下游: 统一 Markdown/HTML 摘要 | 运行时: Python 3.10+
# 职责说明: 汇集全域静态门禁与测试运行产生的机器可读结果，输出统一聚合仪表盘
# 退出语义与设计依据: 退出码: 0=汇聚成功 | 设计依据: 门禁可观测性契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/report_aggregate.py --input-dir reports/ --output report.md
# ==============================================================================
"""聚合基准报告为基线表；支持版本对比、性能回归门禁与 golden 基线晋升。"""
import argparse
import datetime
import json
import sys
from pathlib import Path
from audit_common import ensure_utf8_stdout, resolve_repo_root, load_json

ensure_utf8_stdout()

ROOT = resolve_repo_root()
REPORTS_DIR = ROOT / "benchmarks" / "reports"
BASELINE_PATH = REPORTS_DIR / "baseline.json"


def load(path: Path) -> dict:
    try:
        return load_json(path)
    except Exception as e:
        print(f"【report-aggregate】无法读取报告 {path}: {e}", file=sys.stderr)
        sys.exit(1)


def newest_report() -> Path:
    files = sorted(
        REPORTS_DIR.glob("bench_*.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not files:
        print(f"【report-aggregate】{REPORTS_DIR} 下无 bench_*.json 报告", file=sys.stderr)
        sys.exit(1)
    return files[0]


def metric_map(report: dict) -> dict[str, float]:
    out: dict[str, float] = {}
    for cat in report.get("categories", []):
        for m in cat.get("metrics", []):
            out[m["name"]] = m["ops_per_sec"]
    return out


def render_table(rows: list[tuple]) -> str:
    lines = ["| 指标 | 迭代次数 | 耗时(ms) | 吞吐量 (ops/s) |", "|---|---:|---:|---:|"]
    for name, iters, ms, ops in rows:
        lines.append(f"| {name} | {iters} | {ms:.1f} | {ops:,.1f} |")
    return "\n".join(lines)


def promote() -> int:
    """把最新报告晋升为机器可读 golden 基线（供 --gate 对比）。"""
    cur = newest_report()
    data = load(cur)
    data["promoted_from"] = cur.name
    data["promoted_at"] = datetime.datetime.now().isoformat(timespec="seconds")
    BASELINE_PATH.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"【report-aggregate】基线已晋升: {cur.name} → {BASELINE_PATH.name}")
    return 0


def run_gate(base_path: Path, cur_path: Path, threshold: float) -> int:
    """性能回归门禁：cur 相对 base 回退超过阈值(负向百分比)即失败。"""
    if not base_path.exists():
        print(f"【性能门禁】无 golden 基线 {base_path.name}，请先 --promote 晋升（本次跳过，不阻断）")
        return 0
    base, cur = load(base_path), load(cur_path)
    bm, cm = metric_map(base), metric_map(cur)

    lines = [
        f"# 性能回归门禁: {cur_path.name} vs 基线 {base_path.name}（阈值 {threshold:g}%）",
        "",
        "| 指标 | 基线 (ops/s) | 当前 (ops/s) | 变化 | 判定 |",
        "|---|---:|---:|---:|:--:|",
    ]
    regressions: list[tuple] = []
    for name in sorted(set(bm) & set(cm)):
        o, m = bm[name], cm[name]
        d = (m - o) / o * 100
        if d <= -threshold:
            regressions.append((name, o, m, d))
            verdict = "🔻 回退"
        elif d >= 5:
            verdict = "🔺 提升"
        else:
            verdict = "—"
        lines.append(f"| {name} | {o:,.1f} | {m:,.1f} | {d:+.1f}% | {verdict} |")

    added = sorted(set(cm) - set(bm))
    removed = sorted(set(bm) - set(cm))
    for n in added:
        lines.append(f"| {n} | — | {cm[n]:,.1f} | — | 新增指标 |")
    for n in removed:
        lines.append(f"| {n} | {bm[n]:,.1f} | — | — | 基线独有 |")

    print("\n".join(lines))
    if regressions:
        print(f"【性能门禁】未通过: {len(regressions)} 项回退超过 {threshold:g}%")
        for name, o, m, d in regressions:
            print(f"  ✗ {name}: {o:,.1f} → {m:,.1f} ({d:+.1f}%)")
        return 1
    print(f"【性能门禁】通过（共对比 {len(set(bm) & set(cm))} 项指标）")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="输出 Markdown 文件路径（缺省输出到 stdout）")
    ap.add_argument("--compare", nargs=2, metavar=("OLD", "NEW"), help="对比两版本报告")
    ap.add_argument("--gate", nargs="?", const=10.0, type=float, metavar="阈值",
                    help="性能回归门禁：最新 vs 基线，回退超阈值即退出码 1（默认 10）")
    ap.add_argument("--base", help="门禁对比的 golden 基线路径（默认 benchmarks/reports/baseline.json）")
    ap.add_argument("--promote", action="store_true", help="把最新报告晋升为 golden 基线")
    args = ap.parse_args()

    if args.promote:
        return promote()
    if args.gate is not None:
        base = Path(args.base) if args.base else BASELINE_PATH
        return run_gate(base, newest_report(), args.gate)
    if args.compare:
        old, new = load(Path(args.compare[0])), load(Path(args.compare[1]))
        om, nm = metric_map(old), metric_map(new)
        names = sorted(set(om) | set(nm))
        lines = [
            f"# 基准对比: {Path(args.compare[0]).name} → {Path(args.compare[1]).name}",
            "",
            "| 指标 | 旧 (ops/s) | 新 (ops/s) | 变化 | 判定 |",
            "|---|---:|---:|---:|:--:|",
        ]
        for n in names:
            o, m = om.get(n), nm.get(n)
            if o is None or m is None:
                lines.append(f"| {n} | {o or '—'} | {m or '—'} | — | 新增/缺失 |")
                continue
            d = (m - o) / o * 100
            verdict = "🔺" if d >= 5 else ("🔻" if d <= -5 else "—")
            lines.append(f"| {n} | {o:,.1f} | {m:,.1f} | {d:+.1f}% | {verdict} |")
        text = "\n".join(lines)
    else:
        rep = load(newest_report())
        rows: list[tuple] = []
        for cat in rep.get("categories", []):
            for m in cat.get("metrics", []):
                rows.append((m["name"], m["iterations"], m["elapsed_us"] / 1000.0, m["ops_per_sec"]))
        rows.sort(key=lambda r: r[3], reverse=True)
        lines = [
            "# 卡拉尔世界引擎 · 吞吐量基线表",
            "",
            f"- 引擎: {rep.get('engine', '?')}  Godot: {rep.get('godot_version', '?')}",
            f"- 时间: {rep.get('timestamp', '?')}  主机: {rep.get('host', '?')}",
            f"- 报告: {newest_report().name}",
            "",
            render_table(rows),
        ]
        text = "\n".join(lines)

    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(text + "\n", encoding="utf-8")
        print(f"【report-aggregate】已写入: {args.out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
