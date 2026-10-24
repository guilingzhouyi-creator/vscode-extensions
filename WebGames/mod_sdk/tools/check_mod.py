#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Tools)
# 文件路径: WebGames/mod_sdk/tools/check_mod.py
# 架构定位: MOD纯静态轻量自愈诊断器 (Pure Static Mod Validator & Diagnostic Tool)
# 依赖与触发: 触发方: CLI / 外部 Agent | 上游: MOD 目录与文件 | 下游: 控制台输出与结构化 JSON 自愈指引 | 运行时: Python 3.10+
# 职责说明: 纯静态校验 MOD 清单格式、因果 DAG 拓扑连通性与文案占位符白名单，输出自愈诊断
# 退出语义与设计依据: 退出码: 0=合规通过, 1=发现违规错误, 2=参数/IO错误 | 设计依据: 《卡拉尔数据契约规范 v1.0》与第一性原理
# ------------------------------------------------------------------------------
# 用法示例:
#   python mod_sdk/tools/check_mod.py ./my_mod
#   python mod_sdk/tools/check_mod.py ./my_mod --json
# ==============================================================================
"""纯静态轻量 MOD 检查器与自愈诊断器：专为外部开发者与自主 Agent 打造的门禁工具。"""

from __future__ import annotations
from pathlib import Path
from typing import Any
import argparse
import json
import re
import sys
TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

try:
    from cook_assets import cook_assets
except ImportError:
    cook_assets = None

# ==============================================================================
from check_mod_common import (
    DiagnosticItem,
    WHITELISTED_PLACEHOLDERS,
    PARAM_REGEX,
    REQUIRED_MANIFEST_FIELDS,
    BUILTIN_DAG_IDS,
    ensure_utf8_stdout as _ensure_utf8_stdout,
    add_diag as _add_diag,
    safe_load_json as _safe_load_json,
)
from check_mod_dag import (
    check_dag_entries_and_terminals as _check_dag_entries_and_terminals,
    build_dag_graph_structure as _build_dag_graph_structure,
    detect_dag_cycle_kahn as _detect_dag_cycle_kahn,
    check_reachability as _check_reachability,
    flatten_i18n_dict as _flatten_i18n_dict,
    check_dag_file as _check_dag_file,
)
from check_mod_destiny import (
    check_destinies_file,
    extract_rules_list,
)
from check_mod_multi import (
    check_multi_incompatible_packs as _check_multi_incompatible_packs,
    register_entity_ids as _register_entity_ids,
    check_multi_duplicate_ids as _check_multi_duplicate_ids,
    check_multi_ui_policy_conflicts as _check_multi_ui_policy_conflicts,
    validate_multi_mods,
)


# ==============================================================================
# 三、DAG 拓扑连通性、Kahn 环检测与多包冲突裁决契约 (DAG & Multi-Pack Contracts)
# - Inv-DAG-TOPOLOGY: 单一 START_ENTRY，至少一个 TERMINAL_EXIT，Kahn 算法零有向环
# - Inv-DAG-REACHABILITY: 前向全节点可达（零孤儿），反向全路径可达终态（零死胡同）
# - Inv-MULTI-CONFLICT: 跨包互斥、同名 origin_id/trait_id/kit_id 与 UI 策略互斥静态阻断
# ==============================================================================


def _check_manifest(mod_dir: Path, diags: list[DiagnosticItem]) -> dict[str, Any] | None:
    """校验 pack.json 清单。"""
    manifest_path = mod_dir / "pack.json"
    data = _safe_load_json(manifest_path, "pack.json", diags)
    if not isinstance(data, dict):
        if data is not None:
            diags.append(DiagnosticItem(
                code="ERR_MANIFEST_NOT_OBJECT",
                file_path="pack.json",
                detail="pack.json 顶层必须为 JSON 对象",
                fix_suggestion="请将 pack.json 根节点修改为 JSON 对象格式 {}",
            ))
        return None

    for field in REQUIRED_MANIFEST_FIELDS:
        if field not in data:
            diags.append(DiagnosticItem(
                code="ERR_MANIFEST_FIELD_MISSING",
                file_path="pack.json",
                detail=f"清单缺失必备字段: '{field}'",
                fix_suggestion=f"在 pack.json 中补充 '{field}' 字段声明",
            ))

    if not isinstance(data.get("priority", 0), int):
        diags.append(DiagnosticItem(
            code="ERR_MANIFEST_FIELD_TYPE",
            file_path="pack.json",
            detail="字段 'priority' 必须为整数",
            fix_suggestion="将 'priority' 字段修改为正整数（如 100）",
        ))

    return data


