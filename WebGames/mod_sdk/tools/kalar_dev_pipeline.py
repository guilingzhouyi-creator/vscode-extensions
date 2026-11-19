#!/usr/bin/env python3
# ==============================================================================
# 模块归属: MOD扩展生态与开发者工具链 (Mod SDK · 调试封装一体化流水线)
# 文件路径: WebGames/mod_sdk/tools/kalar_dev_pipeline.py
# 架构定位: Unified Dev/Inspect/Install Orchestrator for `kalar_mod` CLI
# 依赖与触发: 触发方: kalar_mod.py | 上游: check_mod, cook_assets, preview_mod, kmod_bundler | 下游: .kmod 产物与 mods/ 目录
# 职责说明: 提供 dev（JSON 调试验证 + 烹饪 + 无头推演 + .kmod 二进制封装 + 安装）、inspect（段摘要检查
#           与 JSON 工作区还原）以及 install（.kmod 安全验签安装）核心编排逻辑。
# 退出语义与设计依据: 退出码: 0=成功, 1=校验/编译失败, 2=路径缺失 | 依据: 《卡拉尔数据契约规范》
# ==============================================================================
"""kalar_dev_pipeline.py — 模组调试(JSON)与正式二进制(.kmod)一体化流水线控制器。"""

from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
import shutil
import sys
from typing import Any

TOOLS_DIR = Path(__file__).resolve().parent
SCRIPTS_PY_LIB = TOOLS_DIR.parent.parent / "scripts" / "py" / "lib"
for _p in (str(TOOLS_DIR), str(SCRIPTS_PY_LIB)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from check_mod import print_cli_report, validate_mod
from cook_assets import cook_assets, print_cook_report
from kmod_bundler import build_kmod_package, inspect_kmod_package, verify_kmod_package
from preview_mod import simulate_mod


def install_mod_source(
    source_path: Path, mods_root: Path, force: bool
) -> tuple[str, str, Path]:
    """校验并安装 .kmod 二进制归档包或 MOD JSON 源目录到目标 mods/ 目录。"""
    if source_path.is_file() and source_path.suffix.lower() == ".kmod":
        ok, manifest, errors = verify_kmod_package(source_path)
        if not ok:
            raise ValueError("正式 .kmod 归档校验失败: " + " | ".join(errors))
        pack_id = str(manifest.get("pack_id") or source_path.stem).strip()
        if not pack_id or any(tok in pack_id for tok in ("/", "\\", "..")):
            raise ValueError(f"非法 pack_id: {pack_id}")
        dest_path = mods_root / source_path.name
        if dest_path.exists() and not force:
            raise FileExistsError(f"目标已存在（可加 --force 覆盖）: {dest_path}")
        shutil.copy2(source_path, dest_path)
        return pack_id, "kmod", dest_path
    if source_path.is_dir():
        manifest_file = source_path / "pack.json"
        if not manifest_file.is_file():
            raise ValueError("MOD 源目录缺少 pack.json")
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        pack_id = str(manifest.get("pack_id", source_path.name)).strip()
        if not pack_id or any(tok in pack_id for tok in ("/", "\\", "..")):
            raise ValueError(f"非法 pack_id: {pack_id}")
        dest_path = mods_root / pack_id
        if dest_path.exists():
            if not force:
                raise FileExistsError(f"目标已存在（可加 --force 覆盖）: {dest_path}")
            shutil.rmtree(dest_path)
        shutil.copytree(source_path, dest_path)
        return pack_id, "directory", dest_path
    raise ValueError("仅支持安装 .kmod 归档包或含 pack.json 的 MOD 调试目录")


def handle_install_cli(args: Any, tools_dir: Path) -> int:
    """处理 install 子命令：安装 .kmod 归档包或调试目录。"""
    source_path = Path(args.source).resolve()
    mods_root = (
        Path(args.mods_dir).resolve()
        if args.mods_dir
        else (tools_dir.parent.parent / "mods").resolve()
    )
    mods_root.mkdir(parents=True, exist_ok=True)
    if not source_path.exists():
        msg = f"安装源不存在: {source_path}"
        print(
            json.dumps({"success": False, "error": msg}, ensure_ascii=False)
            if args.as_json
            else f"❌ {msg}"
        )
        return 1
    try:
        pack_id, install_kind, dest_path = install_mod_source(
            source_path, mods_root, args.force
        )
    except Exception as exc:
        print(
            json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False)
            if args.as_json
            else f"❌ MOD 安装失败: {exc}",
            file=sys.stdout if args.as_json else sys.stderr,
        )
        return 1
    payload = {
        "success": True,
        "pack_id": pack_id,
        "install_kind": install_kind,
        "installed_path": str(dest_path),
    }
    print(
        json.dumps(payload, ensure_ascii=False, indent=2)
        if args.as_json
        else f"✅ MOD 安装成功: {pack_id} ({install_kind}) -> {dest_path}"
    )
    return 0


def _run_simulate_stage(target_dir: Path, as_json: bool) -> dict[str, Any]:
    if as_json:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = simulate_mod(
                target_dir, race_id="HUMAN", player_name="Tester", as_json=True
            )
        raw = buf.getvalue().strip()
        return {
            "stage": "simulate",
            "passed": rc == 0,
            "simulation": json.loads(raw) if raw else {},
        }
    rc = simulate_mod(target_dir, race_id="HUMAN", player_name="Tester", as_json=False)
    return {"stage": "simulate", "passed": rc == 0}


