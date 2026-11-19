#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 事件通道门禁)
# 文件路径: WebGames/scripts/py/audit_event_channels.py
# 架构定位: 事件总线拓扑分析器 (EventBus Topology Analyzer)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: backend/ | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 静态提取全库事件发布与订阅信道，验证信道合法性并拦截跨域非法直接投递
# 退出语义与设计依据: 退出码: 0=合规, 1=存在通道违规 | 设计依据: 前端可视化边界契约
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_event_channels.py
#   python scripts/py/audit_event_channels.py --json
# ==============================================================================
from pathlib import Path
from typing import Any
import argparse
import json
import re
import sys

from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

"""audit_event_channels.py — EventBus 频道纪律与叙事契约严格审查。

校验频道命名合规、叙事键对齐、注册表与常量对齐、广播载荷契约。"""

ROOT = resolve_repo_root()
CONFIG = ROOT / "config"
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
CODE_SCAN_ROOTS = (BACKEND, FRONTEND)

CHANNEL_RE = re.compile(r"^([a-z][a-z0-9_]*)\.([a-z0-9_]+(?:\.[a-z0-9_]+)*)$")
CONST_RE = re.compile(r"const\s+([A-Z0-9_]+)\s*:\s*int\s*=\s*(0x[0-9A-Fa-f]+|\d+)")

SEV_WARN = "WARN"
SEV_ERROR = "ERROR"


def get_full_channel_name(ch: dict) -> str:
    """格式化标准频道全名 (<domain_id>.<event_name>)。"""
    return f"{ch['domain']}.{ch['event_name']}"


