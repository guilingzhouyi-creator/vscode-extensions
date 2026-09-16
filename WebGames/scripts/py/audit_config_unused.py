#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与质量门禁 (Tooling · 死配置清理门禁)
# 文件路径: WebGames/scripts/py/audit_config_unused.py
# 架构定位: 配置引用分析器 (Dead Config Analyzer)
# 依赖与触发: 触发方: audit_runner / 本地 CLI | 上游: config/ 与 backend/ | 下游: 门禁报告 | 运行时: Python 3.10+
# 职责说明: 交叉比对配置表键名与代码消费点，发现未被任何代码消费的废弃冗余键
# 退出语义与设计依据: 退出码: 0=合规, 1=存在未引用配置 | 设计依据: 零残留架构纪律
# ------------------------------------------------------------------------------
# 用法示例:
#   python scripts/py/audit_config_unused.py
#   python scripts/py/audit_config_unused.py --json
# ==============================================================================
"""审查 config/ 中未被 backend 代码引用的配置表（提示级）。"""
import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from audit_common import ensure_utf8_stdout, resolve_repo_root

ensure_utf8_stdout()

ROOT = resolve_repo_root()
CONFIG_DIR = ROOT / "config"
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"

# 单机聚焦阶段的联机预留叙事表（提示级不计入死配置，未来联机启用时需补 _msg 消费）
# 依据：这些域的 narratives.* 仅在联机预留分支使用，单机 EventBus 未广播相关频道
RESERVED_NARRATIVES: set[str] = {
    "narratives.event_driven_audio",
    "narratives.game_settings",
    "narratives.hardware_input",
    "narratives.identity_disguise",
    "narratives.localization_i18n",
    "narratives.narrative_orchestration",
    "narratives.notification_red_dot",
    "narratives.spatial_movement",
    "narratives.telemetry_account_lifecycle",
}

GETTER_RE = re.compile(
    r'GameConfig\.(?:get_int|get_float|get_string|get_bool|get_dict|get_array|get_table|get_value)'
    r'\(\s*"([a-z0-9_.]+)"'
)
MSG_RE = re.compile(r'GameConfig\.msg\(\s*"([a-z0-9_]+)"')
NARRATIVE_RE = re.compile(r'(?:render_narrative|emit_narrative_by_key)\(\s*"([a-z0-9_]+)/')
FULLNAME_RE = re.compile(r'"(infrastructure|domains|frontend|narratives|items)\.[a-z0-9_]+"')
# Phase 71 对齐：配置驱动频道引用识别——<domain_id>.<event_name> 形态（如 account.registered）
# 首段必须是 domains.json 已登记领域 id，解析为对 narratives.<首段> 的动态叙事引用。
CHANNEL_RE = re.compile(r"^([a-z][a-z0-9_]*)\.([a-z0-9_]+(?:\.[a-z0-9_]+)*)$")


def collect_domain_ids() -> set[str]:
    """从 domains.json 收集已登记领域 id（频道首段合法性判定依据）。"""
    try:
        data = json.loads((CONFIG_DIR / "infrastructure" / "domains.json").read_text(encoding="utf-8"))
        return {str(e.get("id", "")) for e in data.get("domains", []) if isinstance(e, dict)}
    except Exception:
        return set()


def collect_channel_narrative_refs() -> set[str]:
    """扫描频道声明源（Phase 71 契约）解析为对 narratives.<域> 的动态引用。

    Phase 71：HudEventContract / event_bus_config.channel_registry.legacy 均为配置驱动
    频道，此前 narratives.world_state 因仅被配置引用而误报"疑似死配置"；本函数将
    配置声明的频道解析为对 narratives.<域> 的动态引用，消除误报并收紧死配置判定。
    仅扫描频道声明表（domains.account auth/channels、domains.world_state hud/channels、
    event_bus_config.channel_registry.legacy），contracts.json 契约字段等非频道声明不入检。
    """
    domain_ids = collect_domain_ids()
    refs: set[str] = set()

    def walk_values(o: Any, out: list) -> None:
        if isinstance(o, dict):
            for v in o.values():
                walk_values(v, out)
        elif isinstance(o, list):
            for v in o:
                walk_values(v, out)
        elif isinstance(o, str):
            out.append(o)

    channel_sources: list[tuple[Path, str]] = [
        (CONFIG_DIR / "domains" / "account.json", "auth/channels"),
        (CONFIG_DIR / "domains" / "world_state.json", "hud/channels"),
        (CONFIG_DIR / "infrastructure" / "event_bus_config.json", None),
    ]
    for path, subkey in channel_sources:
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        candidates: list[str] = []
        if subkey is None:
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
            if m and m.group(1) in domain_ids:
                refs.add("narratives." + m.group(1))
    return refs


def collect_tables() -> list[tuple[str, str]]:
    """返回 [(表名, 相对路径)]，表名 = <层>.<文件名>。"""
    out: list[tuple[str, str]] = []
    for f in sorted(CONFIG_DIR.rglob("*.json")):
        rel = f.relative_to(CONFIG_DIR)
        layer = rel.parts[0] if len(rel.parts) > 1 else ""
        out.append((f"{layer}.{f.stem}" if layer else f.stem, str(rel)))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true", help="存在未引用表即返回 1")
    args = ap.parse_args()

    tables = collect_tables()
    all_names = {name for name, _ in tables}

    referenced: set[str] = set()
    dynamic_narratives: set[str] = set()
    weak: set[str] = set()
    for search_dir in (BACKEND_DIR, FRONTEND_DIR):
        for f in search_dir.rglob("*.gd"):
            try:
                text = f.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            for m in GETTER_RE.finditer(text):
                referenced.add(m.group(1))
            for m in MSG_RE.finditer(text):
                referenced.add("narratives." + m.group(1))
            for m in NARRATIVE_RE.finditer(text):
                dynamic_narratives.add("narratives." + m.group(1))
            for m in FULLNAME_RE.finditer(text):
                weak.add(m.group(0).strip('"'))

    # Phase 71 对齐：配置驱动频道（HudEventContract/channel_registry.legacy）→ 叙事表动态引用
    channel_refs: set[str] = collect_channel_narrative_refs()
    dynamic_narratives |= channel_refs
    referenced |= dynamic_narratives | weak
    # 单机聚焦：预留叙事表不计入未引用（需显式保留，避免误删联机文案）
    unused = [t for t in sorted(all_names) if t not in referenced and t not in RESERVED_NARRATIVES]
    reserved_hit = sorted(t for t in RESERVED_NARRATIVES if t not in referenced)

    print(f"【audit-config-unused】配置表 {len(all_names)} 张 / "
          f"强引用 {len(referenced - dynamic_narratives - weak)} / "
          f"动态叙事 {len(dynamic_narratives)} / 弱引用 {len(weak)} / 未引用 {len(unused)}"
          + (f" / 预留 {len(reserved_hit)}" if reserved_hit else ""))
    for name, rel in tables:
        if name in unused:
            mark = "⚠ 疑似死配置" if not name.startswith("frontend.") else "⚠ frontend 层（可能被前端消费）"
            print(f"  · {rel}（{name}）{mark}")
    if reserved_hit:
        for name in reserved_hit:
            rel = next((r for n, r in tables if n == name), name)
            print(f"  · {rel}（{name}）ℹ 单机预留（联机启用时需补 _msg 消费）")
    if args.strict and unused:
        print("【审查结论】--strict 模式未通过")
        return 1
    print("【审查结论】通过（提示级）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