def _check_routing_rules(mod_dir: Path, declared_dag_ids: set[str], diags: list[DiagnosticItem]) -> None:
    """校验 routing_rules.json。"""
    routing_path = mod_dir / "routing_rules.json"
    data = _safe_load_json(routing_path, "routing_rules.json", diags)
    if data is None:
        return

    rules = extract_rules_list(data)
    if not rules:
        diags.append(DiagnosticItem(
            code="ERR_ROUTING_EMPTY",
            file_path="routing_rules.json",
            detail="routing_rules.json 中未解析到有效的路由规则列表",
            fix_suggestion="请在 routing_rules.json 中提供 'routing_rules' 数组并配置匹配规则",
        ))
        return

    valid_dags = declared_dag_ids | BUILTIN_DAG_IDS
    for idx, rule in enumerate(rules):
        target = rule.get("target_dag_id")
        if not target or not isinstance(target, str):
            diags.append(DiagnosticItem(
                code="ERR_ROUTING_TARGET_MISSING",
                file_path="routing_rules.json",
                detail=f"第 {idx} 条路由规则缺少 'target_dag_id'",
                fix_suggestion="为该规则指定目标 DAG 图标识符 target_dag_id",
            ))
            continue

        if valid_dags and target not in valid_dags:
            diags.append(DiagnosticItem(
                code="ERR_ROUTING_TARGET_UNKNOWN",
                file_path="routing_rules.json",
                detail=f"第 {idx} 条规则引用的 target_dag_id '{target}' 在 dag_graphs/ 或内置图中未找到",
                fix_suggestion=f"请确保 dag_graphs/{target}.json 存在或修改目标 ID",
            ))


# ==============================================================================
# 四、DAG 拓扑连通性、Kahn 环检测与多包冲突裁决契约 (DAG & Multi-Pack Contracts)
# - Inv-DAG-TOPOLOGY: 单一 START_ENTRY，至少一个 TERMINAL_EXIT，Kahn 算法零有向环
# - Inv-DAG-REACHABILITY: 前向全节点可达（零孤儿），反向全路径可达终态（零死胡同）
# - Inv-MULTI-CONFLICT: 跨包互斥、同名 origin_id/trait_id/kit_id 与 UI 策略互斥静态阻断
# ==============================================================================

def _check_i18n(mod_dir: Path, required_keys: set[str], diags: list[DiagnosticItem]) -> None:
    """校验 i18n 语言包与占位符白名单（当所有节点采用 inline_text 且 i18n 不存在时免校验放行）。"""
    i18n_dir = mod_dir / "i18n"
    if not i18n_dir.is_dir():
        if not required_keys:
            return
        diags.append(DiagnosticItem(
            code="ERR_I18N_DIR_MISSING",
            file_path="i18n",
            detail="缺少 i18n 本地化目录",
            fix_suggestion="创建 i18n 目录并在其中放置 zh-CN.json",
        ))
        return

    i18n_files = sorted(i18n_dir.glob("*.json"))
    if not i18n_files:
        if not required_keys:
            return
        diags.append(DiagnosticItem(
            code="ERR_I18N_EMPTY",
            file_path="i18n",
            detail="i18n 目录下未找到任何语言 JSON 文件",
            fix_suggestion="在 i18n 目录创建 zh-CN.json 提供多语言文案字典",
        ))
        return

    for ifile in i18n_files:
        rel_path = f"i18n/{ifile.name}"
        raw_data = _safe_load_json(ifile, rel_path, diags)
        if not isinstance(raw_data, dict):
            continue

        data = _flatten_i18n_dict(raw_data)

        # 1. 检查 DAG 引用的叙事键在语言包中是否存在
        for rkey in sorted(required_keys):
            if rkey not in data:
                diags.append(DiagnosticItem(
                    code="ERR_I18N_MISSING_KEY",
                    file_path=rel_path,
                    detail=f"语言包缺少 DAG 所需的文案键: '{rkey}'",
                    fix_suggestion=f"在 {rel_path} 中添加键 '{rkey}' 的本地化翻译文本",
                ))

        # 2. 占位符白名单校验
        for k, text in data.items():
            if not isinstance(text, str):
                continue
            matches = PARAM_REGEX.findall(text)
            for param in matches:
                if param not in WHITELISTED_PLACEHOLDERS:
                    diags.append(DiagnosticItem(
                        code="ERR_UNKNOWN_PLACEHOLDER",
                        file_path=rel_path,
                        detail=f"键 '{k}' 包含非法/未知占位符 '{{{param}}}'",
                        fix_suggestion=f"请替换为白名单参数，如: {', '.join(sorted(list(WHITELISTED_PLACEHOLDERS)[:6]))}",
                    ))


