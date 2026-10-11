#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · MOD SDK 门禁审计)
# 文件路径: WebGames/scripts/py/audit_sdk_sync.py
# 架构定位: MOD SDK 契约防漂移门禁审计引擎 (MOD SDK Contract Drift Audit Gate)
# 依赖与触发: 触发方: CI / 预提交钩子 / audit-all / 本地 CLI | 上游: mod_sdk/** & config/** | 下游: 门禁报告与退出码阻断 | 运行时: Python 3.10+
# 职责说明: 自动化审计 MOD SDK 文件物理完整性、能力清单语义合规性与契约防漂移状态，输出结构化审计结论
# 退出语义与设计依据: 退出码: 0=合规通过, 1=发现漂移或不合规项, 2=用法错误/运行异常 | 设计依据: AGENTS.md 契约防漂移与单源规则契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python WebGames/scripts/py/audit_sdk_sync.py
#   python WebGames/scripts/py/audit_sdk_sync.py --json
# ==============================================================================
"""MOD SDK 契约防漂移门禁审计脚本。

校验 mod_sdk 产物的物理完整性、核心能力清单结构语义与无漂移契约一致性。
"""

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

# 导入同步萃取器逻辑
from sync_mod_sdk import (
    check_contract_drift,
    ensure_utf8_stdout,
    extract_capabilities,
    resolve_webgames_root,
)


@dataclass
class AuditFinding:
    rule_id: str
    file_path: str
    line: int
    severity: str
    message: str
    suggestion: str = ""


