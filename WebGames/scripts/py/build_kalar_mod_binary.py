#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 构建与发布工具链 (Build & Release · MOD CLI 独立可执行打包)
# 文件路径: WebGames/scripts/py/build_kalar_mod_binary.py
# 架构定位: Standalone Executable Packager for `kalar_mod.py` via PyInstaller
# 依赖与触发: 触发方: 开发者 CLI / package-webgames.{ps1,sh} | 上游: mod_sdk/tools/ | 下游: dist/kalar-mod
# 职责说明: 校验 kalar_mod.py 及其工具链模块与契约资产完整性，生成确定性 PyInstaller 参数并可选产出单文件可执行程序。
# 退出语义与设计依据: 退出码: 0=校验或构建成功, 1=源资产缺失或 PyInstaller 缺失/失败 | 默认写入系统临时构建区外显指定目录
# ------------------------------------------------------------------------------
# 用法示例:
#   python -X utf8 WebGames/scripts/py/build_kalar_mod_binary.py --check
#   python -X utf8 WebGames/scripts/py/build_kalar_mod_binary.py --dry-run --json
#   python -X utf8 WebGames/scripts/py/build_kalar_mod_binary.py --dist-dir ./build/sdk-bin
# ==============================================================================
"""使用 PyInstaller 将 `kalar_mod.py` 构建为独立跨平台 `kalar-mod` 可执行 CLI。"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

# ==============================================================================
# 一、路径常量与捆绑清单定义
# ==============================================================================
WEBGAMES_ROOT: Path = Path(__file__).resolve().parents[2]
MOD_SDK_ROOT: Path = WEBGAMES_ROOT / "mod_sdk"
TOOLS_ROOT: Path = MOD_SDK_ROOT / "tools"
SCRIPTS_PY_LIB: Path = WEBGAMES_ROOT / "scripts" / "py" / "lib"
ENTRYPOINT_SCRIPT: Path = TOOLS_ROOT / "kalar_mod.py"

REQUIRED_HIDDEN_IMPORTS: tuple[str, ...] = (
    "check_mod",
    "check_mod_common",
    "check_mod_dag",
    "check_mod_destiny",
    "check_mod_multi",
    "check_mod_schema",
    "cook_assets",
    "kalar_config_compiler",
    "kalar_protocol_client",
    "kalar_workbench",
    "kdat_payload_codec",
    "kmod_bundler",
    "mod_sdk_render",
    "mod_sdk_shared",
    "play_mod",
    "play_mod_character",
    "play_mod_common",
    "play_mod_interactive",
    "preview_mod",
    "scaffold_mod",
)


# ==============================================================================
# 二、源码完整性校验与 PyInstaller 命令构造
# ==============================================================================
def verify_sdk_sources() -> dict[str, Any]:
    """校验入口脚本、工具子模块、schemas、templates 与 PyInstaller 环境就绪状态。"""
    missing_assets: list[str] = []
    required_paths = [
        ENTRYPOINT_SCRIPT,
        MOD_SDK_ROOT / "capabilities.json",
        MOD_SDK_ROOT / "schemas",
        MOD_SDK_ROOT / "templates" / "starter_story",
        SCRIPTS_PY_LIB / "kdat_payload_codec.py",
    ]
    for item_path in required_paths:
        if not item_path.exists():
            missing_assets.append(item_path.relative_to(WEBGAMES_ROOT).as_posix())

    for module_name in REQUIRED_HIDDEN_IMPORTS:
        in_tools = (TOOLS_ROOT / f"{module_name}.py").is_file()
        in_lib = (SCRIPTS_PY_LIB / f"{module_name}.py").is_file()
        if not (in_tools or in_lib):
            missing_assets.append(f"python-module:{module_name}.py")

    pyinstaller_spec = importlib.util.find_spec("PyInstaller")
    return {
        "sources_valid": len(missing_assets) == 0,
        "pyinstaller_available": pyinstaller_spec is not None,
        "missing_assets": missing_assets,
        "entrypoint": ENTRYPOINT_SCRIPT.relative_to(WEBGAMES_ROOT).as_posix(),
        "hidden_imports": list(REQUIRED_HIDDEN_IMPORTS),
    }


def build_pyinstaller_arguments(
    dist_dir: Path,
    work_dir: Path,
    spec_dir: Path,
    binary_name: str,
    onedir: bool,
    clean: bool,
) -> list[str]:
    """组装跨平台确定性 PyInstaller 调用参数列表。"""
    data_sep = os.pathsep
    add_data_entries = [
        f"{MOD_SDK_ROOT / 'capabilities.json'}{data_sep}mod_sdk",
        f"{MOD_SDK_ROOT / 'schemas'}{data_sep}mod_sdk/schemas",
        f"{MOD_SDK_ROOT / 'templates'}{data_sep}mod_sdk/templates",
    ]
    arguments: list[str] = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--console",
        "--name",
        binary_name,
        "--onedir" if onedir else "--onefile",
        "--distpath",
        str(dist_dir),
        "--workpath",
        str(work_dir),
        "--specpath",
        str(spec_dir),
        "--paths",
        str(TOOLS_ROOT),
        "--paths",
        str(SCRIPTS_PY_LIB),
    ]
    if clean:
        arguments.append("--clean")
    for hidden_name in REQUIRED_HIDDEN_IMPORTS:
        arguments.extend(["--hidden-import", hidden_name])
    for data_entry in add_data_entries:
        arguments.extend(["--add-data", data_entry])
    arguments.append(str(ENTRYPOINT_SCRIPT))
    return arguments


# ==============================================================================
# 三、CLI 入口与执行分发
# ==============================================================================
def _parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="构建 kalar-mod 独立跨平台 CLI 可执行文件")
    parser.add_argument("--dist-dir", default=str(Path(tempfile.gettempdir()) / "kalar-mod-dist"), help="可执行文件输出目录")
    parser.add_argument("--work-dir", default=str(Path(tempfile.gettempdir()) / "kalar-mod-work"), help="PyInstaller 临时编译目录")
    parser.add_argument("--spec-dir", default=str(Path(tempfile.gettempdir()) / "kalar-mod-spec"), help=".spec 文件生成目录")
    parser.add_argument("--name", default="kalar-mod", help="目标可执行文件名称（默认 kalar-mod）")
    parser.add_argument("--onedir", action="store_true", help="使用目录模式替代单文件模式")
    parser.add_argument("--clean", action="store_true", help="构建前清理 PyInstaller 缓存")
    parser.add_argument("--check", action="store_true", help="仅校验源码完整性与 PyInstaller 依赖就绪度")
    parser.add_argument("--dry-run", action="store_true", help="校验依赖并输出完整 PyInstaller 构建命令，不实际编译")
    parser.add_argument("--json", action="store_true", dest="as_json", help="输出结构化 JSON 诊断或构建摘要")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """独立二进制构建管道入口函数。"""
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = _parse_arguments(argv)
    probe_report = verify_sdk_sources()

    dist_dir = Path(args.dist_dir).resolve()
    work_dir = Path(args.work_dir).resolve()
    spec_dir = Path(args.spec_dir).resolve()
    command = build_pyinstaller_arguments(dist_dir, work_dir, spec_dir, args.name, args.onedir, args.clean)
    payload: dict[str, Any] = {
        **probe_report,
        "mode": "check" if args.check else ("dry_run" if args.dry_run else "build"),
        "dist_dir": str(dist_dir),
        "command": command,
    }

    ready = bool(probe_report["sources_valid"]) and bool(probe_report["pyinstaller_available"])
    if args.check or args.dry_run:
        if args.as_json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            status_label = "READY" if ready else "BLOCKED"
            print(f"[build-kalar-mod] status={status_label} mode={payload['mode']} entry={probe_report['entrypoint']}")
        return 0 if ready else 1

    if not ready:
        if args.as_json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            print("[build-kalar-mod] missing sources or PyInstaller", file=sys.stderr)
        return 1

    completed = subprocess.run(command, check=False)
    payload["returncode"] = completed.returncode
    if args.as_json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