def _check_asset_safety_and_manifest(mod_dir: Path, diags: list[DiagnosticItem]) -> None:
    """若存在 assets/ 目录，校验其资源格式白名单、体积预算及 manifest.json。"""
    assets_dir = mod_dir / "assets"
    if not assets_dir.is_dir():
        return
    if cook_assets is not None:
        valid_assets, asset_diags, _ = cook_assets(mod_dir, check_only=True)
        for d in asset_diags:
            diags.append(DiagnosticItem(d.code, d.file, d.detail, d.fix_suggestion))


def _collect_mod_uri_strings(obj: Any) -> list[str]:
    """递归收集数据对象中所有以 'mod://' 开头的资产 URI 字符串。"""
    found: list[str] = []
    if isinstance(obj, str):
        if obj.startswith("mod://"):
            found.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            found.extend(_collect_mod_uri_strings(v))
    elif isinstance(obj, list):
        for item in obj:
            found.extend(_collect_mod_uri_strings(item))
    return found


def _resolve_mod_uri_path(mod_dir: Path, uri: str) -> bool:
    """判断 mod:// 资产 URI 是否在模组内物理存在。"""
    clean_target = uri[6:].strip("/")
    if not clean_target:
        return False
    if (mod_dir / clean_target).is_file():
        return True
    if (mod_dir / "assets" / clean_target).is_file():
        return True
    return False


def _check_dangling_asset_refs(mod_dir: Path, diags: list[DiagnosticItem]) -> None:
    """校验 destinies.json 与因果 DAG 图元中引用的 mod:// 资产是否存在于 assets/。"""
    destiny_path = mod_dir / "destinies.json"
    if destiny_path.is_file():
        try:
            d_data = json.loads(destiny_path.read_text(encoding="utf-8"))
            for uri in _collect_mod_uri_strings(d_data):
                if not _resolve_mod_uri_path(mod_dir, uri):
                    diags.append(DiagnosticItem(
                        code="ERR_ASSET_DANGLING_REF",
                        file_path="destinies.json",
                        detail=f"destinies.json 引用了不存在的资产: '{uri}'",
                        fix_suggestion=f"请确保资产文件已放置于 assets/ 对应路径，并运行 'kalar-mod cook' 生成清单",
                    ))
        except (json.JSONDecodeError, OSError):
            pass

    dag_dir = mod_dir / "dag_graphs"
    if dag_dir.is_dir():
        for df in sorted(dag_dir.glob("*.json")):
            try:
                g_data = json.loads(df.read_text(encoding="utf-8"))
                rel_file = f"dag_graphs/{df.name}"
                for uri in _collect_mod_uri_strings(g_data):
                    if not _resolve_mod_uri_path(mod_dir, uri):
                        diags.append(DiagnosticItem(
                            code="ERR_ASSET_DANGLING_REF",
                            file_path=rel_file,
                            detail=f"{rel_file} 节点中引用了不存在的资产: '{uri}'",
                            fix_suggestion=f"请确保资产文件已放置于 assets/ 对应路径，或修正节点中的资源 URI",
                        ))
            except (json.JSONDecodeError, OSError):
                pass


