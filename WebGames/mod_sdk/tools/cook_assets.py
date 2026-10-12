#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · DevKit Tools)
# 文件路径: WebGames/mod_sdk/tools/cook_assets.py
# 架构定位: MOD资产预编译与审计工具 (Asset Cooker & Auditor)
# 依赖与触发: 触发方: CLI / kalar_mod / CI | 上游: MOD assets/ 目录 | 下游: assets/manifest.json / 审计报告 | 运行时: Python 3.10+
# 职责说明: 纯静态扫描 assets/ 资源文件，校验格式白名单、安全可执行拦截与体积预算，自动生成/校验 manifest.json
# 退出语义与设计依据: 退出码: 0=合规通过/生成成功, 1=发现违规错误/清单不匹配, 2=参数/IO错误 | 设计依据: 《卡拉尔数据契约规范 v1.0》与第一性原理
# ------------------------------------------------------------------------------
# 用法示例:
#   python mod_sdk/tools/cook_assets.py ./my_mod
#   python mod_sdk/tools/cook_assets.py ./my_mod --check
#   python mod_sdk/tools/cook_assets.py ./my_mod --check --json
# ==============================================================================
"""MOD 资产预编译与审计工具：扫描 assets/ 目录，校验格式白名单、体积预算与可执行拦截，自动生成或校验 manifest.json。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

# ==============================================================================
# 一、资产白名单与体积预算常量 (Asset Whitelist & Budgets)
# ==============================================================================
# 单图 <= 15MB, 单音 <= 30MB, 字体/着色器 <= 10MB
ASSET_WHITELIST: dict[str, tuple[str, int]] = {
    ".png": ("image", 15 * 1024 * 1024),
    ".webp": ("image", 15 * 1024 * 1024),
    ".ogg": ("audio", 30 * 1024 * 1024),
    ".wav": ("audio", 30 * 1024 * 1024),
    ".ttf": ("font", 10 * 1024 * 1024),
    ".otf": ("font", 10 * 1024 * 1024),
    ".gdshader": ("shader", 10 * 1024 * 1024),
    ".gltf": ("model", 30 * 1024 * 1024),
    ".glb": ("model", 30 * 1024 * 1024),
}

FORBIDDEN_EXTENSIONS: frozenset[str] = frozenset({
    ".exe", ".bat", ".cmd", ".sh", ".py", ".pyc", ".pyd", ".dll", ".so",
    ".dylib", ".bin", ".com", ".vbs", ".js", ".msi", ".ps1", ".scr", ".elf",
})


def _ensure_utf8_stdout() -> None:
    """保障跨平台 UTF-8 控制台输出，防止 Windows GBK 编码崩溃。"""
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


# ==============================================================================
# 二、诊断模型与哈希计算 (Diagnostic Item & Hashing)
# ==============================================================================
class DiagnosticItem:
    """结构化诊断发现项。"""

    def __init__(self, code: str, file_path: str, detail: str, fix_suggestion: str) -> None:
        self.code = code
        self.file = file_path
        self.detail = detail
        self.fix_suggestion = fix_suggestion

    def to_dict(self) -> dict[str, str]:
        return {"code": self.code, "file": self.file, "detail": self.detail, "fix_suggestion": self.fix_suggestion}


def _compute_sha256(file_path: Path) -> str:
    """流式分块计算文件 SHA-256 哈希值，避免大文件堆分配溢出。"""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as fp:
        while chunk := fp.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


# ==============================================================================
# 三、核心资产扫描与预算审计流水线 (Asset Audit Engine)
# ==============================================================================
def _audit_single_asset_file(
    file_path: Path,
    assets_dir: Path,
    diags: list[DiagnosticItem],
) -> dict[str, Any] | None:
    """审计单个资产文件的安全性、白名单类型与体积预算。"""
    rel_path_str = file_path.relative_to(assets_dir).as_posix()
    disp_path = f"assets/{rel_path_str}"
    ext = file_path.suffix.lower()

    if ext in FORBIDDEN_EXTENSIONS:
        diags.append(DiagnosticItem(
            code="ERR_ASSET_EXECUTABLE_REJECTED",
            file_path=disp_path,
            detail=f"assets/ 目录严禁包含可执行或脚本文件: '{file_path.name}' (扩展名: {ext})",
            fix_suggestion="请立即将可执行或脚本文件移出 assets/ 目录，模组仅允许合法媒体与着色器资源",
        ))
        return None

    if ext not in ASSET_WHITELIST:
        diags.append(DiagnosticItem(
            code="ERR_ASSET_DISALLOWED_TYPE",
            file_path=disp_path,
            detail=f"资产文件格式非法: '{file_path.name}' (扩展名: '{ext}')，不属于受信任白名单",
            fix_suggestion="仅支持格式: .png, .webp, .ogg, .wav, .ttf, .otf, .gdshader；请转码或移出",
        ))
        return None

    file_size = file_path.stat().st_size
    if file_size == 0:
        diags.append(DiagnosticItem(
            code="ERR_ASSET_ZERO_BYTE",
            file_path=disp_path,
            detail=f"资产文件为空 (0 字节): '{file_path.name}'",
            fix_suggestion="请填充有效资产内容或删除空文件",
        ))
        return None

    asset_type, max_bytes = ASSET_WHITELIST[ext]
    if file_size > max_bytes:
        max_mb = max_bytes // (1024 * 1024)
        actual_mb = round(file_size / (1024 * 1024), 2)
        diags.append(DiagnosticItem(
            code="ERR_ASSET_SIZE_EXCEEDED",
            file_path=disp_path,
            detail=f"资产体积超限: '{file_path.name}' 大小为 {actual_mb}MB，超过单文件上限 {max_mb}MB",
            fix_suggestion=f"请压缩资产质量或降低分辨率，使其收敛至 {max_mb}MB 以内",
        ))
        return None

    sha256_hash = _compute_sha256(file_path)
    return {
        "path": rel_path_str,
        "type": asset_type,
        "size_bytes": file_size,
        "sha256": sha256_hash,
    }


def _verify_manifest_consistency(
    manifest_file: Path,
    expected_data: dict[str, Any],
    diags: list[DiagnosticItem],
) -> None:
    """校验磁盘现有 manifest.json 与实际计算出的资产清单的一致性。"""
    if not manifest_file.is_file():
        diags.append(DiagnosticItem(
            code="ERR_ASSET_MANIFEST_MISSING",
            file_path="assets/manifest.json",
            detail="缺少 assets/manifest.json 资产清单文件",
            fix_suggestion="请运行 'kalar-mod cook' 或 'cook_assets.py' 自动生成资产清单",
        ))
        return

    try:
        on_disk = json.loads(manifest_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as err:
        diags.append(DiagnosticItem(
            code="ERR_ASSET_MANIFEST_INVALID",
            file_path="assets/manifest.json",
            detail=f"assets/manifest.json 解析损坏: {err}",
            fix_suggestion="请修复 JSON 语法或运行 'kalar-mod cook' 重新生成",
        ))
        return

    if not isinstance(on_disk, dict):
        diags.append(DiagnosticItem(
            code="ERR_ASSET_MANIFEST_INVALID",
            file_path="assets/manifest.json",
            detail="assets/manifest.json 顶层必须为 JSON 对象",
            fix_suggestion="请运行 'kalar-mod cook' 重新生成标准格式清单",
        ))
        return

    disk_assets = on_disk.get("assets")
    expected_assets = expected_data.get("assets", [])
    if not isinstance(disk_assets, list) or len(disk_assets) != len(expected_assets):
        diags.append(DiagnosticItem(
            code="ERR_ASSET_MANIFEST_OUTDATED",
            file_path="assets/manifest.json",
            detail=f"assets/manifest.json 记录文件数 ({len(disk_assets) if isinstance(disk_assets, list) else 0}) 与实际文件数 ({len(expected_assets)}) 不一致",
            fix_suggestion="请重新运行 'kalar-mod cook' 更新资产清单",
        ))
        return

    disk_map = {item.get("path"): item for item in disk_assets if isinstance(item, dict)}
    for exp in expected_assets:
        target_path = exp["path"]
        if target_path not in disk_map:
            diags.append(DiagnosticItem(
                code="ERR_ASSET_MANIFEST_OUTDATED",
                file_path="assets/manifest.json",
                detail=f"清单中缺少新增资产条目: '{target_path}'",
                fix_suggestion="请运行 'kalar-mod cook' 更新资产清单",
            ))
            return
        disk_item = disk_map[target_path]
        if disk_item.get("sha256") != exp["sha256"] or disk_item.get("size_bytes") != exp["size_bytes"]:
            diags.append(DiagnosticItem(
                code="ERR_ASSET_MANIFEST_OUTDATED",
                file_path="assets/manifest.json",
                detail=f"资产文件 '{target_path}' 内容已变更，但 manifest.json 中哈希或体积未更新",
                fix_suggestion="请运行 'kalar-mod cook' 重新计算并同步资产清单",
            ))
            return


def cook_assets(
    mod_dir: Path,
    check_only: bool = False,
) -> tuple[bool, list[DiagnosticItem], dict[str, Any]]:
    """扫描、审计并预编译 assets/ 目录生成 manifest.json。
    
    参数:
        mod_dir: MOD 项目根目录
        check_only: 是否处于门禁审计模式（只读校验，不写回文件）
        
    返回:
        (是否合规通过, 诊断列表, 资产清单数据字典)
    """
    diags: list[DiagnosticItem] = []
    assets_dir = mod_dir / "assets"

    empty_manifest: dict[str, Any] = {
        "manifest_version": "1.0.0",
        "asset_count": 0,
        "total_size_bytes": 0,
        "assets": [],
    }

    if not assets_dir.is_dir():
        return True, diags, empty_manifest

    manifest_file = assets_dir / "manifest.json"
    asset_records: list[dict[str, Any]] = []

    # 递归扫描 assets 目录下所有文件
    all_files = sorted([p for p in assets_dir.rglob("*") if p.is_file()])
    for f in all_files:
        if f.resolve() == manifest_file.resolve():
            continue
        rec = _audit_single_asset_file(f, assets_dir, diags)
        if rec is not None:
            asset_records.append(rec)

    asset_records.sort(key=lambda x: str(x["path"]))
    manifest_data: dict[str, Any] = {
        "manifest_version": "1.0.0",
        "asset_count": len(asset_records),
        "total_size_bytes": sum(int(r["size_bytes"]) for r in asset_records),
        "assets": asset_records,
    }

    if diags:
        return False, diags, manifest_data

    if check_only:
        _verify_manifest_consistency(manifest_file, manifest_data, diags)
        return len(diags) == 0, diags, manifest_data

    # 非 check 模式：写回 manifest.json
    try:
        content = json.dumps(manifest_data, ensure_ascii=False, indent=2) + "\n"
        with open(manifest_file, "w", encoding="utf-8", newline="\n") as fp:
            fp.write(content)
    except OSError as err:
        diags.append(DiagnosticItem(
            code="ERR_ASSET_MANIFEST_WRITE",
            file_path="assets/manifest.json",
            detail=f"写入 manifest.json 失败: {err}",
            fix_suggestion="请检查目录写入权限并重试",
        ))
        return False, diags, manifest_data

    return True, diags, manifest_data


# ==============================================================================
# 四、控制台输出报告与 CLI 入口 (CLI Reporting & Entry Point)
# ==============================================================================
def print_cook_report(
    valid: bool,
    diags: list[DiagnosticItem],
    manifest: dict[str, Any],
    mod_dir: Path,
    check_only: bool,
) -> None:
    """输出格式化资产预编译/审计报告。"""
    print("==============================================================================")
    action_label = "资产审计门禁" if check_only else "资产预编译与审计"
    print(f"📦 卡拉尔 MOD {action_label}: {mod_dir.resolve().name}")
    print("------------------------------------------------------------------------------")
    if valid:
        print("  🎉 审计结论: 100% 合规通过！")
        print(f"  • 资源总数   : {manifest.get('asset_count', 0)} 个文件")
        total_kb = round(manifest.get('total_size_bytes', 0) / 1024, 2)
        print(f"  • 总体积     : {total_kb} KB")
        if check_only:
            print("  • 清单校验   : assets/manifest.json 与实际文件哈希 100% 吻合")
        else:
            print("  • 清单写入   : 已生成/更新 assets/manifest.json")
        print("==============================================================================")
        return

    print(f"  ❌ 发现 {len(diags)} 处资产违规或清单不匹配:\n")
    for idx, d in enumerate(diags, start=1):
        print(f"  [{idx}] [{d.code}] 路径: {d.file}")
        print(f"      • 详情: {d.detail}")
        print(f"      • 建议: {d.fix_suggestion}\n")
    print("==============================================================================")


def main() -> None:
    """命令行主入口。"""
    _ensure_utf8_stdout()
    parser = argparse.ArgumentParser(
        description="卡拉尔 MOD 资产预编译与审计工具 (Asset Cooker & Auditor)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("mod_dir", nargs="?", default=".", help="待审计/预编译的 MOD 根目录路径 (默认: 当前目录)")
    parser.add_argument(
        "--check",
        action="store_true",
        dest="check_only",
        help="以只读门禁模式运行：校验格式白名单、体积预算与 manifest.json 是否最新，不写回文件",
    )
    parser.add_argument("--json", action="store_true", dest="as_json", help="输出机器可读的结构化 JSON 报告")

    args = parser.parse_args()
    target_dir = Path(args.mod_dir).resolve()

    if not target_dir.is_dir():
        err_msg = f"MOD 目标目录不存在: {target_dir}"
        if args.as_json:
            print(json.dumps({"valid": False, "error": err_msg}, ensure_ascii=False))
        else:
            print(f"❌ 错误: {err_msg}", file=sys.stderr)
        sys.exit(2)

    valid, diags, manifest = cook_assets(target_dir, check_only=args.check_only)

    if args.as_json:
        payload = {
            "valid": valid,
            "mod_dir": str(target_dir),
            "check_only": args.check_only,
            "asset_count": manifest.get("asset_count", 0),
            "total_size_bytes": manifest.get("total_size_bytes", 0),
            "diagnostics": [d.to_dict() for d in diags],
            "manifest": manifest,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_cook_report(valid, diags, manifest, target_dir, args.check_only)

    sys.exit(0 if valid else 1)


if __name__ == "__main__":
    main()
