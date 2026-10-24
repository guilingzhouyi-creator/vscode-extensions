#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · MOD SDK 门禁规则集)
# 文件路径: WebGames/scripts/py/lib/audit_sdk_rules.py
# 架构定位: MOD SDK 资产完整性与静态模式断言规则库 (MOD SDK Integrity Rules)
# 依赖与触发: 触发方: audit_sdk_sync.py | 上游: mod_sdk/** | 下游: AuditFinding 列表 | 运行时: Python 3.10+
# 职责说明: 提供 MOD SDK 核心元数据、docs 文档库、schemas 强类型契约、tools 工具链与 capabilities 结构校验断言
# 退出语义与设计依据: 规则库模块，无进程退出码 | 设计依据: 《卡拉尔数据契约规范 v1.0》与第一性原理
# ------------------------------------------------------------------------------
# 用法示例:
#   from lib.audit_sdk_rules import check_root_metadata_files, check_schemas_integrity
# ==============================================================================
"""MOD SDK 门禁审计各个维度的规则断言实现。"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SEVERITY_ERROR = "error"
RULE_STAT_ERROR = "SDK-STAT-ERROR"
UTF8 = "utf-8"


@dataclass(slots=True)
class AuditFinding:
    """门禁审计发现问题载荷。"""

    rule_id: str
    file_path: str
    line: int
    severity: str
    message: str
    suggestion: str = ""


def check_root_metadata_files(mod_sdk_dir: Path, findings: list[AuditFinding]) -> None:
    """审计根目录核心元数据文件的物理存在性与非空断言。"""
    required_files = [
        ("capabilities.json", "MOD 能力清单单一真源文件"),
        ("MOD_SPEC.md", "MOD 创作者核心契约速查指南"),
        ("README.md", "MOD SDK 架构与开发者套件总览"),
    ]

    for filename, desc in required_files:
        file_path = mod_sdk_dir / filename
        rel_path = f"WebGames/mod_sdk/{filename}"

        if not file_path.is_file():
            findings.append(
                AuditFinding(
                    rule_id="SDK-PHYSICAL-MISSING",
                    file_path=rel_path,
                    line=1,
                    severity="error",
                    message=f"缺失核心 SDK 根目录元数据文件: {filename} ({desc})",
                    suggestion="请运行 python WebGames/scripts/py/sync_mod_sdk.py 重新生成该文件",
                )
            )
            continue

        try:
            if file_path.stat().st_size == 0:
                findings.append(
                    AuditFinding(
                        rule_id="SDK-FILE-ZERO-BYTE",
                        file_path=rel_path,
                        line=1,
                        severity="error",
                        message=f"文件体积为 0 字节空文件: {filename}",
                        suggestion="严禁遗留空文件，请重新生成或补全内容",
                    )
                )
        except OSError as exc:
            findings.append(
                AuditFinding(
                    rule_id="SDK-STAT-ERROR",
                    file_path=rel_path,
                    line=1,
                    severity="error",
                    message=f"无法读取文件状态: {filename} ({exc})",
                )
            )


def check_docs_integrity(mod_sdk_dir: Path, findings: list[AuditFinding]) -> None:
    """审计 docs/ 目录及其关键规范文档资产的物理存在性与非空断言。"""
    docs_dir = mod_sdk_dir / "docs"
    rel_dir = "WebGames/mod_sdk/docs"

    if not docs_dir.is_dir():
        findings.append(
            AuditFinding(
                rule_id="SDK-DOCS-DIR-MISSING",
                file_path=rel_dir,
                line=1,
                severity="error",
                message="缺少权威规范文档目录 docs/",
                suggestion="确保 mod_sdk/docs/ 目录存在并包含全量规范手册",
            )
        )
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
            findings.append(
                AuditFinding(
                    rule_id="SDK-DOC-FILE-MISSING",
                    file_path=rel_path,
                    line=1,
                    severity="error",
                    message=f"缺少官方规范文档: {doc_name} ({doc_desc})",
                    suggestion=f"请补齐 {rel_path} 规范文档",
                )
            )
            continue

        try:
            if doc_path.stat().st_size == 0:
                findings.append(
                    AuditFinding(
                        rule_id="SDK-DOC-FILE-ZERO-BYTE",
                        file_path=rel_path,
                        line=1,
                        severity="error",
                        message=f"规范文档体积为 0 字节空文件: {doc_name}",
                        suggestion="严禁遗留空文档，请补充规范正文",
                    )
                )
        except OSError as exc:
            findings.append(
                AuditFinding(
                    rule_id="SDK-STAT-ERROR",
                    file_path=rel_path,
                    line=1,
                    severity="error",
                    message=f"无法读取文档状态: {doc_name} ({exc})",
                )
            )


def check_schemas_integrity(mod_sdk_dir: Path, findings: list[AuditFinding]) -> None:
    """审计 schemas/ 目录及其全量 JSON Schema 强类型字典的物理存在性与语法有效性。"""
    schemas_dir = mod_sdk_dir / "schemas"
    rel_dir = "WebGames/mod_sdk/schemas"

    if not schemas_dir.is_dir():
        findings.append(
            AuditFinding(
                rule_id="SDK-SCHEMAS-DIR-MISSING",
                file_path=rel_dir,
                line=1,
                severity="error",
                message="缺少强类型契约字典目录 schemas/",
                suggestion="确保 mod_sdk/schemas/ 目录存在并包含全量 JSON Schema",
            )
        )
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
        ("agent_hud_telemetry_packet.schema.json", "主页 HUD 原子遥测包 Schema"),
        ("agent_action_packet.schema.json", "专属动作通道上行指令包 Schema"),
        ("client_request_envelope.schema.json", "全域通用客户端请求信封 Schema"),
        ("unified_response_envelope.schema.json", "全域统一服务端响应信封 Schema"),
        ("esc_menu_action_payload.schema.json", "ESC 系统菜单指令载荷强类型 Schema"),
    ]

    for s_name, s_desc in expected_schemas:
        s_path = schemas_dir / s_name
        rel_path = f"WebGames/mod_sdk/schemas/{s_name}"

        if not s_path.is_file():
            findings.append(
                AuditFinding(
                    rule_id="SDK-SCHEMA-MISSING",
                    file_path=rel_path,
                    line=1,
                    severity="error",
                    message=f"缺少强类型 Schema 文件: {s_name} ({s_desc})",
                    suggestion=f"请补齐 {rel_path} 契约文件",
                )
            )
            continue

        try:
            content = s_path.read_text(encoding="utf-8")
            if len(content.strip()) == 0:
                findings.append(
                    AuditFinding(
                        rule_id="SDK-SCHEMA-ZERO-BYTE",
                        file_path=rel_path,
                        line=1,
                        severity="error",
                        message=f"Schema 文件为 0 字节空文件: {s_name}",
                        suggestion="请补充合法 JSON Schema 定义",
                    )
                )
                continue
            parsed = json.loads(content)
            if not isinstance(parsed, dict):
                findings.append(
                    AuditFinding(
                        rule_id="SDK-SCHEMA-NOT-OBJECT",
                        file_path=rel_path,
                        line=1,
                        severity="error",
                        message=f"Schema 根节点必须为 JSON 对象: {s_name}",
                    )
                )
        except Exception as exc:
            findings.append(
                AuditFinding(
                    rule_id="SDK-SCHEMA-JSON-INVALID",
                    file_path=rel_path,
                    line=1,
                    severity="error",
                    message=f"Schema 文件 JSON 解析失败: {s_name} ({exc})",
                    suggestion="确保文件内容为标准 JSON 格式",
                )
            )


def check_tools_integrity(mod_sdk_dir: Path, findings: list[AuditFinding]) -> None:
    """审计 tools/ 目录及其统一 CLI 核心工具链的物理存在性与功能完备性。"""
    tools_dir = mod_sdk_dir / "tools"
    rel_dir = "WebGames/mod_sdk/tools"

    if not tools_dir.is_dir():
        findings.append(
            AuditFinding(
                rule_id="SDK-TOOLS-DIR-MISSING",
                file_path=rel_dir,
                line=1,
                severity=SEVERITY_ERROR,
                message="缺少开发工具目录 tools/",
                suggestion="确保 mod_sdk/tools/ 目录存在",
            )
        )
        return

    expected_tools = [
        ("kalar_mod.py", "统一模组命令行门面 (kalar-mod)"),
        ("scaffold_mod.py", "模组脚手架骨架生成器 (init)"),
        ("check_mod.py", "纯静态自愈诊断门禁 (check)"),
        ("cook_assets.py", "视听资产预编译与审计器 (cook)"),
        ("preview_mod.py", "无头拓扑与剧情演练器 (preview)"),
        ("play_mod.py", "交互式无头试玩推演内核 (play)"),
        (
            "kalar_protocol_client.py",
            "统一通信协议客户端与本地模拟派发引擎 (dispatch)",
        ),
    ]

    for t_name, t_desc in expected_tools:
        t_path = tools_dir / t_name
        rel_path = f"WebGames/mod_sdk/tools/{t_name}"

        if not t_path.is_file():
            findings.append(
                AuditFinding(
                    rule_id="SDK-TOOL-FILE-MISSING",
                    file_path=rel_path,
                    line=1,
                    severity=SEVERITY_ERROR,
                    message=f"缺少核心开发工具脚本: {t_name} ({t_desc})",
                    suggestion=f"请补齐 {rel_path} 工具脚本",
                )
            )
            continue

        try:
            if t_path.stat().st_size == 0:
                findings.append(
                    AuditFinding(
                        rule_id="SDK-TOOL-FILE-ZERO-BYTE",
                        file_path=rel_path,
                        line=1,
                        severity=SEVERITY_ERROR,
                        message=f"工具脚本体积为 0 字节空文件: {t_name}",
                    )
                )
        except OSError as exc:
            findings.append(
                AuditFinding(
                    rule_id=RULE_STAT_ERROR,
                    file_path=rel_path,
                    line=1,
                    severity=SEVERITY_ERROR,
                    message=f"无法读取工具脚本状态: {t_name} ({exc})",
                )
            )

    kalar_cli_path = tools_dir / "kalar_mod.py"
    if kalar_cli_path.is_file():
        cli_text = kalar_cli_path.read_text(encoding=UTF8)
        required_subcommands = [
            "init",
            "check",
            "cook",
            "preview",
            "play",
            "pack",
            "dispatch",
        ]
        for subcmd in required_subcommands:
            if f'"{subcmd}"' not in cli_text and f"'{subcmd}'" not in cli_text:
                findings.append(
                    AuditFinding(
                        rule_id="SDK-CLI-SUBCMD-MISSING",
                        file_path="WebGames/mod_sdk/tools/kalar_mod.py",
                        line=1,
                        severity=SEVERITY_ERROR,
                        message=f"统一 CLI 门面缺少必须的子命令支持: {subcmd}",
                        suggestion=f"确保 kalar_mod.py 支持 {required_subcommands} 全部七大核心子命令",
                    )
                )


def check_templates_and_examples(mod_sdk_dir: Path, findings: list[AuditFinding]) -> None:
    """审计 templates/ 与 examples/ 官方脚手架与实战样例目录完整性。"""
    templates_dir = mod_sdk_dir / "templates"
    if not templates_dir.is_dir():
        findings.append(
            AuditFinding(
                rule_id="SDK-TEMPLATES-DIR-MISSING",
                file_path="WebGames/mod_sdk/templates",
                line=1,
                severity="error",
                message="缺少脚手架模板目录 templates/",
            )
        )
    else:
        required_templates = [
            ("starter_story", "Tier 1 纯逻辑与剧情命途初始工程骨架"),
            ("audio_visual_pack", "Tier 2 视听与艺术资产增强模板"),
            ("total_conversion_sample", "Tier 3 全局大魔改规则示例工程"),
        ]
        for t_dir_name, t_desc in required_templates:
            tpl_path = templates_dir / t_dir_name
            if not tpl_path.is_dir():
                findings.append(
                    AuditFinding(
                        rule_id="SDK-TEMPLATE-MISSING",
                        file_path=f"WebGames/mod_sdk/templates/{t_dir_name}",
                        line=1,
                        severity="error",
                        message=f"缺少标准分级工程模板: {t_dir_name} ({t_desc})",
                    )
                )

    examples_dir = mod_sdk_dir / "examples"
    if not examples_dir.is_dir():
        findings.append(
            AuditFinding(
                rule_id="SDK-EXAMPLES-DIR-MISSING",
                file_path="WebGames/mod_sdk/examples",
                line=1,
                severity="error",
                message="缺少实战样例目录 examples/",
            )
        )


def check_capabilities_schema(mod_sdk_dir: Path, findings: list[AuditFinding]) -> None:
    """审计 capabilities.json 的结构字段完整性与必要枚举语义。"""
    cap_path = mod_sdk_dir / "capabilities.json"
    rel_path = "WebGames/mod_sdk/capabilities.json"
    if not cap_path.is_file():
        return

    try:
        data = json.loads(cap_path.read_text(encoding=UTF8))
    except Exception as exc:
        findings.append(
            AuditFinding(
                rule_id="SDK-JSON-INVALID",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message=f"capabilities.json 解析 JSON 语法失败: {exc}",
                suggestion="确保文件内容为合法 JSON 且无乱码",
            )
        )
        return

    _check_cap_races(data, rel_path, findings)
    _check_cap_node_types(data, rel_path, findings)
    _check_cap_placeholders(data, rel_path, findings)
    _check_cap_mutations(data, rel_path, findings)
    _check_cap_destiny(data, rel_path, findings)
    _check_cap_telemetry(data, rel_path, findings)
    _check_cap_protocol(data, rel_path, findings)


def _check_cap_races(
    data: dict[str, Any], rel_path: str, findings: list[AuditFinding]
) -> None:
    races = data.get("supported_races")
    if not isinstance(races, list) or len(races) == 0:
        findings.append(
            AuditFinding(
                rule_id="SDK-RACES-EMPTY",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message="capabilities.json 缺少有效的 supported_races 列表",
            )
        )
        return
    if "HUMAN" not in races:
        findings.append(
            AuditFinding(
                rule_id="SDK-RACES-HUMAN-MISSING",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message="supported_races 中缺少基础种族 HUMAN",
            )
        )


def _check_cap_node_types(
    data: dict[str, Any], rel_path: str, findings: list[AuditFinding]
) -> None:
    expected_node_types = {
        "START_ENTRY",
        "STANDARD_STEP",
        "BRANCH_CHOICE",
        "TERMINAL_EXIT",
    }
    node_types = set(data.get("valid_node_types", []))
    missing = expected_node_types - node_types
    if missing:
        findings.append(
            AuditFinding(
                rule_id="SDK-NODE-TYPES-INCOMPLETE",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message=f"valid_node_types 缺少必需节点类型: {sorted(list(missing))}",
            )
        )


def _check_cap_placeholders(
    data: dict[str, Any], rel_path: str, findings: list[AuditFinding]
) -> None:
    expected_placeholders = {
        "{PLAYER_NAME}",
        "{RACE_ID}",
        "{START_LOCATION}",
        "{INITIAL_EQUIPMENT}",
        "{NPC_TARGET}",
    }
    placeholders = set(data.get("available_placeholders", {}).keys())
    missing = expected_placeholders - placeholders
    if missing:
        findings.append(
            AuditFinding(
                rule_id="SDK-PLACEHOLDER-MISSING",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message=f"available_placeholders 缺少核心占位符: {sorted(list(missing))}",
            )
        )


def _check_cap_mutations(
    data: dict[str, Any], rel_path: str, findings: list[AuditFinding]
) -> None:
    expected_mutations = {
        "CharacterCreated",
        "LocationAssigned",
        "EquipmentGranted",
        "DialogueReady",
        "PrologueCompleted",
    }
    mutations = set(data.get("valid_mutation_events", []))
    missing = expected_mutations - mutations
    if missing:
        findings.append(
            AuditFinding(
                rule_id="SDK-MUTATION-MISSING",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message=f"valid_mutation_events 缺少核心状态突变事件: {sorted(list(missing))}",
            )
        )


def _check_cap_destiny(
    data: dict[str, Any], rel_path: str, findings: list[AuditFinding]
) -> None:
    destiny_caps = data.get("destiny_mod_capabilities", {})
    if not isinstance(destiny_caps, dict) or not destiny_caps.get("attribute_keys"):
        findings.append(
            AuditFinding(
                rule_id="SDK-DESTINY-CAPS-MISSING",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message="capabilities.json 缺少有效的 destiny_mod_capabilities 命途契约能力描述",
            )
        )


def _check_cap_telemetry(
    data: dict[str, Any], rel_path: str, findings: list[AuditFinding]
) -> None:
    telemetry = data.get("agent_hud_telemetry_capabilities")
    if not isinstance(telemetry, dict) or not telemetry:
        findings.append(
            AuditFinding(
                rule_id="SDK-TELEMETRY-MISSING",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message="capabilities.json 缺少有效的 agent_hud_telemetry_capabilities 节点",
            )
        )
        return
    directives = telemetry.get("supported_directives")
    if not isinstance(directives, list) or len(directives) == 0:
        findings.append(
            AuditFinding(
                rule_id="SDK-DIRECTIVES-EMPTY",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message="agent_hud_telemetry_capabilities 缺少 supported_directives 列表",
            )
        )
        return
    expected_dirs = {
        "ALLOCATE_POTENTIAL_STAT",
        "REST_AND_ADVANCE_TIME",
        "CLAIM_QUEST_OBJECTIVE",
    }
    if not expected_dirs.issubset(set(directives)):
        findings.append(
            AuditFinding(
                rule_id="SDK-DIRECTIVES-INCOMPLETE",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message=f"supported_directives 缺少核心指令: {sorted(list(expected_dirs - set(directives)))}",
            )
        )


def _check_cap_protocol(
    data: dict[str, Any], rel_path: str, findings: list[AuditFinding]
) -> None:
    proto = data.get("unified_protocol_capabilities")
    if not isinstance(proto, dict) or not proto:
        findings.append(
            AuditFinding(
                rule_id="SDK-PROTOCOL-CAPS-MISSING",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message="capabilities.json 缺少有效的 unified_protocol_capabilities 节点",
            )
        )
        return
    if proto.get("human_preemption_lease_ms") != 3000:
        findings.append(
            AuditFinding(
                rule_id="SDK-LEASE-MISMATCH",
                file_path=rel_path,
                line=1,
                severity=SEVERITY_ERROR,
                message=f"human_preemption_lease_ms 未对齐单一真源 3000ms: {proto.get('human_preemption_lease_ms')}",
            )
        )


def check_spec_guidance_structure(mod_sdk_dir: Path, findings: list[AuditFinding]) -> None:
    """审计 MOD_SPEC.md 核心章节、动态标记与 Tier 分级指引完整度。"""
    spec_path = mod_sdk_dir / "MOD_SPEC.md"
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
            findings.append(
                AuditFinding(
                    rule_id="SDK-SPEC-SECTION-MISSING",
                    file_path=rel_path,
                    line=1,
                    severity="error",
                    message=f"MOD_SPEC.md 缺少必要结构或标记: {marker} ({desc})",
                    suggestion="请核对规范文档结构或运行 sync_mod_sdk.py 重新渲染",
                )
            )