def _check_content_directory(mod_dir: Path, diags: list[DiagnosticItem]) -> None:
    """校验 content/ 大魔改数据目录及其 JSON 实体定义的合法性。"""
    content_dir = mod_dir / "content"
    if not content_dir.is_dir():
        return

    content_files = sorted([p for p in content_dir.rglob("*") if p.is_file()])
    if not content_files:
        diags.append(DiagnosticItem(
            code="ERR_CONTENT_EMPTY",
            file_path="content",
            detail="content/ 目录已创建但未包含任何数据文件",
            fix_suggestion="请在 content/ 目录下放置合规的 JSON 数据定义文件，或移除空的 content/ 目录",
        ))
        return

    forbidden_exts = frozenset({".exe", ".bat", ".cmd", ".sh", ".py", ".pyc", ".dll", ".so", ".bin", ".ps1"})
    for cf in content_files:
        rel_str = f"content/{cf.relative_to(content_dir).as_posix()}"
        ext = cf.suffix.lower()
        if ext in forbidden_exts:
            diags.append(DiagnosticItem(
                code="ERR_CONTENT_FORBIDDEN_FILE",
                file_path=rel_str,
                detail=f"content/ 目录严禁包含可执行或脚本文件: '{cf.name}'",
                fix_suggestion="请将该文件移出 content/ 目录",
            ))
            continue
        if ext not in (".json", ".json5"):
            diags.append(DiagnosticItem(
                code="ERR_CONTENT_INVALID_FORMAT",
                file_path=rel_str,
                detail=f"content/ 文件格式非法: '{cf.name}' (仅支持 .json)",
                fix_suggestion="请将大魔改数据存储为合规的 .json 格式",
            ))
            continue
        try:
            cdata = json.loads(cf.read_text(encoding="utf-8"))
            if not isinstance(cdata, (dict, list)):
                diags.append(DiagnosticItem(
                    code="ERR_CONTENT_NOT_OBJECT_OR_ARRAY",
                    file_path=rel_str,
                    detail=f"{rel_str} 顶层必须为 JSON 对象或列表",
                    fix_suggestion="请将该文件的根结构调整为 {} 或 []",
                ))
        except (json.JSONDecodeError, OSError) as exc:
            diags.append(DiagnosticItem(
                code="ERR_CONTENT_JSON_INVALID",
                file_path=rel_str,
                detail=f"JSON 解析失败: {exc}",
                fix_suggestion=f"请检查 {rel_str} 的语法正确性",
            ))


def validate_mod(mod_dir: Path) -> tuple[bool, list[DiagnosticItem]]:
    """核心单包诊断校验流水线。"""
    diags: list[DiagnosticItem] = []
    if not mod_dir.is_dir():
        diags.append(DiagnosticItem(
            code="ERR_MOD_DIR_NOT_FOUND",
            file_path=str(mod_dir),
            detail=f"MOD 目标目录不存在: {mod_dir}",
            fix_suggestion="请确认命令行指定的 MOD 根目录路径存在",
        ))
        return False, diags

    _check_manifest(mod_dir, diags)

    dag_dir = mod_dir / "dag_graphs"
    declared_dag_ids: set[str] = set()
    required_keys: set[str] = set()

    if not dag_dir.is_dir():
        diags.append(DiagnosticItem(
            code="ERR_DAG_DIR_MISSING",
            file_path="dag_graphs",
            detail="缺少 dag_graphs 目录",
            fix_suggestion="创建 dag_graphs 目录并在其中放置因果 DAG 图元 JSON",
        ))
    else:
        dag_files = sorted(dag_dir.glob("*.json"))
        if not dag_files:
            diags.append(DiagnosticItem(
                code="ERR_DAG_NO_FILES",
                file_path="dag_graphs",
                detail="dag_graphs 目录下未找到任何因果图元 JSON 文件",
                fix_suggestion="在 dag_graphs 下至少创建一个 DAG_<ID>.json 图元文件",
            ))
        for df in dag_files:
            dag_stem = df.stem
            declared_dag_ids.add(dag_stem)
            _check_dag_file(df, f"dag_graphs/{df.name}", required_keys, declared_dag_ids, diags)

    _check_routing_rules(mod_dir, declared_dag_ids, diags)
    _check_i18n(mod_dir, required_keys, diags)
    check_destinies_file(mod_dir, diags, declared_dag_ids=declared_dag_ids)
    _check_asset_safety_and_manifest(mod_dir, diags)
    _check_dangling_asset_refs(mod_dir, diags)
    _check_content_directory(mod_dir, diags)

    valid = len(diags) == 0
    return valid, diags



