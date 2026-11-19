#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · 内容目录与资产引用校验器)
# 文件路径: WebGames/mod_sdk/tools/check_mod_content.py
# 架构定位: MOD content/ 扩展域与 mod:// 悬空资产引用静态校验模块
# 依赖与触发: 触发方: check_mod.py | 上游: MOD assets/ 与 content/ | 下游: 诊断列表 | 运行时: Python 3.10+
# 职责说明: 校验 assets/ 资源安全与清单、mod:// 资产引用可达性以及 content/ 子目录 JSON Schema
# 退出语义与设计依据: 工具库模块，无进程退出码 | 设计依据: 《卡拉尔数据契约规范 v1.0》与资产安全白名单契约
# ------------------------------------------------------------------------------
# 用法示例:
#   from check_mod_content import check_asset_safety_and_manifest, check_content_directory, check_dangling_asset_refs
# ==============================================================================
"""MOD 资产引用与 content/ 扩展目录静态校验辅助模块。"""

from __future__ import annotations
from pathlib import Path
from typing import Any
import json
import sys

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

try:
    from cook_assets import cook_assets
except ImportError:
    cook_assets = None

from check_mod_common import DiagnosticItem


def check_asset_safety_and_manifest(
    mod_dir: Path, diags: list[DiagnosticItem]
) -> None:
    """若存在 assets/ 目录，校验其资源格式白名单、体积预算及 manifest.json。"""
    assets_dir = mod_dir / "assets"
    if not assets_dir.is_dir():
        return
    if cook_assets is not None:
        _, asset_diags, _ = cook_assets(mod_dir, check_only=True)
        for d in asset_diags:
            diags.append(DiagnosticItem(d.code, d.file, d.detail, d.fix_suggestion))


def collect_mod_uri_strings(obj: Any) -> list[str]:
    """递归收集数据对象中所有以 'mod://' 开头的资产 URI 字符串。"""
    found: list[str] = []
    if isinstance(obj, str):
        if obj.startswith("mod://"):
            found.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            found.extend(collect_mod_uri_strings(v))
    elif isinstance(obj, list):
        for item in obj:
            found.extend(collect_mod_uri_strings(item))
    return found


def resolve_mod_uri_path(mod_dir: Path, uri: str, pack_id: str = "") -> bool:
    """判断 mod:// 资产 URI 是否在模组内物理存在。"""
    clean_target = uri[6:].strip("/")
    if not clean_target:
        return False
    candidates = [clean_target]
    if pack_id and clean_target.startswith(pack_id + "/"):
        candidates.append(clean_target[len(pack_id) + 1 :])
    for rel in candidates:
        if (mod_dir / rel).is_file():
            return True
        if (mod_dir / "assets" / rel).is_file():
            return True
    return False


