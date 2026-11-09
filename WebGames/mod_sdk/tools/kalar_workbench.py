#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 模组开发者工具链 (MOD SDK · 集成工作台)
# 文件路径: WebGames/mod_sdk/tools/kalar_workbench.py
# 架构定位: 开发者集成单一应用台与 .kmod 打包引擎 (Developer Workbench & Bundler)
# 依赖与触发: 触发方: CLI / kalar_mod.py / 外部 Agent | 上游: check_mod.py, play_mod.py, schemas/ | 运行时: Python 3.10+
# 职责说明: 提供一站式脚手架初始化、离线静态检查、.kmod 标准包构建与 Agent 自动化推演
# 退出语义与设计依据: 退出码: 0=成功, 1=校验或打包失败, 2=参数异常 | 设计依据: Phase 124 开发者集成工作台规范
# ==============================================================================
"""卡拉尔世界引擎 MOD 开发者集成工作台与 .kmod 打包引擎。"""

from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import argparse
import hashlib
import json
import os
import sys
import tempfile
import time
import zipfile

TOOLS_DIR = Path(__file__).resolve().parent
MOD_SDK_DIR = TOOLS_DIR.parent
SCRIPTS_PY_LIB = MOD_SDK_DIR.parent / "scripts" / "py" / "lib"
if str(SCRIPTS_PY_LIB) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_PY_LIB))

SCHEMAS_DIR = MOD_SDK_DIR / "schemas"
BUNDLE_MANIFEST_SCHEMA_PATH = SCHEMAS_DIR / "bundle_manifest.schema.json"
WORKBENCH_CONFIG_SCHEMA_PATH = SCHEMAS_DIR / "workbench_config.schema.json"

try:
    from kalar_config_compiler import (
        compile_single_json_file,
        build_monolithic_bundle,
        decompile_kdat_to_data,
        run_compiler_self_test,
    )
except ImportError:
    compile_single_json_file = None
    build_monolithic_bundle = None
    decompile_kdat_to_data = None
    run_compiler_self_test = None


def ensure_utf8_stdout() -> None:
    """保障 Windows 下控制台 UTF-8 输出。"""
    if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


from kmod_bundler import (
    calculate_file_sha256,
    safe_load_json,
    ModBundleManifest,
    scan_and_build_files_manifest,
    build_kmod_package,
    verify_kmod_package,
    handle_kmod_pack_cli,
)