def load_json(rel: str) -> dict:
    """安全读取相对 CONFIG 路径的 JSON 文件为字典对象。"""
    try:
        data = json.loads((CONFIG / rel).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def collect_domain_mapping() -> dict[str, dict]:
    """id -> {config_table, narrative_table}；缺失时回退 narratives.<id>。"""
    out: dict[str, dict] = {}
    data = load_json("infrastructure/domains.json")
    for e in data.get("domains", []):
        if not isinstance(e, dict):
            continue
        rid = str(e.get("id", ""))
        if not rid:
            continue
        out[rid] = {
            "config": str(e.get("config", "domains." + rid)),
            "narrative": str(e.get("narrative", "narratives." + rid)),
        }
    return out


def collect_allowed_channel_namespaces(domain_map: dict[str, dict]) -> set[str]:
    """合法频道前缀全集：domains.json 领域 + event_bus_config 声明基础设施与别名命名空间。"""
    allowed: set[str] = set(domain_map.keys())
    bus_data = load_json("infrastructure/event_bus_config.json")
    aliases = bus_data.get("channel_namespace_aliases", {})
    if isinstance(aliases, dict):
        for prefix in aliases.keys():
            if prefix:
                allowed.add(str(prefix))
    return allowed


def _walk_string_values(o: Any, out: list[str]) -> None:
    """递归提取嵌套字典与列表中的所有字符串字面量。"""
    if isinstance(o, dict):
        for v in o.values():
            _walk_string_values(v, out)
    elif isinstance(o, list):
        for v in o:
            _walk_string_values(v, out)
    elif isinstance(o, str):
        out.append(o)


def _extract_channel_candidates(data: dict, subkey: str | None) -> list[str]:
    """从单个数据对象中按 subkey 提取频道候选字符串。"""
    candidates: list[str] = []
    if subkey is None:
        for entry in data.get("channel_registry", []):
            if isinstance(entry, dict) and entry.get("channel_name"):
                candidates.append(str(entry["channel_name"]))
        return candidates

    node: Any = data
    for part in subkey.split("/"):
        if not isinstance(node, dict) or part not in node:
            return candidates
        node = node[part]
    _walk_string_values(node, candidates)
    return candidates


def _collect_protocol_flow_channels(node: Any, out: list[str]) -> None:
    """递归提取 contracts.json protocol_flows 中所有 event_channels 列表项。"""
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "event_channels" and isinstance(value, list):
                for item in value:
                    out.append(str(item))
            else:
                _collect_protocol_flow_channels(value, out)
    elif isinstance(node, list):
        for item in node:
            _collect_protocol_flow_channels(item, out)


def _iter_gd_texts() -> list[tuple[Path, str]]:
    """读取 backend 与 frontend 全域 .gd 脚本文本。"""
    items: list[tuple[Path, str]] = []
    for scan_root in CODE_SCAN_ROOTS:
        if not scan_root.exists():
            continue
        for file_path in sorted(scan_root.rglob("*.gd")):
            try:
                items.append((file_path, file_path.read_text(encoding="utf-8")))
            except UnicodeDecodeError:
                continue
    return items


def _extract_local_string_consts(text: str) -> dict[str, str]:
    """提取单文件顶部或类内声明的局部频道字符串常量。"""
    const_map: dict[str, str] = {}
    str_const_re = re.compile(r'^\s*const\s+([A-Z0-9_]+)\s*:\s*String\s*=\s*"([a-z0-9_.]+)"', re.M)
    for match in str_const_re.finditer(text):
        const_map[match.group(1)] = match.group(2)
    return const_map


def collect_config_channels() -> list[dict]:
    """全量扫描频道声明源契约（领域配置/总线注册表/前端桥接白名单/协议契约流）。"""
    account_path = CONFIG / "domains" / "account" / "core.json"
    world_state_path = CONFIG / "domains" / "world_state" / "core.json"
    bus_config_path = CONFIG / "infrastructure" / "event_bus_config.json"
    bridge_path = CONFIG / "frontend" / "views" / "hud_event_bridge.json"
    contracts_path = CONFIG / "infrastructure" / "contracts.json"

    sources: list[tuple[Path, str | None]] = [
        (account_path, "auth/channels"),
        (world_state_path, "hud/channels"),
        (bus_config_path, None),
    ]
    channels: list[dict] = []

    def _append_candidates(src_path: Path, raw_candidates: list[str]) -> None:
        rel_src = str(src_path.relative_to(CONFIG))
        for raw in raw_candidates:
            m = CHANNEL_RE.match(raw.strip())
            if m:
                channels.append(
                    {
                        "domain": m.group(1),
                        "event_name": m.group(2),
                        "source": rel_src,
                        "from_config": True,
                    }
                )

    for path, subkey in sources:
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        _append_candidates(path, _extract_channel_candidates(data, subkey))

    if bridge_path.exists():
        try:
            bridge_data = json.loads(bridge_path.read_text(encoding="utf-8"))
            bridge_candidates = [
                str(entry.get("channel", ""))
                for entry in bridge_data.get("subscribed_channels", [])
                if isinstance(entry, dict) and entry.get("channel")
            ]
            _append_candidates(bridge_path, bridge_candidates)
        except Exception:
            pass

    if contracts_path.exists():
        try:
            contracts_data = json.loads(contracts_path.read_text(encoding="utf-8"))
            flow_candidates: list[str] = []
            _collect_protocol_flow_channels(contracts_data.get("protocol_flows", {}), flow_candidates)
            _append_candidates(contracts_path, flow_candidates)
        except Exception:
            pass

    return channels


def collect_channel_registry() -> tuple[dict[int, dict], list[int]]:
    """channel_registry: id -> {name, channel_name, category, narrative} 与重复 id 清单。"""
    out: dict[int, dict] = {}
    duplicates: list[int] = []
    data = load_json("infrastructure/event_bus_config.json")
    for entry in data.get("channel_registry", []):
        if not isinstance(entry, dict):
            continue
        cid = int(entry.get("id", 0))
        if cid in out:
            duplicates.append(cid)
        out[cid] = {
            "name": str(entry.get("name", "")),
            "channel_name": str(entry.get("channel_name", "")),
            "category": str(entry.get("category", "")),
            "narrative": bool(entry.get("narrative", True)),
        }
    return out, duplicates


def collect_code_channels() -> list[dict]:
    """扫描 backend 与 frontend .gd 中的 emit_domain_event/_notify_event 字面量及常量频道。"""
    channels: list[dict] = []
    call_arg_re = re.compile(r'(?:emit_domain_event|_notify_event)\(\s*(?:"([a-z0-9_.]+)"|([A-Z][A-Z0-9_]*))')
    for f, text in _iter_gd_texts():
        const_map = _extract_local_string_consts(text)
        for m in call_arg_re.finditer(text):
            raw = m.group(1) if m.group(1) else const_map.get(m.group(2), "")
            if not raw:
                continue
            cm = CHANNEL_RE.match(raw)
            if cm:
                channels.append(
                    {
                        "domain": cm.group(1),
                        "event_name": cm.group(2),
                        "source": str(f.relative_to(ROOT)),
                        "from_config": False,
                    }
                )
    return channels


def collect_channel_constants() -> dict[str, int]:
    """EventChannelDefinition 常量表：NAME -> 值。"""
    consts: dict[str, int] = {}
    f = BACKEND / "infrastructure" / "event_bus" / "event_channel_definition.gd"
    if f.exists():
        for m in CONST_RE.finditer(f.read_text(encoding="utf-8")):
            consts[m.group(1)] = int(m.group(2), 0)
    return consts


def collect_narrative_tables(domain_map: dict) -> dict[str, dict]:
    """narrative 表名 -> 键集（仅加载存在的表）。"""
    out: dict[str, dict] = {}
    for rid, meta in domain_map.items():
        table = meta["narrative"]
        if not table.startswith("narratives."):
            continue
        f = CONFIG / "narratives" / (table.split(".", 1)[1] + ".json")
        if f.exists():
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                out[table] = data if isinstance(data, dict) else {}
            except Exception:
                out[table] = {}
    return out


def check_payload_contract(registry: dict[int, dict]) -> list[dict]:
    """R4（WARN）：emit_domain_event/_notify_event 字面量载荷缺失 category_key/args 扫描。"""
    structured_only_channels: set[str] = {
        entry["channel_name"]
        for entry in registry.values()
        if entry.get("channel_name") and not entry.get("narrative", True)
    }
    findings: list[dict] = []
    call_re = re.compile(r'(?:emit_domain_event|_notify_event)\(\s*(?:"([a-z0-9_.]+)"|([A-Z][A-Z0-9_]*))\s*,\s*\{')
    for f, text in _iter_gd_texts():
        const_map = _extract_local_string_consts(text)
        for m in call_re.finditer(text):
            channel_name = m.group(1) if m.group(1) else const_map.get(m.group(2), "")
            if not channel_name:
                continue
            window = text[m.end() : m.end() + 450]
            end = window.find("})")
            if end != -1:
                window = window[:end]
            has_category = "category_key" in window
            has_args = '"args"' in window
            if not has_category:
                findings.append(
                    {
                        "detector": "R4",
                        "rule_id": "ADV-EVT-004",
                        "severity": SEV_WARN,
                        "channel": channel_name,
                        "source": str(f.relative_to(ROOT)),
                        "message": "emit_domain_event/_notify_event 字面量载荷缺 category_key（叙事取色契约）",
                    }
                )
            if not has_args and channel_name not in structured_only_channels:
                findings.append(
                    {
                        "detector": "R4",
                        "rule_id": "ADV-EVT-004",
                        "severity": SEV_WARN,
                        "channel": channel_name,
                        "source": str(f.relative_to(ROOT)),
                        "message": "emit_domain_event/_notify_event 字面量载荷缺 args（模板占位填充契约，纯结构化事件可忽略）",
                    }
                )
    return findings


def _check_r1_channel_naming(
    channels: list[dict], allowed_namespaces: set[str]
) -> list[dict]:
    """R1 频道命名合规：配置驱动频道严格 ERROR；代码频道按已登记领域与别名表校验。"""
    findings: list[dict] = []
    for ch in channels:
        ch_name = get_full_channel_name(ch)
        if ch["domain"] not in allowed_namespaces:
            if ch.get("from_config"):
                findings.append(
                    {
                        "detector": "R1",
                        "rule_id": "ADV-EVT-001",
                        "severity": SEV_ERROR,
                        "channel": ch_name,
                        "source": ch["source"],
                        "message": f"配置驱动频道首段 '{ch['domain']}' 非 domains.json 已登记领域 id（<domain_id>.<event_name> 硬约定）",
                    }
                )
            else:
                findings.append(
                    {
                        "detector": "R1",
                        "rule_id": "ADV-EVT-001",
                        "severity": SEV_WARN,
                        "channel": ch_name,
                        "source": ch["source"],
                        "message": f"存量宽松前缀频道 '{ch['domain']}' 未登记为领域 id——迁移收敛清单（存量跟踪），新代码禁止新增",
                    }
                )
    return findings


def _check_r2_narrative_alignment(
    channels: list[dict],
    domain_map: dict[str, dict],
    narrative_tables: dict[str, set[str]],
) -> list[dict]:
    """R2 叙事键对齐：配置驱动频道严格 ERROR；存量代码频道缺键列入迁移收敛清单（WARN）。"""
    findings: list[dict] = []
    for ch in channels:
        if ch["exempt_narrative"] or ch["domain"] not in domain_map:
            continue
        table = domain_map[ch["domain"]]["narrative"]
        if table not in narrative_tables:
            continue
        if ch["event_name"] not in narrative_tables[table]:
            ch_name = get_full_channel_name(ch)
            if ch.get("from_config"):
                findings.append(
                    {
                        "detector": "R2",
                        "rule_id": "ADV-EVT-002",
                        "severity": SEV_ERROR,
                        "channel": ch_name,
                        "source": ch["source"],
                        "message": f"配置驱动频道事件名 '{ch['event_name']}' 在叙事表 {table} 中无对应模板键（缺失或需声明 narrative:false 豁免）",
                    }
                )
            else:
                findings.append(
                    {
                        "detector": "R2",
                        "rule_id": "ADV-EVT-002",
                        "severity": SEV_WARN,
                        "channel": ch_name,
                        "source": ch["source"],
                        "message": f"存量代码频道 '{ch['event_name']}' 在叙事表 {table} 中无对应模板键——迁移收敛清单（补键或显式结构化豁免），新代码禁止新增",
                    }
                )
    return findings


def _check_r3_registry_constants(
    registry: dict[int, dict], duplicate_ids: list[int], consts: dict[str, int]
) -> list[dict]:
    """R3 注册表-常量双向对齐（值一致 + 唯一 id + 全常量覆盖）。"""
    findings: list[dict] = []
    registry_names: set[str] = set()
    for dup_id in duplicate_ids:
        findings.append(
            {
                "detector": "R3",
                "rule_id": "ADV-EVT-003",
                "severity": SEV_ERROR,
                "channel": f"registry_id:{dup_id}",
                "source": "config/infrastructure/event_bus_config.json",
                "message": f"channel_registry 存在重复整型信道 id: {dup_id}",
            }
        )
    for cid, entry in registry.items():
        const_name = entry["name"]
        if const_name:
            registry_names.add(const_name)
        if const_name and const_name in consts and consts[const_name] != cid:
            findings.append(
                {
                    "detector": "R3",
                    "rule_id": "ADV-EVT-003",
                    "severity": SEV_ERROR,
                    "channel": f"registry:{const_name}",
                    "source": "config/infrastructure/event_bus_config.json",
                    "message": f"channel_registry id {cid} 与 EventChannelDefinition.{const_name}（{consts[const_name]}）不一致",
                }
            )
    for const_name, const_val in consts.items():
        if const_name not in registry_names:
            findings.append(
                {
                    "detector": "R3",
                    "rule_id": "ADV-EVT-003",
                    "severity": SEV_ERROR,
                    "channel": f"const:{const_name}",
                    "source": "backend/infrastructure/event_bus/event_channel_definition.gd",
                    "message": f"EventChannelDefinition.{const_name} ({const_val}) 尚未登记至 channel_registry",
                }
            )
    return findings


def _collect_all_candidate_channels(registry: dict[int, dict]) -> list[dict]:
    """合并配置驱动频道与代码字面量频道，并注入叙事豁免标志。"""
    channels: list[dict] = []
    seen: set[tuple] = set()
    for ch in collect_config_channels() + collect_code_channels():
        key = (ch["domain"], ch["event_name"])
        if key in seen:
            continue
        seen.add(key)
        ch["exempt_narrative"] = False
        channels.append(ch)

    for entry in registry.values():
        channel_name = entry["channel_name"]
        if not channel_name:
            continue
        cm = CHANNEL_RE.match(channel_name)
        if not cm:
            continue
        for ch in channels:
            if ch["domain"] == cm.group(1) and ch["event_name"] == cm.group(2):
                ch["exempt_narrative"] = not entry["narrative"]
    return channels


def main() -> int:
    """CLI 入口：全域事件总线频道声明与叙事键一致性静态审查。"""
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="输出 JSON 报告")
    args = ap.parse_args()

    domain_map = collect_domain_mapping()
    allowed_namespaces = collect_allowed_channel_namespaces(domain_map)
    narrative_tables = collect_narrative_tables(domain_map)
    registry, duplicate_ids = collect_channel_registry()
    consts = collect_channel_constants()

    channels = _collect_all_candidate_channels(registry)

    findings: list[dict] = []
    findings.extend(_check_r1_channel_naming(channels, allowed_namespaces))
    findings.extend(
        _check_r2_narrative_alignment(channels, domain_map, narrative_tables)
    )
    findings.extend(_check_r3_registry_constants(registry, duplicate_ids, consts))
    findings.extend(check_payload_contract(registry))

    errors = [f for f in findings if f["severity"] == SEV_ERROR]
    warns = [f for f in findings if f["severity"] == SEV_WARN]

    print("=" * 80)
    print("🛡️ 卡拉尔世界引擎：EventBus 频道纪律与叙事契约审查报告")
    print("=" * 80)
    print(
        f"频道候选: {len(channels)} 条（配置驱动 + 代码字面量）/ 注册表: {len(registry)} 条 / 常量: {len(consts)} 条"
    )
    for f in findings:
        print(f"  [{f['severity']}] {f['rule_id']} {f['channel']} @ {f['source']}")
        print(f"       {f['message']}")

    if args.json:
        print(
            json.dumps(
                {
                    "schema": "audit-event-channels/v1",
                    "summary": {
                        "channels": len(channels),
                        "registry": len(registry),
                        "errors": len(errors),
                        "warnings": len(warns),
                    },
                    "findings": findings,
                },
                ensure_ascii=False,
                indent=2,
            )
        )

    if errors:
        print(f"【审查结论】未通过（存在 {len(errors)} 个 ERROR 级发现）")
        return 1
    if warns:
        print(f"【审查结论】通过（提示级 {len(warns)} 个 WARN，建议修复）")
        return 0
    print("【审查结论】通过（0 违规）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
