#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · MOD SDK 协议一致性规则)
# 文件路径: WebGames/scripts/py/lib/audit_sdk_protocol_rules.py
# 架构定位: MOD SDK 协议信封跨端一致性断言规则库 (MOD SDK Protocol Parity Rules)
# 依赖与触发: 触发方: audit_sdk_sync.py | 上游: mod_sdk/** & backend/**/dto/** | 下游: AuditFinding 列表 | 运行时: Python 3.10+
# 职责说明: 校验跨端服务端响应与客户端请求信封 DTO (GDScript) 与 SDK 客户端及 Schema 的字段一致性
# 退出语义与设计依据: 规则库模块，无进程退出码 | 设计依据: 《卡拉尔数据契约规范 v1.0》统一通信协议规范
# ------------------------------------------------------------------------------
# 用法示例:
#   from lib.audit_sdk_protocol_rules import check_protocol_envelope_parity
# ==============================================================================
"""MOD SDK 跨端统一请求/响应信封一致性契约断言实现。"""

from __future__ import annotations
from pathlib import Path
from typing import Any
import json
import re

from lib.audit_sdk_rules import AuditFinding

SEVERITY_ERROR = "error"
UTF8 = "utf-8"


def _check_response_envelope_parity(
    mod_sdk_dir: Path, root: Path, findings: list[AuditFinding]
) -> None:
  """审查服务端响应信封 DTO 与 SDK 客户端 allowed_keys 及 Schema properties 一致性。"""
  resp_dto_path = root / "backend" / "domains" / "world_state" / "dto" / "unified_response_envelope_dto.gd"
  if not resp_dto_path.is_file():
    return

  text = resp_dto_path.read_text(encoding=UTF8)
  m_to_dto = re.search(r"func to_dto\(\)\s*->\s*Dictionary:\s*return\s*\{(.*?)\}", text, re.DOTALL)
  if not m_to_dto:
    return

  dto_keys = set(re.findall(r'"([a-zA-Z0-9_]+)":', m_to_dto.group(1)))

  # 1. 比对 tools/kalar_protocol_client.py
  client_path = mod_sdk_dir / "tools" / "kalar_protocol_client.py"
  if client_path.is_file():
    c_text = client_path.read_text(encoding=UTF8)
    m_func = re.search(r"def validate_unified_response_envelope\b.*?:(.*?)(?=\n(?:def |class )|\Z)", c_text, re.DOTALL)
    if m_func:
      m_allowed = re.search(r"allowed_keys\s*=\s*\{(.*?)\}", m_func.group(1), re.DOTALL)
      if m_allowed:
        client_keys = set(re.findall(r'"([a-zA-Z0-9_]+)"', m_allowed.group(1)))
        missing_in_client = sorted(dto_keys - client_keys)
        if missing_in_client:
          findings.append(
            AuditFinding(
              rule_id="SDK-PROTOCOL-CLIENT-DRIFT",
              file_path="WebGames/mod_sdk/tools/kalar_protocol_client.py",
              line=1,
              severity=SEVERITY_ERROR,
              message=f"kalar_protocol_client.py 响应白名单缺少服务端 DTO 字段: {missing_in_client}",
              suggestion="在 validate_unified_response_envelope 的 allowed_keys 中补充缺失字段",
            )
          )

  # 2. 比对 schemas/unified_response_envelope.schema.json
  schema_path = mod_sdk_dir / "schemas" / "unified_response_envelope.schema.json"
  if schema_path.is_file():
    try:
      s_data = json.loads(schema_path.read_text(encoding=UTF8))
      schema_keys = set(s_data.get("properties", {}).keys())
      missing_in_schema = sorted(dto_keys - schema_keys)
      if missing_in_schema:
        findings.append(
          AuditFinding(
            rule_id="SDK-PROTOCOL-SCHEMA-DRIFT",
            file_path="WebGames/mod_sdk/schemas/unified_response_envelope.schema.json",
            line=1,
            severity=SEVERITY_ERROR,
            message=f"unified_response_envelope.schema.json 缺少服务端 DTO 字段: {missing_in_schema}",
            suggestion="在 schema properties 中补充缺失字段",
          )
        )
    except Exception as exc:
      findings.append(
        AuditFinding(
          rule_id="SDK-PROTOCOL-SCHEMA-INVALID",
          file_path="WebGames/mod_sdk/schemas/unified_response_envelope.schema.json",
          line=1,
          severity=SEVERITY_ERROR,
          message=f"读取或解析 schema 失败: {exc}",
        )
      )