def _scan_json_refs(
    json_file: Path,
    rel_label: str,
    mod_dir: Path,
    pack_id: str,
    diags: list[DiagnosticItem],
) -> None:
    if not json_file.is_file():
        return
    try:
        payload = json.loads(json_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return
    for uri in collect_mod_uri_strings(payload):
        if not resolve_mod_uri_path(mod_dir, uri, pack_id):
            diags.append(
                DiagnosticItem(
                    code="ERR_ASSET_DANGLING_REF",
                    file_path=rel_label,
                    detail=f"{rel_label} 引用了不存在的资产: '{uri}'",
                    fix_suggestion="请确保资产文件已放置于 assets/ 对应路径，并运行 'kalar-mod cook' 生成清单",
                )
            )


def check_dangling_asset_refs(
    mod_dir: Path, diags: list[DiagnosticItem], pack_id: str = ""
) -> None:
    """校验 destinies.json、因果 DAG 与 content/ 中引用的 mod:// 资产是否存在于 assets/。"""
    _scan_json_refs(
        mod_dir / "destinies.json", "destinies.json", mod_dir, pack_id, diags
    )

    dag_dir = mod_dir / "dag_graphs"
    if dag_dir.is_dir():
        for df in sorted(dag_dir.glob("*.json")):
            _scan_json_refs(df, f"dag_graphs/{df.name}", mod_dir, pack_id, diags)

    content_dir = mod_dir / "content"
    if content_dir.is_dir():
        for cf in sorted(content_dir.rglob("*.json")):
            _scan_json_refs(
                cf,
                f"content/{cf.relative_to(content_dir).as_posix()}",
                mod_dir,
                pack_id,
                diags,
            )

    if (mod_dir / "assets").is_dir() and (mod_dir / "cutscenes").is_dir():
        for cs_file in sorted((mod_dir / "cutscenes").glob("*.json")):
            _scan_json_refs(
                cs_file, f"cutscenes/{cs_file.name}", mod_dir, pack_id, diags
            )


def validate_content_domain_payload(
    rel_str: str,
    cdata: dict[str, Any] | list[Any],
    diags: list[DiagnosticItem],
) -> None:
    """校验 content/ 子目录中各域扩展数据的顶层结构与契约键值。"""
    parts = rel_str.split("/")
    domain_dir = parts[1] if len(parts) >= 3 else ""
    if domain_dir in (
        "entities",
        "world",
        "events",
        "narratives",
        "copywriting",
    ) and not isinstance(cdata, dict):
        diags.append(
            DiagnosticItem(
                code="ERR_CONTENT_DOMAIN_SCHEMA",
                file_path=rel_str,
                detail=f"{rel_str} 属于 {domain_dir} 域，顶层必须为 JSON 对象 {{}}",
                fix_suggestion=f"请将 {rel_str} 根结构调整为符合 {domain_dir} Schema 的 JSON 对象",
            )
        )
    elif (
        domain_dir == "quests"
        and isinstance(cdata, dict)
        and not any(
            isinstance(cdata.get(k), (list, dict))
            for k in ("quests", "bounties", "chains", "templates")
        )
        and not cdata
    ):
        diags.append(
            DiagnosticItem(
                code="ERR_CONTENT_DOMAIN_SCHEMA",
                file_path=rel_str,
                detail=f"{rel_str} 任务包对象不可为空",
                fix_suggestion="请在 quests 定义中声明 quests / bounties / chains 等非空任务映射",
            )
        )


def check_content_directory(mod_dir: Path, diags: list[DiagnosticItem]) -> None:
    """校验 content/ 大魔改数据目录及其 JSON 实体定义的合法性。"""
    content_dir = mod_dir / "content"
    if not content_dir.is_dir():
        return

    content_files = sorted([p for p in content_dir.rglob("*") if p.is_file()])
    if not content_files:
        diags.append(
            DiagnosticItem(
                code="ERR_CONTENT_EMPTY",
                file_path="content",
                detail="content/ 目录已创建但未包含任何数据文件",
                fix_suggestion="请在 content/ 目录下放置合规的 JSON 数据定义文件，或移除空的 content/ 目录",
            )
        )
        return

    forbidden_exts = frozenset(
        {".exe", ".bat", ".cmd", ".sh", ".py", ".pyc", ".dll", ".so", ".bin", ".ps1"}
    )
    for cf in content_files:
        rel_str = f"content/{cf.relative_to(content_dir).as_posix()}"
        ext = cf.suffix.lower()
        if ext in forbidden_exts:
            diags.append(
                DiagnosticItem(
                    code="ERR_CONTENT_FORBIDDEN_FILE",
                    file_path=rel_str,
                    detail=f"content/ 目录严禁包含可执行或脚本文件: '{cf.name}'",
                    fix_suggestion="请将该文件移出 content/ 目录",
                )
            )
            continue
        if ext not in (".json", ".json5"):
            diags.append(
                DiagnosticItem(
                    code="ERR_CONTENT_INVALID_FORMAT",
                    file_path=rel_str,
                    detail=f"content/ 文件格式非法: '{cf.name}' (仅支持 .json)",
                    fix_suggestion="请将大魔改数据存储为合规的 .json 格式",
                )
            )
            continue
        try:
            cdata = json.loads(cf.read_text(encoding="utf-8"))
            if not isinstance(cdata, (dict, list)):
                diags.append(
                    DiagnosticItem(
                        code="ERR_CONTENT_NOT_OBJECT_OR_ARRAY",
                        file_path=rel_str,
                        detail=f"{rel_str} 顶层必须为 JSON 对象或列表",
                        fix_suggestion="请将该文件的根结构调整为 {} 或 []",
                    )
                )
            else:
                validate_content_domain_payload(rel_str, cdata, diags)
        except (json.JSONDecodeError, OSError) as exc:
            diags.append(
                DiagnosticItem(
                    code="ERR_CONTENT_JSON_INVALID",
                    file_path=rel_str,
                    detail=f"JSON 解析失败: {exc}",
                    fix_suggestion=f"请检查 {rel_str} 的语法正确性",
                )
            )
