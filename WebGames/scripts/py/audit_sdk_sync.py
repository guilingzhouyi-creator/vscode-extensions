#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · MOD SDK 门禁审计)
# 文件路径: WebGames/scripts/py/audit_sdk_sync.py
# 架构定位: MOD SDK 契约防漂移与资产完整性门禁审计引擎 (MOD SDK Contract Drift & Integrity Audit Gate)
# 依赖与触发: 触发方: CI / 预提交钩子 / audit-all / 本地 CLI | 上游: mod_sdk/** & config/** | 下游: 门禁报告与退出码阻断 | 运行时: Python 3.10+
# 职责说明: 自动化审计 MOD SDK 根元数据、docs 规范库、schemas 强类型契约、tools 工具链物理完整性与防漂移状态，输出结构化审计结论
# 退出语义与设计依据: 退出码: 0=合规通过, 1=发现漂移或不合规项, 2=用法错误/运行异常 | 设计依据: 《卡拉尔数据契约规范 v1.0》与第一性原理
# ------------------------------------------------------------------------------
# 用法示例:
#   python WebGames/scripts/py/audit_sdk_sync.py
#   python WebGames/scripts/py/audit_sdk_sync.py --json
# ==============================================================================
"""MOD SDK 契约防漂移与资产完整性门禁审计脚本。

校验 mod_sdk 产物的物理完整性（根目录元数据、docs/ 规范库、schemas/ 强类型字典、
tools/ 统一 CLI 工具链、templates/ 脚手架模板）、核心能力清单结构语义与无漂移契约一致性。
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from lib.audit_sdk_rules import (
    AuditFinding,
    check_capabilities_schema,
    check_docs_integrity,
    check_root_metadata_files,
    check_schemas_integrity,
    check_spec_guidance_structure,
    check_templates_and_examples,
    check_tools_integrity,
)
from lib.mod_sdk_shared import (
    check_contract_drift,
    ensure_utf8_stdout,
    extract_capabilities,
    resolve_webgames_root,
)

__all__ = [
    "AuditFinding",
    "ModSdkAuditor",
    "main",
]


class ModSdkAuditor:
    """MOD SDK 门禁审计核心执行器。"""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.mod_sdk_dir = root / "mod_sdk"
        self.findings: list[AuditFinding] = []

    def run_all_checks(self) -> bool:
        """执行全项静态审计，返回是否完全合规。"""
        self.findings.clear()
        check_root_metadata_files(self.mod_sdk_dir, self.findings)
        check_docs_integrity(self.mod_sdk_dir, self.findings)
        check_schemas_integrity(self.mod_sdk_dir, self.findings)
        check_tools_integrity(self.mod_sdk_dir, self.findings)
        check_templates_and_examples(self.mod_sdk_dir, self.findings)
        check_capabilities_schema(self.mod_sdk_dir, self.findings)
        check_spec_guidance_structure(self.mod_sdk_dir, self.findings)
        self._check_zero_drift()
        return len(self.findings) == 0

    def _check_zero_drift(self) -> None:
        """审计磁盘既有契约与内存真源萃取的一致性（防漂移断言）。"""
        cap = extract_capabilities(self.root)
        is_clean, diffs = check_contract_drift(self.root, cap)

        if not is_clean:
            for diff in diffs:
                self.findings.append(
                    AuditFinding(
                        rule_id="SDK-CONTRACT-DRIFT",
                        file_path="WebGames/mod_sdk/",
                        line=1,
                        severity="error",
                        message=f"MOD SDK 契约与底层引擎真源存在漂移: {diff[:200]}...",
                        suggestion="运行 python WebGames/scripts/py/sync_mod_sdk.py 同步契约",
                    )
                )


def main() -> int:
    """CLI 入口。"""
    ensure_utf8_stdout()
    parser = argparse.ArgumentParser(
        description="卡拉尔引擎 MOD 开发者 SDK 门禁自动化审计系统"
    )
    parser.add_argument(
        "--json", action="store_true", help="输出机器可读 JSON 格式报告"
    )
    args = parser.parse_args()

    root = resolve_webgames_root()
    auditor = ModSdkAuditor(root)
    passed = auditor.run_all_checks()

    if args.json:
        report = {
            "summary": {
                "total_findings": len(auditor.findings),
                "passed": passed,
            },
            "findings": [asdict(f) for f in auditor.findings],
        }
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0 if passed else 1

    print("=" * 70)
    print("【MOD SDK 契约防漂移与全量资产完整性门禁审计】")
    print(f"扫描目录: {auditor.mod_sdk_dir}")
    print("=" * 70)

    if passed:
        print(
            "\n✅ [AUDIT SUCCESS] MOD SDK 契约与引擎真源保持 100% 深度对齐，全量资产完整无漂移。"
        )
        print("  - capabilities.json 结构与必要枚举语义校验通过")
        print(
            "  - MOD_SPEC.md 契约指南章节完整且动态标记闭合 (含 Tier 1/2/3 与 docs/ 导航)"
        )
        print("  - docs/ 权威规范库 (SPECIFICATION.md 等) 物理完整且非空")
        print("  - schemas/ 强类型契约字典 (全量 15 项 Schema) 物理完整且语法校验通过")
        print("  - tools/ 工具链 (kalar_mod.py 统一 CLI 等) 完备且子命令覆盖全面")
        print("  - templates/ 分级初始工程骨架物理完整")
        print("  - 磁盘文件与单一真源静态萃取结果完全一致 (0 漂移)")
        return 0

    print(
        f"\n❌ [AUDIT FAILED] 发现 {len(auditor.findings)} 项契约违规、资产缺失或漂移:"
    )
    for idx, f in enumerate(auditor.findings, start=1):
        print(f"  {idx}. [{f.rule_id}] {f.file_path}: {f.message}")
        if f.suggestion:
            print(f"     👉 修复建议: {f.suggestion}")
    print("\n请修正后重新运行门禁审计。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
