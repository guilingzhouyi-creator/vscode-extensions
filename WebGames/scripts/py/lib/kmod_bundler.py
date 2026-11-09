#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 模组开发者工具链 (MOD SDK · 扩展包打包与校验核心)
# 文件路径: WebGames/scripts/py/lib/kmod_bundler.py
# 架构定位: .kmod 归档包构建与指纹完整性校验底层算子库
# 依赖与触发: 触发方: kalar_workbench.py / kalar_mod.py | 下游: .kmod 归档包
# 职责说明: 提供模组扩展包 (.kmod) 的文件清单哈希扫描、元数据清单封装、
#           ZIP 压缩封装与 SHA-256 完整性指纹校验核心函数。
# 退出语义与设计依据: 纯计算与文件打包无状态库 | 依据: 模组开发者工作台扩展包规范
# ==============================================================================
"""kmod_bundler.py — 卡拉尔世界引擎 .kmod 归档包构建与校验核心算子库。"""

from __future__ import annotations
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import sys
import time
from typing import Any
import zipfile


def calculate_file_sha256(file_path: Path) -> str:
    """计算单个文件的 SHA-256 哈希字符串。"""
    sha = hashlib.sha256()
    with file_path.open("rb") as f:
        while chunk := f.read(65536):
            sha.update(chunk)
    return sha.hexdigest()


def safe_load_json(file_path: Path) -> dict[str, Any]:
    """安全读取并解析 JSON 文件。"""
    if not file_path.is_file():
        return {}
    try:
        content = file_path.read_text(encoding="utf-8")
        return json.loads(content)
    except Exception as exc:
        sys.stderr.write(f"[WARN] 读取 JSON 失败: {file_path} ({exc})\n")
        return {}


@dataclass(slots=True)
class ModBundleManifest:
    """模组扩展包元数据对象 (GOV-DAT-001)。"""

    bundle_id: str
    bundle_name: str
    version: str
    engine_api_version: str
    tier: str
    author: str
    description: str
    dependencies: list[str]
    files_manifest: dict[str, dict[str, Any]]
    created_timestamp_utc: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "bundle_id": self.bundle_id,
            "bundle_name": self.bundle_name,
            "version": self.version,
            "author": self.author,
            "engine_api_version": self.engine_api_version,
            "tier": self.tier,
            "description": self.description,
            "dependencies": self.dependencies,
            "files_manifest": self.files_manifest,
            "created_timestamp_utc": self.created_timestamp_utc,
        }


def scan_and_build_files_manifest(mod_dir: Path) -> dict[str, dict[str, Any]]:
    """递归扫描模组目录下除临时文件外的所有资产，生成相对路径与哈希指纹字典。"""
    manifest: dict[str, dict[str, Any]] = {}
    ignored_names = {".git", ".DS_Store", "__pycache__", "manifest.json"}
    ignored_suffixes = {".tmp", ".swp", ".kmod"}

    for p in sorted(mod_dir.rglob("*")):
        if p.is_dir() or any(part in ignored_names for part in p.parts):
            continue
        if p.suffix in ignored_suffixes:
            continue
        rel_path = p.relative_to(mod_dir).as_posix()
        manifest[rel_path] = {
            "sha256": calculate_file_sha256(p),
            "size_bytes": p.stat().st_size,
        }
    return manifest


def build_kmod_package(
    mod_dir: Path,
    output_path: Path | None = None,
    overwrite: bool = True,
) -> tuple[bool, Path | None, list[str]]:
    """将物理 MOD 目录打包封装为标准化 .kmod 归档包。"""
    if not mod_dir.is_dir():
        return False, None, [f"目标 MOD 目录不存在: {mod_dir}"]

    pack_json_file = mod_dir / "pack.json"
    if not pack_json_file.is_file():
        return False, None, [f"MOD 根目录缺失必需的 pack.json: {pack_json_file}"]

    pack_data = safe_load_json(pack_json_file)
    bundle_id = str(pack_data.get("pack_id", mod_dir.name))
    bundle_name = str(pack_data.get("pack_name", bundle_id))
    version = str(pack_data.get("version", "1.0.0"))
    engine_api = str(pack_data.get("engine_api_version", "1.0.0"))
    tier = str(pack_data.get("tier", "TIER_1_LOGIC"))
    author = str(pack_data.get("author", "Unknown"))
    description = str(pack_data.get("description", ""))
    raw_deps = pack_data.get("dependencies", [])
    dependencies = list(raw_deps) if isinstance(raw_deps, list) else []

    files_manifest = scan_and_build_files_manifest(mod_dir)
    if not files_manifest:
        return False, None, ["MOD 目录下没有扫描到任何有效数据文件"]

    bundle_manifest = ModBundleManifest(
        bundle_id=bundle_id,
        bundle_name=bundle_name,
        version=version,
        engine_api_version=engine_api,
        tier=tier,
        author=author,
        description=description,
        dependencies=dependencies,
        files_manifest=files_manifest,
        created_timestamp_utc=int(time.time()),
    )

    if output_path is None:
        target_file = mod_dir.parent / f"{bundle_id}_{version}.kmod"
    else:
        target_file = Path(output_path).resolve()

    if target_file.exists() and not overwrite:
        return False, None, [f"目标输出包已存在且未指定覆盖: {target_file}"]

    try:
        target_file.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(target_file, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("manifest.json", json.dumps(bundle_manifest.to_dict(), ensure_ascii=False, indent=2))
            for rel_path in files_manifest.keys():
                src_file = mod_dir / rel_path
                zf.write(src_file, arcname=rel_path)
    except Exception as exc:
        return False, None, [f"写入 .kmod 归档包异常: {exc}"]

    return True, target_file, []


def verify_kmod_package(kmod_path: Path) -> tuple[bool, dict[str, Any], list[str]]:
    """严格校验 .kmod 归档包的合法性与 SHA-256 完整性清单。"""
    errors: list[str] = []
    if not kmod_path.is_file():
        return False, {}, [f"指定的 .kmod 文件不存在: {kmod_path}"]

    try:
        with zipfile.ZipFile(kmod_path, "r") as zf:
            namelist = set(zf.namelist())
            if "manifest.json" not in namelist:
                return False, {}, ["归档包内缺失根元数据清单 manifest.json"]

            manifest_content = zf.read("manifest.json").decode("utf-8")
            manifest_data = json.loads(manifest_content)

            required_keys = ["bundle_id", "version", "files_manifest"]
            for req in required_keys:
                if req not in manifest_data:
                    errors.append(f"manifest.json 缺失必需键: {req}")

            files_manifest = manifest_data.get("files_manifest", {})
            for rel_path, meta in files_manifest.items():
                if rel_path not in namelist:
                    errors.append(f"manifest 中声明的文件在包内缺失: {rel_path}")
                    continue
                expected_sha = meta.get("sha256", "")
                data = zf.read(rel_path)
                actual_sha = hashlib.sha256(data).hexdigest()
                if actual_sha != expected_sha:
                    errors.append(f"文件指纹损坏: {rel_path} (期望 {expected_sha}, 实际 {actual_sha})")

            return len(errors) == 0, manifest_data, errors
    except Exception as exc:
        return False, {}, [f"解析 .kmod 压缩流异常: {exc}"]


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