def handle_dev_cli(args: Any, tools_dir: Path) -> int:
    """处理 dev 子命令：调试(JSON)与正式二进制封装(.kmod/.kdat)一体化流水线。"""
    target_dir = Path(args.mod_dir).resolve()
    if not target_dir.is_dir():
        msg = f"MOD 调试目录不存在: {target_dir}"
        print(
            json.dumps({"success": False, "error": msg}, ensure_ascii=False)
            if args.as_json
            else f"❌ 错误: {msg}",
            file=sys.stdout if args.as_json else sys.stderr,
        )
        return 2

    stages: list[dict[str, Any]] = []
    valid_mod, check_diags = validate_mod(target_dir)
    stages.append(
        {"stage": "check", "passed": valid_mod, "error_count": len(check_diags)}
    )
    if not valid_mod:
        if args.as_json:
            print(
                json.dumps(
                    {
                        "success": False,
                        "stages": stages,
                        "diagnostics": [d.to_dict() for d in check_diags],
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
        else:
            print_cli_report(valid_mod, check_diags, target_dir)
        return 1

    if (target_dir / "assets").is_dir():
        valid_assets, asset_diags, asset_manifest = cook_assets(
            target_dir, check_only=False
        )
        stages.append(
            {
                "stage": "cook",
                "passed": valid_assets,
                "asset_count": asset_manifest.get("asset_count", 0),
            }
        )
        if not valid_assets:
            if args.as_json:
                print(
                    json.dumps(
                        {
                            "success": False,
                            "stages": stages,
                            "diagnostics": [d.to_dict() for d in asset_diags],
                        },
                        ensure_ascii=False,
                        indent=2,
                    )
                )
            else:
                print_cook_report(
                    valid_assets, asset_diags, asset_manifest, target_dir, False
                )
            return 1

    if args.simulate:
        sim_stage = _run_simulate_stage(target_dir, args.as_json)
        stages.append(sim_stage)
        if not sim_stage["passed"]:
            if args.as_json:
                print(
                    json.dumps(
                        {"success": False, "stages": stages},
                        ensure_ascii=False,
                        indent=2,
                    )
                )
            return 1

    pack_output: dict[str, Any] | None = None
    if args.pack or args.install or args.output:
        out_p = Path(args.output).resolve() if args.output else None
        build_ok, built_kmod, build_errs = build_kmod_package(target_dir, out_p)
        if not build_ok or built_kmod is None:
            print(
                json.dumps(
                    {"success": False, "stages": stages, "error": build_errs},
                    ensure_ascii=False,
                    indent=2,
                )
                if args.as_json
                else f"❌ 编译打包失败: {' | '.join(build_errs)}",
                file=sys.stdout if args.as_json else sys.stderr,
            )
            return 1
        verify_ok, verified_manifest, verify_errs = verify_kmod_package(built_kmod)
        stages.append(
            {
                "stage": "pack_and_verify",
                "passed": verify_ok,
                "kmod_path": str(built_kmod),
            }
        )
        if not verify_ok:
            print(
                json.dumps(
                    {"success": False, "stages": stages, "error": verify_errs},
                    ensure_ascii=False,
                    indent=2,
                )
                if args.as_json
                else f"❌ 校验失败: {' | '.join(verify_errs)}",
                file=sys.stdout if args.as_json else sys.stderr,
            )
            return 1
        pack_output = {
            "kmod_path": str(built_kmod),
            "pack_id": verified_manifest.get("pack_id", ""),
            "version": verified_manifest.get("version", ""),
            "content_sha256": verified_manifest.get("content_sha256", ""),
            "size_bytes": built_kmod.stat().st_size,
        }
        if args.install:
            mods_root = (
                Path(args.mods_dir).resolve()
                if args.mods_dir
                else (tools_dir.parent.parent / "mods").resolve()
            )
            mods_root.mkdir(parents=True, exist_ok=True)
            p_id, kind, dest_p = install_mod_source(built_kmod, mods_root, args.force)
            stages.append(
                {
                    "stage": "install",
                    "passed": True,
                    "pack_id": p_id,
                    "install_kind": kind,
                    "installed_path": str(dest_p),
                }
            )

    if args.as_json:
        print(
            json.dumps(
                {
                    "success": True,
                    "mode": "dev_pipeline",
                    "mod_dir": str(target_dir),
                    "stages": stages,
                    "package": pack_output,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    print(f"✅ MOD 调试与封装一体化流水线 PASS [{target_dir.name}]")
    if pack_output:
        print(
            f"  • 正式二进制产物: {pack_output['kmod_path']} (sha256={str(pack_output['content_sha256'])[:12]}...)"
        )
    return 0


def handle_inspect_cli(args: Any) -> int:
    """处理 inspect 子命令：检查 .kmod 二进制段或还原 JSON 调试工作区。"""
    kmod_file = Path(args.kmod_file).resolve()
    export_dir = Path(args.export_json).resolve() if args.export_json else None
    ok, summary, errs = inspect_kmod_package(kmod_file, export_json_dir=export_dir)
    if not ok:
        print(
            json.dumps({"success": False, "errors": errs}, ensure_ascii=False, indent=2)
            if args.as_json
            else f"❌ 检查 .kmod 失败: {' | '.join(errs)}",
            file=sys.stdout if args.as_json else sys.stderr,
        )
        return 1
    if args.as_json:
        print(
            json.dumps(
                {"success": True, "inspect": summary}, ensure_ascii=False, indent=2
            )
        )
        return 0
    print(
        f"🔍 .kmod 检查 PASS: {summary['pack_id']} v{summary['version']} (v{summary['archive_format_version']}, sha256={str(summary['content_sha256'])[:12]}...)"
    )
    if summary.get("exported_debug_dir"):
        print(f"  • 已导出 JSON 调试工作区: {summary['exported_debug_dir']}")
    return 0
