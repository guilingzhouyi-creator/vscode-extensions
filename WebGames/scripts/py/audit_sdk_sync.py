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


SEVERITY_ERROR = "error"
RULE_STAT_ERROR = "SDK-STAT-ERROR"
UTF8 = "utf-8"


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
        self._check_root_metadata_files()
        self._check_docs_integrity()
        self._check_schemas_integrity()
        self._check_tools_integrity()
        self._check_templates_and_examples()
        self._check_capabilities_schema()
        self._check_spec_guidance_structure()
        self._check_zero_drift()
        return len(self.findings) == 0

    def _check_root_metadata_files(self) -> None:
        """审计根目录核心元数据文件的物理存在性与非空断言。"""
        required_files = [
            ("capabilities.json", "MOD 能力清单单一真源文件"),
            ("MOD_SPEC.md", "MOD 创作者核心契约速查指南"),
            ("README.md", "MOD SDK 架构与开发者套件总览"),
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
                    message=f"缺失核心 SDK 根目录元数据文件: {filename} ({desc})",
                    suggestion="请运行 python WebGames/scripts/py/sync_mod_sdk.py 重新生成该文件",
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
                        suggestion="严禁遗留空文件，请重新生成或补全内容",
                    ))
            except OSError as exc:
                self.findings.append(AuditFinding(
                    rule_id="SDK-STAT-ERROR",
                    file_path=rel_path,
                    line=1,
                    severity="error",
                    message=f"无法读取文件状态: {filename} ({exc})",
                ))

    def _check_docs_integrity(self) -> None:
        """审计 docs/ 目录及其关键规范文档资产的物理存在性与非空断言。"""
        docs_dir = self.mod_sdk_dir / "docs"
        rel_dir = "WebGames/mod_sdk/docs"

        if not docs_dir.is_dir():
            self.findings.append(AuditFinding(
                rule_id="SDK-DOCS-DIR-MISSING",
                file_path=rel_dir,
                line=1,
                severity="error",
                message="缺少权威规范文档目录 docs/",
                suggestion="确保 mod_sdk/docs/ 目录存在并包含全量规范手册",
            ))
            return

        expected_docs = [
            ("SPECIFICATION.md", "模组生态核心架构与数据契约全景规范 (v1.0)"),
            ("AGENT_INTERACTION.md", "Agent 无头交互式推演协议与 STDIO 规范"),
            ("ART_AND_ASSETS_GUIDE.md", "Tier 2 视听与艺术资产烹饪准入指南"),
            ("TOTAL_CONVERSION_SPEC.md", "Tier 3 全局大魔改规则扩展规范"),
            ("COMPANION_PROTOCOL.md", "非侵入式伴侣观察总线与现场遥测协议"),
        ]

        for doc_name, doc_desc in expected_docs:
            doc_path = docs_dir / doc_name
            rel_path = f"WebGames/mod_sdk/docs/{doc_name}"

            if not doc_path.is_file():
                self.findings.append(AuditFinding(
                    rule_id="SDK-DOC-FILE-MISSING",
                    file_path=rel_path,
                    line=1,
                    severity="error",
                    message=f"缺少官方规范文档: {doc_name} ({doc_desc})",
                    suggestion=f"请补齐 {rel_path} 规范文档",
                ))
                continue

            try:
                if doc_path.stat().st_size == 0:
                    self.findings.append(AuditFinding(
                        rule_id="SDK-DOC-FILE-ZERO-BYTE",
                        file_path=rel_path,
                        line=1,
                        severity="error",
                        message=f"规范文档体积为 0 字节空文件: {doc_name}",
                        suggestion="严禁遗留空文档，请补充规范正文",
                    ))
            except OSError as exc:
                self.findings.append(AuditFinding(
                    rule_id="SDK-STAT-ERROR",
                    file_path=rel_path,
                    line=1,
                    severity="error",
                    message=f"无法读取文档状态: {doc_name} ({exc})",
                ))

    def _check_schemas_integrity(self) -> None:
        """审计 schemas/ 目录及其全量 JSON Schema 强类型字典的物理存在性与语法有效性。"""
        schemas_dir = self.mod_sdk_dir / "schemas"
        rel_dir = "WebGames/mod_sdk/schemas"

        if not schemas_dir.is_dir():
            self.findings.append(AuditFinding(
                rule_id="SDK-SCHEMAS-DIR-MISSING",
                file_path=rel_dir,
                line=1,
                severity="error",
                message="缺少强类型契约字典目录 schemas/",
                suggestion="确保 mod_sdk/schemas/ 目录存在并包含全量 JSON Schema",
            ))
            return

        expected_schemas = [
            ("pack.schema.json", "模组元数据清单 Schema"),
            ("destinies.schema.json", "命途身世与因果天赋 Schema"),
            ("dag_graph.schema.json", "因果剧情图元 Schema"),
            ("assets_manifest.schema.json", "资产指纹清单 Schema"),
            ("game_rules.schema.json", "规则动力学常数 Schema"),
            ("items.schema.json", "物品道具原型 Schema"),
            ("skills.schema.json", "动作战技卡牌 Schema"),
            ("world.schema.json", "世界地图空间阻抗 Schema"),
            ("observation.schema.json", "Agent 观察快照 Schema"),
            ("action.schema.json", "Agent 决策动作 Schema"),
        ]

        for s_name, s_desc in expected_schemas:
            s_path = schemas_dir / s_name
            rel_path = f"WebGames/mod_sdk/schemas/{s_name}"

            if not s_path.is_file():
                self.findings.append(AuditFinding(
                    rule_id="SDK-SCHEMA-MISSING",
                    file_path=rel_path,
                    line=1,
                    severity="error",
                    message=f"缺少强类型 Schema 文件: {s_name} ({s_desc})",
                    suggestion=f"请补齐 {rel_path} 契约文件",
                ))
                continue

            try:
                content = s_path.read_text(encoding="utf-8")
                if len(content.strip()) == 0:
                    self.findings.append(AuditFinding(
                        rule_id="SDK-SCHEMA-ZERO-BYTE",
                        file_path=rel_path,
                        line=1,
                        severity="error",
                        message=f"Schema 文件为 0 字节空文件: {s_name}",
                        suggestion="请补充合法 JSON Schema 定义",
                    ))
                    continue
                parsed = json.loads(content)
                if not isinstance(parsed, dict):
                    self.findings.append(AuditFinding(
                        rule_id="SDK-SCHEMA-NOT-OBJECT",
                        file_path=rel_path,
                        line=1,
                        severity="error",
                        message=f"Schema 根节点必须为 JSON 对象: {s_name}",
                    ))
            except Exception as exc:
                self.findings.append(AuditFinding(
                    rule_id="SDK-SCHEMA-JSON-INVALID",
                    file_path=rel_path,
                    line=1,
                    severity="error",
                    message=f"Schema 文件 JSON 解析失败: {s_name} ({exc})",
                    suggestion="确保文件内容为标准 JSON 格式",
                ))

    def _check_single_tool_file(self, tools_dir: Path, t_name: str, t_desc: str) -> None:
        """审计单个核心开发工具脚本的存在性与非空断言。"""
        t_path = tools_dir / t_name
        rel_path = f"WebGames/mod_sdk/tools/{t_name}"

        if not t_path.is_file():
            self.findings.append(AuditFinding(
                rule_id="SDK-TOOL-FILE-MISSING",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message=f"缺少核心开发工具脚本: {t_name} ({t_desc})",
                suggestion=f"请补齐 {rel_path} 工具脚本",
            ))
            return

        try:
            if t_path.stat().st_size == 0:
                self.findings.append(AuditFinding(
                    rule_id="SDK-TOOL-FILE-ZERO-BYTE",
                    file_path=rel_path,
                    line=1,
                    severity=SEVERITY_ERROR,
                    message=f"工具脚本体积为 0 字节空文件: {t_name}",
                ))
        except OSError as exc:
            self.findings.append(AuditFinding(
                rule_id=RULE_STAT_ERROR,
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message=f"无法读取工具脚本状态: {t_name} ({exc})",
            ))

    def _check_cli_subcommands(self, tools_dir: Path) -> None:
        """针对统一 CLI 入口 kalar_mod.py 进行子命令完整性静态断言。"""
        kalar_cli_path = tools_dir / "kalar_mod.py"
        if not kalar_cli_path.is_file():
            return
        cli_text = kalar_cli_path.read_text(encoding=UTF8)
        required_subcommands = ["init", "check", "cook", "preview", "play", "pack"]
        for subcmd in required_subcommands:
            if f'"{subcmd}"' not in cli_text and f"'{subcmd}'" not in cli_text:
                self.findings.append(AuditFinding(
                    rule_id="SDK-CLI-SUBCMD-MISSING",
                    file_path="WebGames/mod_sdk/tools/kalar_mod.py",
                    line=1,
                    severity=SEVERITY_ERROR,
                    message=f"统一 CLI 门面缺少必须的子命令支持: {subcmd}",
                    suggestion=f"确保 kalar_mod.py 支持 {required_subcommands} 全部六大核心子命令",
                ))

    def _check_tools_integrity(self) -> None:
        """审计 tools/ 目录及其统一 CLI 核心工具链的物理存在性与功能完备性。"""
        tools_dir = self.mod_sdk_dir / "tools"
        rel_dir = "WebGames/mod_sdk/tools"

        if not tools_dir.is_dir():
            self.findings.append(AuditFinding(
                rule_id="SDK-TOOLS-DIR-MISSING",
                file_path=rel_dir,
                line=1,
                severity=SEVERITY_ERROR,
                message="缺少开发工具目录 tools/",
                suggestion="确保 mod_sdk/tools/ 目录存在",
            ))
            return

        expected_tools = [
            ("kalar_mod.py", "统一模组命令行门面 (kalar-mod)"),
            ("scaffold_mod.py", "模组脚手架骨架生成器 (init)"),
            ("check_mod.py", "纯静态自愈诊断门禁 (check)"),
            ("cook_assets.py", "视听资产预编译与审计器 (cook)"),
            ("preview_mod.py", "无头拓扑与剧情演练器 (preview)"),
            ("play_mod.py", "交互式无头试玩推演内核 (play)"),
        ]

        for t_name, t_desc in expected_tools:
            self._check_single_tool_file(tools_dir, t_name, t_desc)
        self._check_cli_subcommands(tools_dir)

    def _check_templates_and_examples(self) -> None:
        """审计 templates/ 与 examples/ 官方脚手架与实战样例目录完整性。"""
        templates_dir = self.mod_sdk_dir / "templates"
        if not templates_dir.is_dir():
            self.findings.append(AuditFinding(
                rule_id="SDK-TEMPLATES-DIR-MISSING",
                file_path="WebGames/mod_sdk/templates",
                line=1,
                severity="error",
                message="缺少脚手架模板目录 templates/",
            ))
        else:
            required_templates = [
                ("starter_story", "Tier 1 纯逻辑与剧情命途初始工程骨架"),
                ("audio_visual_pack", "Tier 2 视听与艺术资产增强模板"),
                ("total_conversion_sample", "Tier 3 全局大魔改规则示例工程"),
            ]
            for t_dir_name, t_desc in required_templates:
                tpl_path = templates_dir / t_dir_name
                if not tpl_path.is_dir():
                    self.findings.append(AuditFinding(
                        rule_id="SDK-TEMPLATE-MISSING",
                        file_path=f"WebGames/mod_sdk/templates/{t_dir_name}",
                        line=1,
                        severity="error",
                        message=f"缺少标准分级工程模板: {t_dir_name} ({t_desc})",
                    ))

        examples_dir = self.mod_sdk_dir / "examples"
        if not examples_dir.is_dir():
            self.findings.append(AuditFinding(
                rule_id="SDK-EXAMPLES-DIR-MISSING",
                file_path="WebGames/mod_sdk/examples",
                line=1,
                severity="error",
                message="缺少实战样例目录 examples/",
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

    def _check_cap_races(self, data: Dict[str, Any], rel_path: str) -> None:
        """校验 supported_races 列表与基础种族。"""
        races = data.get("supported_races")
        if not isinstance(races, list) or len(races) == 0:
            self.findings.append(AuditFinding(
                rule_id="SDK-RACES-EMPTY",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message="capabilities.json 缺少有效的 supported_races 列表",
                suggestion="supported_races 必须为包含至少 1 个已启用种族的列表",
            ))
            return
        if "HUMAN" not in races:
            self.findings.append(AuditFinding(
                rule_id="SDK-RACES-HUMAN-MISSING",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message="supported_races 中缺少基础种族 HUMAN",
                suggestion="确保 core.json 中的 HUMAN 处于启用状态",
            ))

    def _check_cap_node_types(self, data: Dict[str, Any], rel_path: str) -> None:
        """校验 valid_node_types 是否包含四大标准拓扑节点。"""
        expected_node_types = {"START_ENTRY", "STANDARD_STEP", "BRANCH_CHOICE", "TERMINAL_EXIT"}
        node_types = set(data.get("valid_node_types", []))
        missing_nodes = expected_node_types - node_types
        if missing_nodes:
            self.findings.append(AuditFinding(
                rule_id="SDK-NODE-TYPES-INCOMPLETE",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message=f"valid_node_types 缺少必需节点类型: {sorted(list(missing_nodes))}",
                suggestion="DAG 节点类型必须包含四类标准拓扑节点",
            ))

    def _check_cap_placeholders(self, data: Dict[str, Any], rel_path: str) -> None:
        """校验 available_placeholders 核心占位符。"""
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
                severity=SEVERITY_ERROR,
                message=f"available_placeholders 缺少核心占位符: {sorted(list(missing_ph))}",
                suggestion="必须补齐剧情与创角核心占位符字典",
            ))

    def _check_cap_mutations(self, data: Dict[str, Any], rel_path: str) -> None:
        """校验 valid_mutation_events 状态突变事件。"""
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
                severity=SEVERITY_ERROR,
                message=f"valid_mutation_events 缺少核心状态突变事件: {sorted(list(missing_mut))}",
                suggestion="确保包含 CharacterCreated, LocationAssigned 等五项标准突变事件",
            ))

    def _check_cap_destiny(self, data: Dict[str, Any], rel_path: str) -> None:
        """校验 destiny_mod_capabilities 命途契约能力描述。"""
        destiny_caps = data.get("destiny_mod_capabilities", {})
        if not isinstance(destiny_caps, dict) or not destiny_caps.get("attribute_keys"):
            self.findings.append(AuditFinding(
                rule_id="SDK-DESTINY-CAPS-MISSING",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message="capabilities.json 缺少有效的 destiny_mod_capabilities 命途契约能力描述",
            ))

    def _check_capabilities_schema(self) -> None:
        """审计 capabilities.json 的结构字段完整性与必要枚举语义。"""
        cap_path = self.mod_sdk_dir / "capabilities.json"
        rel_path = "WebGames/mod_sdk/capabilities.json"
        if not cap_path.is_file():
            return

        try:
            data = json.loads(cap_path.read_text(encoding=UTF8))
        except Exception as exc:
            self.findings.append(AuditFinding(
                rule_id="SDK-JSON-INVALID",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message=f"capabilities.json 解析 JSON 语法失败: {exc}",
                suggestion="确保文件内容为合法 JSON 且无乱码",
            ))
            return

        self._check_cap_races(data, rel_path)
        self._check_cap_node_types(data, rel_path)
        self._check_cap_placeholders(data, rel_path)
        self._check_cap_mutations(data, rel_path)
        self._check_cap_destiny(data, rel_path)

    def _check_spec_guidance_structure(self) -> None:
        """审计 MOD_SPEC.md 核心章节、动态标记与 Tier 分级指引完整度。"""
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
            ("docs/SPECIFICATION.md", "全景规范重定向导航指针"),
            ("Tier 1", "Tier 1 纯逻辑分级说明"),
            ("Tier 2", "Tier 2 视听增强分级说明"),
            ("Tier 3", "Tier 3 全局大魔改分级说明"),
        ]

        for marker, desc in required_markers:
            if marker not in text:
                self.findings.append(AuditFinding(
                    rule_id="SDK-SPEC-SECTION-MISSING",
                    file_path=rel_path,
                    line=1,
                    severity="error",
                    message=f"MOD_SPEC.md 缺少必要结构或标记: {marker} ({desc})",
                    suggestion="请核对规范文档结构或运行 sync_mod_sdk.py 重新渲染",
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
    print("【MOD SDK 契约防漂移与全量资产完整性门禁审计】")
    print(f"扫描目录: {auditor.mod_sdk_dir}")
    print("=" * 70)

    if passed:
        print("\n✅ [AUDIT SUCCESS] MOD SDK 契约与引擎真源保持 100% 深度对齐，全量资产完整无漂移。")
        print("  - capabilities.json 结构与必要枚举语义校验通过")
        print("  - MOD_SPEC.md 契约指南章节完整且动态标记闭合 (含 Tier 1/2/3 与 docs/ 导航)")
        print("  - docs/ 权威规范库 (SPECIFICATION.md 等) 物理完整且非空")
        print("  - schemas/ 强类型契约字典 (全量 10 项 Schema) 物理完整且语法校验通过")
        print("  - tools/ 工具链 (kalar_mod.py 统一 CLI 等) 完备且子命令覆盖全面")
        print("  - templates/ 分级初始工程骨架物理完整")
        print("  - 磁盘文件与单一真源静态萃取结果完全一致 (0 漂移)")
        return 0

    print(f"\n❌ [AUDIT FAILED] 发现 {len(auditor.findings)} 项契约违规、资产缺失或漂移:")
    for idx, f in enumerate(auditor.findings, start=1):
        print(f"  {idx}. [{f.rule_id}] {f.file_path}: {f.message}")
        if f.suggestion:
            print(f"     👉 修复建议: {f.suggestion}")
    print("\n请修正后重新运行门禁审计。")
    return 1


if __name__ == "__main__":
    sys.exit(main())