class ModSdkAuditor:
    """MOD SDK 门禁审计核心执行器。"""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.mod_sdk_dir = root / "mod_sdk"
        self.findings: List[AuditFinding] = []

    def run_all_checks(self) -> bool:
        """执行全项静态审计，返回是否完全合规。"""
        self.findings.clear()
        self._check_file_existence_and_size()
        self._check_capabilities_schema()
        self._check_spec_guidance_structure()
        self._check_zero_drift()
        return len(self.findings) == 0

    def _check_file_existence_and_size(self) -> None:
        """审计必要文件的物理存在性与零字节违规。"""
        required_files = [
            ("capabilities.json", "MOD 能力清单单一真源文件"),
            ("MOD_SPEC.md", "MOD 创作者 Agent 一页纸极简指南"),
            ("README.md", "MOD SDK 架构与使用说明总览"),
        ]

        for filename, desc in required_files:
            file_path = self.mod_sdk_dir / filename
            rel_path = f"WebGames/mod_sdk/{filename}"

            if not file_path.is_file():
                self.findings.append(AuditFinding(
                    rule_id="SDK-PHYSICAL-MISSING",
                    file_path=rel_path,
                    line=1,
                    severity="error",
                    message=f"缺失核心 SDK 文件: {filename} ({desc})",
                    suggestion=f"请运行 python WebGames/scripts/py/sync_mod_sdk.py 重新生成该文件",
                ))
                continue

            try:
                size = file_path.stat().st_size
                if size == 0:
                    self.findings.append(AuditFinding(
                        rule_id="SDK-FILE-ZERO-BYTE",
                        file_path=rel_path,
                        line=1,
                        severity="error",
                        message=f"文件体积为 0 字节空文件: {filename}",
                        suggestion=f"严禁遗留空文件，请重新生成或补全内容",
                    ))
            except OSError as exc:
                self.findings.append(AuditFinding(
                    rule_id="SDK-STAT-ERROR",
                    file_path=rel_path,
                    line=1,
                    severity="error",
                    message=f"无法读取文件状态: {filename} ({exc})",
                ))

    def _check_capabilities_schema(self) -> None:
        """审计 capabilities.json 的结构字段完整性与必要枚举语义。"""
        cap_path = self.mod_sdk_dir / "capabilities.json"
        rel_path = "WebGames/mod_sdk/capabilities.json"
        if not cap_path.is_file():
            return

        try:
            data = json.loads(cap_path.read_text(encoding="utf-8"))
        except Exception as exc:
            self.findings.append(AuditFinding(
                rule_id="SDK-JSON-INVALID",
                file_path=rel_path,
                line=1,
                severity="error",
                message=f"capabilities.json 解析 JSON 语法失败: {exc}",
                suggestion="确保文件内容为合法 JSON 且无乱码",
            ))
            return

        # 1. supported_races
        races = data.get("supported_races")
        if not isinstance(races, list) or len(races) == 0:
            self.findings.append(AuditFinding(
                rule_id="SDK-RACES-EMPTY",
                file_path=rel_path,
                line=1,
                severity="error",
                message="capabilities.json 缺少有效的 supported_races 列表",
                suggestion="supported_races 必须为包含至少 1 个已启用种族的列表",
            ))
        elif "HUMAN" not in races:
            self.findings.append(AuditFinding(
                rule_id="SDK-RACES-HUMAN-MISSING",
                file_path=rel_path,
                line=1,
                severity="error",
                message="supported_races 中缺少基础种族 HUMAN",
                suggestion="确保 core.json 中的 HUMAN 处于启用状态",
            ))

        # 2. valid_node_types
        expected_node_types = {"START_ENTRY", "STANDARD_STEP", "BRANCH_CHOICE", "TERMINAL_EXIT"}
        node_types = set(data.get("valid_node_types", []))
        missing_nodes = expected_node_types - node_types
        if missing_nodes:
            self.findings.append(AuditFinding(
                rule_id="SDK-NODE-TYPES-INCOMPLETE",
                file_path=rel_path,
                line=1,
                severity="error",
                message=f"valid_node_types 缺少必需节点类型: {sorted(list(missing_nodes))}",
                suggestion="DAG 节点类型必须包含四类标准拓扑节点",
            ))

        # 3. available_placeholders
        expected_placeholders = {
            "{PLAYER_NAME}",
            "{RACE_ID}",
            "{START_LOCATION}",
            "{INITIAL_EQUIPMENT}",
            "{NPC_TARGET}",
        }
        placeholders = set(data.get("available_placeholders", {}).keys())
        missing_ph = expected_placeholders - placeholders
        if missing_ph:
            self.findings.append(AuditFinding(
                rule_id="SDK-PLACEHOLDER-MISSING",
                file_path=rel_path,
                line=1,
                severity="error",
                message=f"available_placeholders 缺少核心占位符: {sorted(list(missing_ph))}",
                suggestion="必须补齐剧情与创角核心占位符字典",
            ))

        # 4. valid_mutation_events
        expected_mutations = {
            "CharacterCreated",
            "LocationAssigned",
            "EquipmentGranted",
            "DialogueReady",
            "PrologueCompleted",
        }
        mutations = set(data.get("valid_mutation_events", []))
        missing_mut = expected_mutations - mutations
        if missing_mut:
            self.findings.append(AuditFinding(
                rule_id="SDK-MUTATION-MISSING",
                file_path=rel_path,
                line=1,
                severity="error",
                message=f"valid_mutation_events 缺少核心状态突变事件: {sorted(list(missing_mut))}",
                suggestion="确保包含 CharacterCreated, LocationAssigned 等五项标准突变事件",
            ))

    def _check_spec_guidance_structure(self) -> None:
        """审计 MOD_SPEC.md 核心章节与动态标记完整度。"""
        spec_path = self.mod_sdk_dir / "MOD_SPEC.md"
        rel_path = "WebGames/mod_sdk/MOD_SPEC.md"
        if not spec_path.is_file():
            return

        text = spec_path.read_text(encoding="utf-8")
        required_markers = [
            ("<!-- AUTOGEN_CAPABILITIES_START -->", "动态能力清单起始标记"),
            ("<!-- AUTOGEN_CAPABILITIES_END -->", "动态能力清单结束标记"),
            ("pack.json", "MOD 清单元数据契约说明"),
            ("START_ENTRY", "DAG 入口节点规范说明"),
            ("TERMINAL_EXIT", "DAG 出口节点规范说明"),
        ]

        for marker, desc in required_markers:
            if marker not in text:
                self.findings.append(AuditFinding(
                    rule_id="SDK-SPEC-SECTION-MISSING",
                    file_path=rel_path,
                    line=1,
                    severity="error",
                    message=f"MOD_SPEC.md 缺少必要结构或标记: {marker} ({desc})",
                    suggestion="请运行 sync_mod_sdk.py 重新渲染规范文档",
                ))

    def _check_zero_drift(self) -> None:
        """审计磁盘既有契约与内存真源萃取的一致性（防漂移断言）。"""
        cap = extract_capabilities(self.root)
        is_clean, diffs = check_contract_drift(self.root, cap)

        if not is_clean:
            for diff in diffs:
                self.findings.append(AuditFinding(
                    rule_id="SDK-CONTRACT-DRIFT",
                    file_path="WebGames/mod_sdk/",
                    line=1,
                    severity="error",
                    message=f"MOD SDK 契约与底层引擎真源存在漂移: {diff[:200]}...",
                    suggestion="运行 python WebGames/scripts/py/sync_mod_sdk.py 同步契约",
                ))


def main() -> int:
    """CLI 入口。"""
    ensure_utf8_stdout()
    parser = argparse.ArgumentParser(description="卡拉尔引擎 MOD 开发者 SDK 门禁自动化审计系统")
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON 格式报告")
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
    print("【MOD SDK 契约防漂移门禁审计】")
    print(f"扫描目录: {auditor.mod_sdk_dir}")
    print("=" * 70)

    if passed:
        print("\n✅ [AUDIT SUCCESS] MOD SDK 契约与引擎真源保持 100% 深度对齐，无漂移。")
        print("  - capabilities.json 结构与必要枚举语义校验通过")
        print("  - MOD_SPEC.md 契约指南章节完整且动态标记闭合")
        print("  - 磁盘文件与单一真源静态萃取结果完全一致 (0 漂移)")
        return 0

    print(f"\n❌ [AUDIT FAILED] 发现 {len(auditor.findings)} 项契约违规或漂移:")
    for idx, f in enumerate(auditor.findings, start=1):
        print(f"  {idx}. [{f.rule_id}] {f.file_path}: {f.message}")
        if f.suggestion:
            print(f"     👉 修复建议: {f.suggestion}")
    print("\n请修正后重新运行门禁审计。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
