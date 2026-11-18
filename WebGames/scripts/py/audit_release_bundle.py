#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 发行构建质量门禁 (Build & Release · 发布产物净度与 SDK 捆绑扫描)
# 文件路径: WebGames/scripts/py/audit_release_bundle.py
# 架构定位: Release Bundle Hygiene, Secret Leak & Mod SDK Integrity Scanner
# 依赖与触发: 触发方: audit_runner.py / package-webgames.{ps1,sh} | 上游: dist/ 发行产物 | 下游: CI 门禁
# 职责说明: 扫描发行打包目录中的禁运测试/归档/密钥/本机绝对路径残留，并可选校验随包分发的 mod_sdk 资产完整性。
# 退出语义与设计依据: 退出码: 0=净度与捆绑完整通过, 1=检出禁用残留、敏感泄漏或 SDK 缺失
# ------------------------------------------------------------------------------
# 用法示例:
#   python -X utf8 WebGames/scripts/py/audit_release_bundle.py --check-self
#   python -X utf8 WebGames/scripts/py/audit_release_bundle.py --dir WebGames/dist --require-sdk
# ==============================================================================
"""发行输出目录物理净度、凭证防泄漏与 `mod_sdk` 随包完整性审查器。"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

# ==============================================================================
# 一、禁运残留规则与路径扫描契约
# ==============================================================================
WEBGAMES_ROOT: Path = Path(__file__).resolve().parents[2]
FORBIDDEN_DIR_NAMES: frozenset[str] = frozenset({
    ".git",
    ".godot",
    ".import",
    ".pytest_cache",
    "__pycache__",
    "benchmarks",
    "tests",
})
FORBIDDEN_RELATIVE_PATHS: tuple[str, ...] = ("docs/归档库",)
FORBIDDEN_SECRET_NAMES: frozenset[str] = frozenset({".env", "credentials.json", "id_rsa", "id_ed25519"})
FORBIDDEN_SECRET_SUFFIXES: frozenset[str] = frozenset({".pem", ".key", ".p12", ".pfx", ".keystore"})
REQUIRED_SDK_RELPATHS: tuple[str, ...] = (
    "mod_sdk/capabilities.json",
    "mod_sdk/MOD_SPEC.md",
    "mod_sdk/schemas",
    "mod_sdk/tools/kalar_mod.py",
    "mod_sdk/templates/starter_story",
    "mod_sdk/examples/companion_ipc/README.md",
)
SCANNABLE_TEXT_SUFFIXES: frozenset[str] = frozenset({".json", ".jsonl", ".md", ".txt", ".cfg"})
REQUIRED_EXPORT_EXCLUDES: tuple[str, ...] = (
    "tests/*",
    "dev_harness/*",
    "benchmarks/*",
    "mods/*",
    "config/*",
    "mod_sdk/*",
    "scripts/*",
    "reports/*",
    "docs/*",
)
FORBIDDEN_PCK_MARKERS: tuple[bytes, ...] = (
    b"res://dev_harness/",
    b"res://mods/official_kalar/pack.json",
    b"res://config/domains/combat/mechanics.json",
)
DRIVE_OR_URI_RE: re.Pattern[str] = re.compile(r"(?<![A-Za-z0-9_])(?:[A-Za-z]:[/\\]{1,2}|file:" + r"///" + r")[A-Za-z0-9_.\-]+")


# ==============================================================================
# 二、发行目录扫描与脚本自检逻辑
# ==============================================================================
def scan_release_directory(release_dir: Path, require_sdk: bool) -> list[str]:
    """扫描打包输出目录，返回违禁残留、密钥或 SDK 缺失问题描述列表。"""
    if not release_dir.is_dir():
        return [f"发行目录不存在: {release_dir}"]
    violations: list[str] = []

    for rel_forbidden in FORBIDDEN_RELATIVE_PATHS:
        if (release_dir / rel_forbidden).exists():
            violations.append(f"[禁运归档目录残留] {rel_forbidden}")

    for walk_root, dir_names, file_names in os.walk(release_dir):
        current_root = Path(walk_root)
        for dirname in list(dir_names):
            if dirname in FORBIDDEN_DIR_NAMES:
                rel_dir = (current_root / dirname).relative_to(release_dir).as_posix()
                violations.append(f"[禁运工程目录残留] {rel_dir}")
                dir_names.remove(dirname)

        for filename in file_names:
            file_path = current_root / filename
            rel_file = file_path.relative_to(release_dir).as_posix()
            lower_name = filename.lower()
            if lower_name in FORBIDDEN_SECRET_NAMES or lower_name.startswith(".env.") or file_path.suffix.lower() in FORBIDDEN_SECRET_SUFFIXES:
                violations.append(f"[敏感凭证文件泄漏] {rel_file}")
                continue
            if file_path.suffix.lower() in {".pck", ".exe"}:
                raw_blob = file_path.read_bytes()
                for marker in FORBIDDEN_PCK_MARKERS:
                    if marker in raw_blob:
                        violations.append(f"[PCK 包体明文/调试残留] {rel_file} 包含 {marker.decode('ascii')}")
                continue
            if file_path.suffix.lower() in SCANNABLE_TEXT_SUFFIXES and file_path.stat().st_size <= 512 * 1024:
                text_content = file_path.read_text(encoding="utf-8", errors="ignore")
                if DRIVE_OR_URI_RE.search(text_content):
                    violations.append(f"[本机绝对路径或本地 URI 泄漏] {rel_file}")

    if require_sdk:
        for sdk_rel in REQUIRED_SDK_RELPATHS:
            if not (release_dir / sdk_rel).exists():
                violations.append(f"[SDK 捆绑缺失] {sdk_rel}")
    return violations


def run_packaging_wiring_self_check() -> list[str]:
    """校验双平台打包脚本已接线 release_bundle 审计、SDK 同步检查与构建前检。"""
    violations: list[str] = []
    targets: tuple[tuple[Path, str], ...] = (
        (WEBGAMES_ROOT / "scripts" / "ps1" / "package-webgames.ps1", "audit_release_bundle.py"),
        (WEBGAMES_ROOT / "scripts" / "sh" / "package-webgames.sh", "audit_release_bundle.py"),
        (WEBGAMES_ROOT / "scripts" / "ps1" / "package-webgames.ps1", "sync_mod_sdk.py"),
        (WEBGAMES_ROOT / "scripts" / "sh" / "package-webgames.sh", "sync_mod_sdk.py"),
        (WEBGAMES_ROOT / "scripts" / "ps1" / "package-webgames.ps1", "build_kalar_mod_binary.py"),
        (WEBGAMES_ROOT / "scripts" / "sh" / "package-webgames.sh", "build_kalar_mod_binary.py"),
    )
    for target_file, required_token in targets:
        if not target_file.is_file():
            violations.append(f"[缺失打包脚本] {target_file.name}")
            continue
        script_text = target_file.read_text(encoding="utf-8", errors="ignore")
        if required_token not in script_text:
            violations.append(f"[未接线 {required_token}] {target_file.name}")

    export_presets = WEBGAMES_ROOT / "export_presets.cfg"
    if not export_presets.is_file():
        violations.append("[缺失导出预设] export_presets.cfg")
    else:
        preset_text = export_presets.read_text(encoding="utf-8", errors="ignore")
        preset_names = re.findall(r'^name="([^"]+)"', preset_text, re.MULTILINE)
        for required_preset in ("Windows Desktop", "Linux", "Web"):
            if required_preset not in preset_names:
                violations.append(f"[export_presets.cfg 缺失目标预设] {required_preset}")
        filter_matches = re.findall(r'^exclude_filter="([^"]*)"', preset_text, re.MULTILINE)
        if not filter_matches:
            violations.append("[export_presets.cfg 缺失 exclude_filter 配置]")
        for preset_idx, raw_filter in enumerate(filter_matches):
            excluded_tokens = {item.strip() for item in raw_filter.split(",") if item.strip()}
            for required_excl in REQUIRED_EXPORT_EXCLUDES:
                if required_excl not in excluded_tokens:
                    violations.append(f"[export_presets.cfg preset.{preset_idx} exclude_filter 缺失排除项] {required_excl}")
    return violations


# ==============================================================================
# 三、CLI 入口与结构化输出
# ==============================================================================
def _parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="发行打包产物净度与 mod_sdk 完整性审计")
    parser.add_argument("--dir", dest="release_dir", default=None, help="待审计的发行产物根目录")
    parser.add_argument("--require-sdk", action="store_true", help="强制要求发行包内含完整 mod_sdk 分发资产")
    parser.add_argument("--check-self", action="store_true", help="验证打包双脚本接线完整性")
    parser.add_argument("--json", action="store_true", dest="as_json", help="输出结构化 JSON 结果")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """门禁主入口函数。"""
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = _parse_arguments(argv)
    violations: list[str] = []
    if args.check_self or args.release_dir is None:
        violations.extend(run_packaging_wiring_self_check())
    if args.release_dir is not None:
        violations.extend(scan_release_directory(Path(args.release_dir).resolve(), bool(args.require_sdk)))

    report: dict[str, Any] = {
        "valid": len(violations) == 0,
        "release_dir": args.release_dir,
        "require_sdk": bool(args.require_sdk),
        "violations": violations,
    }
    if args.as_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print("=" * 80)
        print("📦 WebGames 发行包物理净度与 SDK 捆绑门禁 (T-REL-BUNDLE)")
        for issue in violations:
            print(f"  ✗ {issue}")
        conclusion = "通过（发行打包接线与物理净度 100% 合规）" if not violations else f"未通过（检出 {len(violations)} 项违规）"
        print(f"【审查结论】{conclusion}")
    return 0 if not violations else 1


if __name__ == "__main__":
    raise SystemExit(main())
