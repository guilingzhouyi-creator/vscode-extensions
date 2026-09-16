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
import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

"""audit_event_channels.py — EventBus 频道纪律与叙事契约严格审查（Phase 71/72 对齐）。

校验频道命名合规、叙事键对齐、注册表与常量对齐、广播载荷契约。"""

ROOT = resolve_repo_root()
CONFIG = ROOT / "config"
BACKEND = ROOT / "backend"

CHANNEL_RE = re.compile(r"^([a-z][a-z0-9_]*)\.([a-z0-9_]+(?:\.[a-z0-9_]+)*)$")
CONST_RE = re.compile(r"const\s+([A-Z0-9_]+)\s*:\s*int\s*=\s*(0x[0-9A-Fa-f]+|\d+)")


def load_json(rel: str) -> dict:
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


def collect_config_channels(domain_map: dict) -> list[dict]:
    """仅扫描频道声明源（Phase 71 契约）：
       - domains/account.json  auth.channels.*
       - domains/world_state.json hud.channels.*
       - event_bus_config.json channel_registry[].legacy
    其余配置（contracts.json 契约字段等）非频道声明，禁止误判为事件频道。
    """
    channel_sources: list[tuple[Path, str]] = [
        (CONFIG / "domains" / "account.json", "auth/channels"),
        (CONFIG / "domains" / "world_state.json", "hud/channels"),
        (CONFIG / "infrastructure" / "event_bus_config.json", None),  # 特例：channel_registry.legacy
    ]
    channels: list[dict] = []

    def walk_values(o: Any, out: list) -> None:
        if isinstance(o, dict):
            for v in o.values():
                walk_values(v, out)
        elif isinstance(o, list):
            for v in o:
                walk_values(v, out)
        elif isinstance(o, str):
            out.append(o)

    for path, subkey in channel_sources:
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        candidates: list[str] = []
        if subkey is None:
            # event_bus_config.json：仅取 channel_registry 条目的 legacy 字段
            for entry in data.get("channel_registry", []):
                if isinstance(entry, dict) and entry.get("legacy"):
                    candidates.append(str(entry["legacy"]))
        else:
            node = data
            ok = True
            for part in subkey.split("/"):
                if isinstance(node, dict) and part in node:
                    node = node[part]
                else:
                    ok = False
                    break
            if ok:
                walk_values(node, candidates)
        for raw in candidates:
            m = CHANNEL_RE.match(raw.strip())
            if m and m.group(1) in domain_map:
                channels.append({
                    "domain": m.group(1),
                    "event_name": m.group(2),
                    "source": str(path.relative_to(CONFIG)),
                    "from_config": True,
                })
    return channels


def collect_channel_registry() -> dict[int, dict]:
    """channel_registry: id -> {name, legacy, category, narrative_exempt}。"""
    out: dict[int, dict] = {}
    data = load_json("infrastructure/event_bus_config.json")
    for entry in data.get("channel_registry", []):
        if not isinstance(entry, dict):
            continue
        cid = int(entry.get("id", 0))
        out[cid] = {
            "name": str(entry.get("name", "")),
            "legacy": str(entry.get("legacy", "")),
            "category": str(entry.get("category", "")),
            "narrative": bool(entry.get("narrative", True)),
        }
    return out


def collect_code_channels(domain_map: dict) -> list[dict]:
    """扫描 backend gd 中 emit_domain_event 静态字面量频道。"""
    channels: list[dict] = []
    emit_re = re.compile(r'emit_domain_event\(\s*"([a-z0-9_.]+)"')
    for f in BACKEND.rglob("*.gd"):
        try:
            text = f.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for m in emit_re.finditer(text):
            raw = m.group(1)
            cm = CHANNEL_RE.match(raw)
            if cm:
                channels.append({
                    "domain": cm.group(1),
                    "event_name": cm.group(2),
                    "source": str(f.relative_to(ROOT)),
                    "from_config": False,
                })
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