def _check_request_envelope_parity(
    mod_sdk_dir: Path, root: Path, findings: list[AuditFinding]
) -> None:
  """审查客户端请求信封 DTO 与 SDK 客户端 allowed_keys 及 Schema properties 一致性。"""
  req_dto_path = root / "backend" / "domains" / "world_state" / "dto" / "client_request_envelope_dto.gd"
  if not req_dto_path.is_file():
    return

  text = req_dto_path.read_text(encoding=UTF8)
  m_to_dto = re.search(r"func to_dto\(\)\s*->\s*Dictionary:\s*return\s*\{(.*?)\}", text, re.DOTALL)
  if not m_to_dto:
    return

  dto_keys = set(re.findall(r'"([a-zA-Z0-9_]+)":', m_to_dto.group(1)))

  # 1. 比对 tools/kalar_protocol_client.py
  client_path = mod_sdk_dir / "tools" / "kalar_protocol_client.py"
  if client_path.is_file():
    c_text = client_path.read_text(encoding=UTF8)
    m_func = re.search(r"def validate_client_request_envelope\b.*?:(.*?)(?=\n(?:def |class )|\Z)", c_text, re.DOTALL)
    if m_func:
      m_allowed = re.search(r"allowed_keys\s*=\s*\{(.*?)\}", m_func.group(1), re.DOTALL)
      if m_allowed:
        client_keys = set(re.findall(r'"([a-zA-Z0-9_]+)"', m_allowed.group(1)))
        missing_in_client = sorted(dto_keys - client_keys)
        if missing_in_client:
          findings.append(
            AuditFinding(
              rule_id="SDK-PROTOCOL-CLIENT-DRIFT",
              file_path="WebGames/mod_sdk/tools/kalar_protocol_client.py",
              line=1,
              severity=SEVERITY_ERROR,
              message=f"kalar_protocol_client.py 请求白名单缺少服务端 DTO 字段: {missing_in_client}",
              suggestion="在 validate_client_request_envelope 的 allowed_keys 中补充缺失字段",
            )
          )

  # 2. 比对 schemas/client_request_envelope.schema.json
  schema_path = mod_sdk_dir / "schemas" / "client_request_envelope.schema.json"
  if schema_path.is_file():
    try:
      s_data = json.loads(schema_path.read_text(encoding=UTF8))
      schema_keys = set(s_data.get("properties", {}).keys())
      missing_in_schema = sorted(dto_keys - schema_keys)
      if missing_in_schema:
        findings.append(
          AuditFinding(
            rule_id="SDK-PROTOCOL-SCHEMA-DRIFT",
            file_path="WebGames/mod_sdk/schemas/client_request_envelope.schema.json",
            line=1,
            severity=SEVERITY_ERROR,
            message=f"client_request_envelope.schema.json 缺少服务端 DTO 字段: {missing_in_schema}",
            suggestion="在 schema properties 中补充缺失字段",
          )
        )
    except Exception as exc:
      findings.append(
        AuditFinding(
          rule_id="SDK-PROTOCOL-SCHEMA-PARSE-ERR",
          file_path="WebGames/mod_sdk/schemas/client_request_envelope.schema.json",
          line=1,
          severity=SEVERITY_ERROR,
          message=f"解析 client_request_envelope.schema.json 异常: {exc}",
          suggestion="修复 Schema 文件 JSON 格式并确保 properties 节点合法",
        )
      )


def _check_esc_action_enum_parity(
    mod_sdk_dir: Path, findings: list[AuditFinding]
) -> None:
  """审查 esc_menu_action_payload.schema.json 与 capabilities.json ESC 指令枚举一致性。"""
  cap_path = mod_sdk_dir / "capabilities.json"
  schema_path = mod_sdk_dir / "schemas" / "esc_menu_action_payload.schema.json"
  if not cap_path.is_file() or not schema_path.is_file():
    return
  try:
    cap_data = json.loads(cap_path.read_text(encoding=UTF8))
    cap_actions = set(cap_data.get("unified_protocol_capabilities", {}).get("esc_menu_actions", []))
    s_data = json.loads(schema_path.read_text(encoding=UTF8))
    schema_actions = set(s_data.get("properties", {}).get("action_type", {}).get("enum", []))
    if cap_actions != schema_actions:
      findings.append(
        AuditFinding(
          rule_id="SDK-PROTOCOL-ESC-ENUM-DRIFT",
          file_path="WebGames/mod_sdk/schemas/esc_menu_action_payload.schema.json",
          line=10,
          severity=SEVERITY_ERROR,
          message=f"ESC 菜单动作枚举与 capabilities.json 不一致: schema={sorted(schema_actions)} vs cap={sorted(cap_actions)}",
          suggestion="使 esc_menu_action_payload.schema.json 的 action_type.enum 与 capabilities.json 保持一致",
        )
      )
  except (OSError, ValueError) as exc:
    findings.append(
      AuditFinding(
        rule_id="SDK-PROTOCOL-SCHEMA-INVALID",
        file_path="WebGames/mod_sdk/schemas/esc_menu_action_payload.schema.json",
        line=1,
        severity=SEVERITY_ERROR,
        message=f"读取或解析 esc_menu_action_payload.schema.json 失败: {exc}",
      )
    )


def check_protocol_envelope_parity(
    mod_sdk_dir: Path, root: Path, findings: list[AuditFinding]
) -> None:
  """审计跨端统一请求/响应信封 DTO (GDScript) 与 SDK 客户端及 Schema 的字段一致性 (SDK-PROTOCOL-PARITY)。"""
  _check_response_envelope_parity(mod_sdk_dir, root, findings)
  _check_request_envelope_parity(mod_sdk_dir, root, findings)
  _check_esc_action_enum_parity(mod_sdk_dir, findings)
