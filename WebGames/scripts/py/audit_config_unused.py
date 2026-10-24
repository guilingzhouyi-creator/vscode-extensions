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
from pathlib import Path
from typing import Any
import argparse
import json
import re
import sys

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
FULLNAME_RE = re.compile(r'"(infrastructure|domains|frontend|narratives|items)(?:\.[a-z0-9_]+)+"')
# 契约对齐：配置驱动频道引用识别——<domain_id>.<event_name> 形态（如 account.registered）
# 首段必须是 domains.json 已登记领域 id，解析为对 narratives.<首段> 的动态叙事引用。
CHANNEL_RE = re.compile(r"^([a-z][a-z0-9_]*)\.([a-z0-9_]+(?:\.[a-z0-9_]+)*)$")


def collect_domain_ids() -> set[str]:
    """从 domains.json 收集已登记领域 id（频道首段合法性判定依据）。"""
    try:
        data = json.loads((CONFIG_DIR / "infrastructure" / "domains.json").read_text(encoding="utf-8"))
        return {str(e.get("id", "")) for e in data.get("domains", []) if isinstance(e, dict)}
    except Exception:
        return set()


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
            if isinstance(entry, dict) and entry.get("legacy"):
                candidates.append(str(entry["legacy"]))
        return candidates

    node: Any = data
    for part in subkey.split("/"):
        if not isinstance(node, dict) or part not in node:
            return candidates
        node = node[part]
    _walk_string_values(node, candidates)
    return candidates


def _resolve_channel_narrative_from_source(
    path: Path, subkey: str | None, domain_ids: set[str]
) -> set[str]:
    """读取指定频道配置文件并解析为 narratives.<域> 引用集合。"""
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return set()
    refs: set[str] = set()
    for raw in _extract_channel_candidates(data, subkey):
        m = CHANNEL_RE.match(raw.strip())
        if m and m.group(1) in domain_ids:
            refs.add("narratives." + m.group(1))
    return refs


def collect_channel_narrative_refs() -> set[str]:
    """扫描频道声明源契约解析为对 narratives.<域> 的动态引用。"""
    domain_ids = collect_domain_ids()
    refs: set[str] = set()

    account_path = CONFIG_DIR / "domains" / "account" / "core.json"
    if not account_path.exists():
        account_path = CONFIG_DIR / "domains" / "account.json"
    world_state_path = CONFIG_DIR / "domains" / "world_state" / "core.json"
    if not world_state_path.exists():
        world_state_path = CONFIG_DIR / "domains" / "world_state.json"
    channel_sources: list[tuple[Path, str | None]] = [
        (account_path, "auth/channels"),
        (world_state_path, "hud/channels"),
        (CONFIG_DIR / "infrastructure" / "event_bus_config.json", None),
    ]
    for path, subkey in channel_sources:
        refs.update(_resolve_channel_narrative_from_source(path, subkey, domain_ids))
    return refs


def collect_tables() -> list[tuple[str, str]]:
    """返回 [(表名, 相对路径)]，表名 = 点分相对路径。"""
    out: list[tuple[str, str]] = []
    for f in sorted(CONFIG_DIR.rglob("*.json")):
        rel = f.relative_to(CONFIG_DIR)
        out.append((".".join(rel.with_suffix("").parts), str(rel)))
    return out


def _scan_single_gd_file(
    f: Path, referenced: set[str], dynamic: set[str], weak: set[str]
) -> None:
    """提取单个 GDScript 中的配置引用标记。"""
    try:
        text = f.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return
    for m in GETTER_RE.finditer(text):
        referenced.add(m.group(1))
    for m in MSG_RE.finditer(text):
        referenced.add("narratives." + m.group(1))
    for m in NARRATIVE_RE.finditer(text):
        dynamic.add("narratives." + m.group(1))
    for m in FULLNAME_RE.finditer(text):
        weak.add(m.group(0).strip('"'))


def _collect_gd_references() -> tuple[set[str], set[str], set[str]]:
    """扫描 GDScript 源码获取强引用、动态叙事引用与弱引用集合。"""
    referenced: set[str] = set()
    dynamic_narratives: set[str] = set()
    weak: set[str] = set()
    for search_dir in (BACKEND_DIR, FRONTEND_DIR):
        for f in search_dir.rglob("*.gd"):
            _scan_single_gd_file(f, referenced, dynamic_narratives, weak)
    return referenced, dynamic_narratives, weak


def _collect_sub_tables_from_manifest(manifest_path: Path, referenced: set[str]) -> list[str]:
    """读取清单并提取匹配领域的 sub_tables。"""
    if not manifest_path.is_file():
        return []
    try:
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        print(f"[WARN] domains.json 解析跳过: {exc}")
        return []

    collected: list[str] = []
    for d_entry in data.get("domains", []):
        if not isinstance(d_entry, dict) or d_entry.get("config") not in referenced:
            continue
        for st in d_entry.get("sub_tables", []):
            collected.append(str(st))
    return collected


def _expand_manifest_references(referenced: set[str], all_names: set[str]) -> None:
    """根据 domains.json 清单扩展子表引用与 .core 候选表。"""
    manifest_path = CONFIG_DIR / "infrastructure" / "domains.json"
    for st in _collect_sub_tables_from_manifest(manifest_path, referenced):
        referenced.add(st)

    for t in list(referenced):
        core_candidate = f"{t}.core"
        if core_candidate in all_names:
            referenced.add(core_candidate)


def _print_unused_report(
    all_names: set[str],
    referenced: set[str],
    dynamic_narratives: set[str],
    weak: set[str],
    unused: list[str],
    reserved_hit: list[str],
    tables: list[tuple[str, str]],
) -> None:
    """打印未引用配置表详细报告。"""
    print(
        f"【audit-config-unused】配置表 {len(all_names)} 张 / "
        f"强引用 {len(referenced - dynamic_narratives - weak)} / "
        f"动态叙事 {len(dynamic_narratives)} / 弱引用 {len(weak)} / 未引用 {len(unused)}"
        + (f" / 预留 {len(reserved_hit)}" if reserved_hit else "")
    )
    for name, rel in tables:
        if name in unused:
            mark = "⚠ 疑似死配置" if not name.startswith("frontend.") else "⚠ frontend 层（可能被前端消费）"
            print(f"  · {rel}（{name}）{mark}")
    if reserved_hit:
        for name in reserved_hit:
            rel = next((r for n, r in tables if n == name), name)
            print(f"  · {rel}（{name}）ℹ 单机预留（联机启用时需补 _msg 消费）")


def main() -> int:
    """CLI 入口：静态扫描未引用的死配置表与单机预留表。"""
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true", help="存在未引用表即返回 1")
    args = ap.parse_args()

    tables = collect_tables()
    all_names = {name for name, _ in tables}

    referenced, dynamic_narratives, weak = _collect_gd_references()
    channel_refs = collect_channel_narrative_refs()
    dynamic_narratives |= channel_refs
    referenced |= dynamic_narratives | weak

    _expand_manifest_references(referenced, all_names)

    unused = [t for t in sorted(all_names) if t not in referenced and t not in RESERVED_NARRATIVES]
    reserved_hit = sorted(t for t in RESERVED_NARRATIVES if t not in referenced)

    _print_unused_report(all_names, referenced, dynamic_narratives, weak, unused, reserved_hit, tables)

    if args.strict and unused:
        print("【审查结论】--strict 模式未通过")
        return 1
    print("【审查结论】通过（提示级）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