def check_payload_contract() -> list[dict]:
    """R4（WARN）：emit_domain_event 字面量载荷缺失 category_key/args 扫描。"""
    findings: list[dict] = []
    call_re = re.compile(r'emit_domain_event\(\s*"([a-z0-9_.]+)"\s*,\s*\{')
    for f in BACKEND.rglob("*.gd"):
        try:
            text = f.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for m in call_re.finditer(text):
            # 收集紧随的载荷窗口（至首个 "})" 或行尾，多行宽容）
            window = text[m.end(): m.end() + 400]
            end = window.find("})")
            if end != -1:
                window = window[:end]
            has_category = "category_key" in window
            has_args = '"args"' in window
            if not has_category:
                findings.append({
                    "detector": "R4",
                    "rule_id": "ADV-EVT-004",
                    "severity": "WARN",
                    "channel": m.group(1),
                    "source": str(f.relative_to(ROOT)),
                    "message": "emit_domain_event 字面量载荷缺 category_key（叙事取色契约）",
                })
            if not has_args:
                findings.append({
                    "detector": "R4",
                    "rule_id": "ADV-EVT-004",
                    "severity": "WARN",
                    "channel": m.group(1),
                    "source": str(f.relative_to(ROOT)),
                    "message": "emit_domain_event 字面量载荷缺 args（模板占位填充契约，纯结构化事件可忽略）",
                })
    return findings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="输出 JSON 报告")
    args = ap.parse_args()

    domain_map = collect_domain_mapping()
    narrative_tables = collect_narrative_tables(domain_map)
    registry = collect_channel_registry()
    consts = collect_channel_constants()

    # 频道候选 = 配置驱动频道 ∪ 代码字面量频道
    # 分级纪律（对齐存量收敛路线）：配置驱动频道（auth/hud/channels、channel_registry.legacy）
    # 与首段为已登记域 id 的代码频道走严格判定（ERROR）；存量宽松前缀频道（engine./lifecycle./
    # prologue. 等历史频道）列入迁移收敛清单（WARN，P73/P74 归零），不阻断门禁。
    channels: list[dict] = []
    seen: set[tuple] = set()
    for ch in collect_config_channels(domain_map) + collect_code_channels(domain_map):
        key = (ch["domain"], ch["event_name"])
        if key in seen:
            continue
        seen.add(key)
        ch["exempt_narrative"] = False
        channels.append(ch)

    # channel_registry.legacy 显式叙事豁免
    for entry in registry.values():
        legacy = entry["legacy"]
        if not legacy:
            continue
        cm = CHANNEL_RE.match(legacy)
        if not cm:
            continue
        for ch in channels:
            if ch["domain"] == cm.group(1) and ch["event_name"] == cm.group(2):
                ch["exempt_narrative"] = not entry["narrative"]

    findings: list[dict] = []

    # R1 频道命名合规：配置驱动频道严格 ERROR；代码频道按首段归属分级
    for ch in channels:
        if ch["domain"] not in domain_map:
            if ch.get("from_config"):
                findings.append({
                    "detector": "R1", "rule_id": "ADV-EVT-001", "severity": "ERROR",
                    "channel": f"{ch['domain']}.{ch['event_name']}", "source": ch["source"],
                    "message": f"配置驱动频道首段 '{ch['domain']}' 非 domains.json 已登记领域 id（<domain_id>.<event_name> 硬约定）",
                })
            else:
                findings.append({
                    "detector": "R1", "rule_id": "ADV-EVT-001", "severity": "WARN",
                    "channel": f"{ch['domain']}.{ch['event_name']}", "source": ch["source"],
                    "message": f"存量宽松前缀频道 '{ch['domain']}' 未登记为领域 id——迁移收敛清单（P73/P74 归零），新代码禁止新增",
                })

    # R2 叙事键对齐：配置驱动频道严格 ERROR；存量代码频道缺键列入迁移收敛清单（WARN）
    for ch in channels:
        if ch["exempt_narrative"] or ch["domain"] not in domain_map:
            continue
        table = domain_map[ch["domain"]]["narrative"]
        if table not in narrative_tables:
            continue
        if ch["event_name"] not in narrative_tables[table]:
            if ch.get("from_config"):
                findings.append({
                    "detector": "R2", "rule_id": "ADV-EVT-002", "severity": "ERROR",
                    "channel": f"{ch['domain']}.{ch['event_name']}", "source": ch["source"],
                    "message": f"配置驱动频道事件名 '{ch['event_name']}' 在叙事表 {table} 中无对应模板键（缺失或需声明 narrative:false 豁免）",
                })
            else:
                findings.append({
                    "detector": "R2", "rule_id": "ADV-EVT-002", "severity": "WARN",
                    "channel": f"{ch['domain']}.{ch['event_name']}", "source": ch["source"],
                    "message": f"存量代码频道 '{ch['event_name']}' 在叙事表 {table} 中无对应模板键——迁移收敛清单（P73/P74 补键或显式结构化豁免），新代码禁止新增",
                })

    # R3 注册表-常量对齐
    for cid, entry in registry.items():
        const_name = entry["name"]
        if const_name and const_name in consts and consts[const_name] != cid:
            findings.append({
                "detector": "R3", "rule_id": "ADV-EVT-003", "severity": "ERROR",
                "channel": f"registry:{const_name}", "source": "config/infrastructure/event_bus_config.json",
                "message": f"channel_registry id {cid} 与 EventChannelDefinition.{const_name}（{consts[const_name]}）不一致",
            })

    findings += check_payload_contract()

    errors = [f for f in findings if f["severity"] == "ERROR"]
    warns = [f for f in findings if f["severity"] == "WARN"]

    print("=" * 80)
    print("🛡️ 卡拉尔世界引擎：EventBus 频道纪律与叙事契约审查报告 (Phase 71)")
    print("=" * 80)
    print(f"频道候选: {len(channels)} 条（配置驱动 + 代码字面量）/ 注册表: {len(registry)} 条 / 常量: {len(consts)} 条")
    for f in findings:
        print(f"  [{f['severity']}] {f['rule_id']} {f['channel']} @ {f['source']}")
        print(f"       {f['message']}")

    if args.json:
        print(json.dumps({
            "schema": "audit-event-channels/v1",
            "summary": {"channels": len(channels), "registry": len(registry), "errors": len(errors), "warnings": len(warns)},
            "findings": findings,
        }, ensure_ascii=False, indent=2))

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
