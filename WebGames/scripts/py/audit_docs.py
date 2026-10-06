#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 文档质量门禁)
# 文件路径: WebGames/scripts/py/audit_docs.py
# 架构定位: 综合文档审查引擎命令行入口 (Document Audit CLI Entrypoint)
# 依赖与触发: 触发方: CI / audit-all / 本地 CLI | 上游: docs/**/*.md | 下游: 门禁报告与自动修复 | 运行时: Python 3.10+
# 职责说明: 解析 CLI 参数、调度 docs_audit 审查子域、执行内建自测与输出结构化报告
# 退出语义与设计依据: 退出码: 0=合规, 1=阻断违规, 2=用法错误 | 设计依据: AGENTS.md 施工细则与文档门禁契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_docs.py
#   python scripts/py/audit_docs.py --json
#   python scripts/py/audit_docs.py --fix
# ==============================================================================
"""docs/ 文档库静态审查：命名格式、文档布局、链接完整性、mermaid 图表健康度。"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

from audit_common import KALAR_DEV_PREFIX, ensure_utf8_stdout, resolve_repo_root
from docs_audit import (
    DOCS_DIR,
    Doc,
    DocsAuditor,
    Finding,
    NAMING_RULES,
    RULES,
    SEV_ERROR,
    SEV_WARN,
    apply_baseline,
    cmd_self_test,
    load_baseline,
    write_baseline,
)

ROOT = resolve_repo_root()


def main() -> int:
    ensure_utf8_stdout()
    ap = argparse.ArgumentParser(description="docs/ 文档规范化静态审查与安全修复")
    ap.add_argument("--fix", action="store_true", help="应用安全修复（可修复类原位写回）")
    ap.add_argument("--dry-run", action="store_true", help="与 --fix 连用：演练不写盘")
    ap.add_argument("--json", action="store_true", help="输出机器可读 JSON（Agent 直读）")
    ap.add_argument("--report", metavar="PATH", help="将 JSON 报告写入指定文件")
    ap.add_argument("--baseline", metavar="PATH", help="基线棘轮门禁：仅对超出基线的新增违规阻断")
    ap.add_argument("--update-baseline", metavar="PATH",
                    help="以当前发现写入基线（仅限真实消化存量后；禁止用于消音新增违规）")
    ap.add_argument("--rules", action="store_true", help="输出规则注册表+命名模式声明（JSON）后退出")
    ap.add_argument("--manifest", action="store_true",
                    help="输出全库 JSONL 机器清单（file/档号/阶段/标题）供 Agent grep 定位，禁止通读大索引")
    ap.add_argument("--time", action="store_true", help="输出各阶段耗时（性能巡检）")
    ap.add_argument("--self-test", action="store_true", help="运行内建夹具自测")
    args = ap.parse_args()

    if args.self_test:
        return cmd_self_test()
    if args.manifest:
        aud = DocsAuditor(ROOT)
        aud.load()
        for doc in sorted(aud.docs_map.values(), key=lambda d: d.rel):
            name = os.path.basename(str(doc.path))
            mc = re.search(KALAR_DEV_PREFIX + r"-(?:RM|FE)\d{2}-\d{3}", name)
            ms = re.search(r"阶段(\d)", name)
            h1 = next((ln[2:].strip() for ln in doc.lines if ln.startswith("# ")), "")
            print(json.dumps({"file": doc.rel,
                              "code": mc.group(0) if mc else "",
                              "stage": int(ms.group(1)) if ms else 0,
                              "title": h1[:80]}, ensure_ascii=False))
        return 0
    if args.dry_run and not args.fix:
        print("【audit-docs】--dry-run 需与 --fix 连用", file=sys.stderr)
        return 2
    if args.rules:
        print(json.dumps({"schema": "docs-audit-rules/v1",
                          "rules": {k: {"severity": v[0], "fixable": v[1], "desc": v[2]}
                                    for k, v in RULES.items()},
                          "naming_rules": NAMING_RULES},
                         ensure_ascii=False, indent=1))
        return 0

    timing = {}
    t0 = time.perf_counter()
    aud = DocsAuditor(ROOT, extra_files=[ROOT / "README.md"])
    aud.load()
    timing["load_ms"] = round((time.perf_counter() - t0) * 1000)

    t1 = time.perf_counter()
    applied = []
    if args.fix:
        applied, findings = aud.fix(dry_run=args.dry_run)
        timing["fix_ms"] = round((time.perf_counter() - t1) * 1000)
        timing["audit_ms"] = 0
    else:
        findings = aud.check()
        timing["audit_ms"] = round((time.perf_counter() - t1) * 1000)
        timing["fix_ms"] = 0
    timing["total_ms"] = round((time.perf_counter() - t0) * 1000)

    if args.update_baseline:
        write_baseline(args.update_baseline, findings)
        print(f"【audit-docs】基线已写入 {args.update_baseline}"
              f"（{len(findings)} 条发现；仅限真实消化存量后使用）")
        return 0

    new_count = 0
    base = None
    if args.baseline:
        try:
            base = load_baseline(args.baseline)
        except FileNotFoundError:
            print(f"【audit-docs】基线文件不存在（{args.baseline}），按全量严格门禁执行", file=sys.stderr)
    if base is not None:
        new_count = apply_baseline(findings, base)

    def _rule_meta(rule_id: str) -> tuple:
        return RULES.get(rule_id, (SEV_ERROR, False, "未注册规则（基线残留或引擎下架）"))

    errors = [f for f in findings if _rule_meta(f.rule)[0] == SEV_ERROR]
    warns = [f for f in findings if _rule_meta(f.rule)[0] == SEV_WARN]
    by_rule: dict = {}
    for f in findings:
        by_rule[f.rule] = by_rule.get(f.rule, 0) + 1

    if args.json or args.report:
        payload = {
            "schema": "docs-audit/v1",
            "root": ROOT.name,
            "mode": "fix-dry-run" if (args.fix and args.dry_run) else ("fix" if args.fix else "check"),
            "summary": {"files": len(aud.docs_map), "errors": len(errors),
                        "warnings": len(warns), "new_violations": new_count,
                        "by_rule": by_rule, "fixes_applied": applied},
            "timing_ms": timing,
            "baseline": ({"path": args.baseline, "accepted": len(findings) - new_count}
                         if base is not None else None),
            "rules": {k: {"severity": v[0], "fixable": v[1], "desc": v[2]}
                      for k, v in RULES.items()},
            "findings": [f.to_dict() for f in findings],
        }
        js = json.dumps(payload, ensure_ascii=False, indent=2)
        if args.report:
            Path(args.report).write_text(js, encoding="utf-8")
        if args.json:
            print(js)
            return 0 if (new_count == 0 and not errors) else 1

    verb = "（演练，未写盘）" if (args.fix and args.dry_run) else \
           (f"，修复 {sum(a['fixes'] for a in applied)} 处 / {len(applied)} 份文件" if applied else "")
    print(f"【audit-docs】扫描 {len(aud.docs_map)} 份文档{verb}")
    for rule, meta in RULES.items():
        items = [f for f in findings if f.rule == rule and (base is None or f.is_new)]
        if not items:
            continue
        print(f"\n■ {rule}（{meta[0]}{'，可自动修复' if meta[1] else ''}）× {len(items)}"
              + ("  ← 新增" if base is not None else ""))
        for f in items[:8]:
            loc = f"{f.file}:{f.line}" if f.line else f.file
            print(f"  · {loc} — {f.message}")
            if f.suggestion:
                print(f"      ↳ 建议: {f.suggestion[:110]}")
        if len(items) > 8:
            print(f"  … 另 {len(items) - 8} 处（--json 查看全量）")
    print(f"\n【审查结论】error {len(errors)} / warn {len(warns)}"
          + (f" / 新增违规 {new_count}（存量已接受 {len(findings) - new_count}）" if base is not None else ""))
    if args.time:
        print(f"【审查结论】耗时 load {timing['load_ms']}ms + audit {timing['audit_ms']}ms"
              f" + fix {timing['fix_ms']}ms = {timing['total_ms']}ms")
    if base is not None:
        if new_count:
            print("【审查结论】未通过（存在超出基线的新增违规，Agent 不得合入）")
            return 1
        print("【审查结论】通过（无新增违规）")
        return 0
    if errors:
        print("【审查结论】未通过（存在 error 级发现）")
        return 1
    print("【审查结论】通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