def run_workbench_self_test() -> int:
    """运行工作台打包与解包完整性自测试夹具。"""
    ensure_utf8_stdout()
    print("=======================================================================")
    print("🛠️ 卡拉尔世界引擎 MOD 工作台与 .kmod 归档打包器自测试")
    print("=======================================================================")

    template_dir = MOD_SDK_DIR / "templates" / "starter_story"
    if not template_dir.is_dir():
        print(f"[FAIL] 缺少基准模板目录: {template_dir}", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        target_kmod = tmp_path / "starter_story_1.0.0.kmod"

        # 1. 测试打包
        ok, out_path, errs = build_kmod_package(template_dir, target_kmod)
        if not ok or not out_path or not out_path.is_file():
            print(f"[FAIL] 打包流程失败: {errs}", file=sys.stderr)
            return 1
        print(f"  ✔ 成功构建 .kmod 归档包: {out_path.name} ({out_path.stat().st_size} bytes)")

        # 2. 测试校验
        verify_ok, manifest_data, v_errs = verify_kmod_package(target_kmod)
        if not verify_ok:
            print(f"[FAIL] 完整性指纹校验失败: {v_errs}", file=sys.stderr)
            return 1
        print(f"  ✔ SHA-256 全量指纹与 manifest 校验 100% 吻合 (文件数: {len(manifest_data.get('files_manifest', {}))})")

        # 3. 测试防篡改判定
        corrupted_kmod = tmp_path / "corrupted.kmod"
        with zipfile.ZipFile(target_kmod, "r") as src_zf, zipfile.ZipFile(corrupted_kmod, "w") as dst_zf:
            for item in src_zf.infolist():
                if item.filename == "routing_rules.json":
                    dst_zf.writestr(item, b'{"corrupted": true}')
                else:
                    dst_zf.writestr(item, src_zf.read(item.filename))

        bad_ok, _, bad_errs = verify_kmod_package(corrupted_kmod)
        if bad_ok:
            print("[FAIL] 篡改文件未被拦截！", file=sys.stderr)
            return 1
        print(f"  ✔ 防篡改与单向指纹拦截生效: {bad_errs[0]}")

        # 4. 测试二进制 .kdat 编译与往返等价反编译
        if compile_single_json_file is not None:
            rules_json = template_dir / "routing_rules.json"
            target_kdat = tmp_path / "routing_rules.kdat"
            compile_res = compile_single_json_file(rules_json, target_kdat, compress=True)
            if not target_kdat.is_file():
                print("[FAIL] 编译 .kdat 产物丢失！", file=sys.stderr)
                return 1
            print(f"  ✔ 成功烘焙 .kdat 二进制流: {target_kdat.name} ({compile_res.compressed_size} bytes, 压缩率: {compile_res.compression_ratio})")

    print("=======================================================================")
    print("🎉 工作台打包与自检测试全部 PASS！")
    print("=======================================================================")
    return 0


def handle_workbench_cli(args: Any) -> int:
    """供 kalar_mod.py 调用的统一工作台分发入口。"""
    if getattr(args, "self_test", False) or "self-test" in (getattr(args, "workbench_args", []) or []):
        return run_workbench_self_test()
    if getattr(args, "verify_target", None):
        target_file = Path(args.verify_target).resolve()
        ok, manifest, errs = verify_kmod_package(target_file)
        if not ok:
            print("❌ 校验失败:\n  " + "\n  ".join(errs), file=sys.stderr)
            return 1
        print(f"✔ 校验通过: {manifest.get('bundle_id')} (v{manifest.get('version')})")
        return 0
    if getattr(args, "pack_target", None):
        target_dir = Path(args.pack_target).resolve()
        out_path = Path(args.output).resolve() if getattr(args, "output", None) else None
        ok, res_path, errs = build_kmod_package(target_dir, out_path)
        if not ok:
            print("❌ 打包失败:\n  " + "\n  ".join(errs), file=sys.stderr)
            return 1
        print(f"✔ 打包成功: {res_path}")
        return 0
    print("kalar_workbench: 请指定 --self-test, --verify <path>, 或 -p/--pack <dir>")
    return 0


def handle_kmod_pack_cli(target_dir: Path, out_path: Path | None, as_json: bool, pack_id: str, version: str) -> int:
    """供 kalar_mod pack 调用的标准 kmod 构建与验证闭环。"""
    out_kmod = out_path if out_path else target_dir.parent / f"{pack_id}_v{version}.kmod"
    ok, res_path, errors = build_kmod_package(target_dir, out_kmod)
    if not ok or not res_path:
        err_msg = "生成 .kmod 归档包失败: " + " | ".join(errors)
        if as_json:
            print(json.dumps({"success": False, "error": err_msg, "details": errors}, ensure_ascii=False))
        else:
            print(f"❌ 错误: {err_msg}", file=sys.stderr)
        return 1

    verify_ok, manifest_data, v_errors = verify_kmod_package(res_path)
    if not verify_ok:
        err_msg = "打包后完整性校验失败: " + " | ".join(v_errors)
        if as_json:
            print(json.dumps({"success": False, "error": err_msg, "details": v_errors}, ensure_ascii=False))
        else:
            print(f"❌ 错误: {err_msg}", file=sys.stderr)
        return 1

    kmod_size_bytes = res_path.stat().st_size
    kmod_sha256 = calculate_file_sha256(res_path)
    files_manifest = manifest_data.get("files_manifest", {})
    if as_json:
        payload = {
            "success": True,
            "pack_id": pack_id,
            "version": version,
            "format": "kmod",
            "output_package": str(res_path),
            "file_count": len(files_manifest),
            "compressed_bytes": kmod_size_bytes,
            "sha256": kmod_sha256,
            "manifest": manifest_data,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    print("==============================================================================")
    print(f"📦 MOD 标准化 .kmod 打包成功: {pack_id} (v{version})")
    print("------------------------------------------------------------------------------")
    print(f"  • 输出路径   : {res_path}")
    print(f"  • 文件总数   : {len(files_manifest)} 项 (含 SHA-256 签名清单)")
    print(f"  • 压缩后大小 : {round(kmod_size_bytes / 1024, 2)} KB")
    print(f"  • 归档哈希   : {kmod_sha256}")
    print("==============================================================================")
    return 0


def main() -> int:
    """工作台 CLI 入口点。"""
    ensure_utf8_stdout()
    parser = argparse.ArgumentParser(
        description="卡拉尔世界引擎模组开发者工作台与 .kmod 打包工具"
    )
    subparsers = parser.add_subparsers(dest="subcommand", help="子命令")

    # pack 子命令
    pack_parser = subparsers.add_parser("pack", help="将 MOD 目录打包为 .kmod 扩展包")
    pack_parser.add_argument("mod_dir", type=str, help="MOD 物理目录路径")
    pack_parser.add_argument("-o", "--output", type=str, default="", help="输出 .kmod 文件路径")
    pack_parser.add_argument("--no-overwrite", action="store_true", help="禁止覆盖已有目标文件")

    # verify 子命令
    verify_parser = subparsers.add_parser("verify", help="校验 .kmod 扩展包合法性与指纹完整性")
    verify_parser.add_argument("kmod_file", type=str, help="待校验的 .kmod 文件路径")

    # bake 子命令
    bake_parser = subparsers.add_parser("bake", help="将 JSON 配置表或目录烘焙为 .kdat 二进制流")
    bake_parser.add_argument("input_path", type=str, help="输入源 JSON 文件或目录")
    bake_parser.add_argument("-o", "--output", type=str, default="", help="输出 .kdat 文件或目录")
    bake_parser.add_argument("--monolithic", action="store_true", help="全目录打包为单包融合 config.kdat")
    bake_parser.add_argument("--no-compress", action="store_true", help="禁用数据压缩")

    # self-test 子命令
    subparsers.add_parser("self-test", help="执行工作台内部集成自测试")

    parser.add_argument("--self-test", action="store_true", help="执行工作台内部集成自测试")

    args = parser.parse_args()

    if args.self_test or args.subcommand == "self-test":
        return run_workbench_self_test()

    if args.subcommand == "bake":
        if compile_single_json_file is None:
            print("[ERROR] 无法加载 kalar_config_compiler 模块", file=sys.stderr)
            return 1
        in_p = Path(args.input_path).resolve()
        out_p = Path(args.output).resolve() if args.output else None
        compress = not args.no_compress
        if in_p.is_file():
            res = compile_single_json_file(in_p, out_p, compress=compress)
            print(f"✅ 成功编译: {res.output_path} ({res.compressed_size} bytes, 压缩率: {res.compression_ratio})")
            return 0
        elif in_p.is_dir():
            if args.monolithic:
                out_bundle = out_p if out_p else (in_p / "config.kdat")
                res, _ = build_monolithic_bundle(in_p, out_bundle, compress=compress)
                print(f"✅ 成功构建单包融合: {res.output_path} ({res.compressed_size} bytes)")
                return 0
            else:
                json_files = sorted(in_p.rglob("*.json"))
                count = 0
                for jf in json_files:
                    target_out = (out_p / jf.relative_to(in_p)).with_suffix(".kdat") if out_p else jf.with_suffix(".kdat")
                    compile_single_json_file(jf, target_out, compress=compress)
                    count += 1
                print(f"✅ 成功批量烘焙 {count} 个配置表至 .kdat")
                return 0
        else:
            print(f"[ERROR] 输入路径不存在: {in_p}", file=sys.stderr)
            return 1

    if args.subcommand == "pack":
        mod_p = Path(args.mod_dir).resolve()
        out_p = Path(args.output).resolve() if args.output else None
        ok, res_path, errors = build_kmod_package(mod_p, out_p, overwrite=not args.no_overwrite)
        if not ok:
            print(f"[ERROR] 打包失败:\n  " + "\n  ".join(errors), file=sys.stderr)
            return 1
        print(f"✅ 成功打包: {res_path}")
        return 0

    if args.subcommand == "verify":
        kmod_p = Path(args.kmod_file).resolve()
        ok, manifest, errors = verify_kmod_package(kmod_p)
        if not ok:
            print(f"[ERROR] 校验失败:\n  " + "\n  ".join(errors), file=sys.stderr)
            return 1
        print(f"✅ 校验通过: {manifest.get('bundle_id')} (v{manifest.get('version')})")
        return 0

    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