def print_cli_report(valid: bool, diags: list[DiagnosticItem], mod_dir: Path) -> None:
    """输出人类可读的控制台审查报告。"""
    print("==============================================================================")
    print(f"🔍 卡拉尔 MOD 静态诊断报告: {mod_dir.resolve().name}")
    print("------------------------------------------------------------------------------")
    if valid:
        print("  🎉 诊断结论: 100% 合规通过！")
        print("  • 清单格式   : 合规")
        print("  • DAG 拓扑   : 连通性良好，无环，无孤儿，单入口全路径可达")
        print("  • 命途契约   : 六维预算、正负因果守恒与初始套件全部合规")
        print("  • 占位符白名单: 100% 遵从")
        print("  • 资产与引用 : 格式白名单、体积预算与 mod:// 引用全部合规")
        print("  • 魔改数据体 : content/ 大魔改数据结构合法")
        print("==============================================================================")
        return

    print(f"  ❌ 发现 {len(diags)} 处违规或拓扑缺陷:\n")
    for idx, d in enumerate(diags, start=1):
        print(f"  [{idx}] [{d.code}] 文件: {d.file}")
        print(f"      • 详情: {d.detail}")
        print(f"      • 建议: {d.fix_suggestion}\n")
    print("==============================================================================")


def _collect_target_dirs(mod_dir_arg: str | None, multi_dirs_arg: list[str] | None) -> list[Path]:
    """汇总并去重命令行传入的待检 MOD 目录列表。"""
    targets: list[Path] = []
    seen_resolved: set[Path] = set()
    raw_list: list[str] = []
    if mod_dir_arg:
        raw_list.append(mod_dir_arg)
    if multi_dirs_arg:
        raw_list.extend(multi_dirs_arg)

    for raw in raw_list:
        p = Path(raw)
        resolved = p.resolve()
        if resolved not in seen_resolved:
            seen_resolved.add(resolved)
            targets.append(p)
    return targets


def main() -> None:
    """命令行入口。"""
    _ensure_utf8_stdout()
    parser = argparse.ArgumentParser(
        description="卡拉尔 MOD 纯静态自愈诊断器 (Static Mod Checker)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("mod_dir", nargs="?", help="待诊断的 MOD 根目录路径")
    parser.add_argument(
        "--check-multi",
        nargs="+",
        dest="multi_dirs",
        default=None,
        help="多包联合冲突预检的附加或完整 MOD 目录列表",
    )
    parser.add_argument("--json", action="store_true", dest="as_json", help="输出机器可读的结构化 JSON 诊断信息")

    args = parser.parse_args()
    target_dirs = _collect_target_dirs(args.mod_dir, args.multi_dirs)
    if not target_dirs:
        parser.error("请提供至少一个 mod_dir 或通过 --check-multi 指定待检目录列表")

    if args.multi_dirs is not None or len(target_dirs) > 1:
        valid, diags = validate_multi_mods(target_dirs)
        report_target = target_dirs[0]
    else:
        report_target = target_dirs[0]
        valid, diags = validate_mod(report_target)

    if args.as_json:
        payload = {
            "valid": valid,
            "checked_packs": [d.name for d in target_dirs],
            "error_count": len(diags),
            "diagnostics": [d.to_dict() for d in diags],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_cli_report(valid, diags, report_target)

    sys.exit(0 if valid else 1)


if __name__ == "__main__":
    main()
