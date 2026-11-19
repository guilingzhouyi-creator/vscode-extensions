#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 模组开发者工具链 (MOD SDK · 扩展包编译打包与校验核心)
# 文件路径: WebGames/scripts/py/lib/kmod_bundler.py
# 架构定位: .kmod 二进制归档包构建与完整性校验底层算子库
# 依赖与触发: 触发方: kalar_workbench.py / kalar_dev_pipeline.py | 上游: kmod_data_codec / kalar_config_compiler | 下游: .kmod 归档包
# 职责说明: 编排将 JSON 开发目录封装为含 manifest.kdat + mod_data.kdat + assets/ 的纯二进制
#           .kmod 扩展包，执行防篡改 SHA-256 与明文 JSON 零残留校验，并支持二进制头部检视。
# 退出语义与设计依据: 调试(JSON)与正式封装(.kmod/.kdat)一体化规范 | 依据: 《卡拉尔数据契约规范》
# ==============================================================================
"""kmod_bundler.py — 卡拉尔世界引擎 .kmod 二进制归档包构建与校验核心算子库。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
from typing import Any
import zipfile

_LIB_DIR = Path(__file__).resolve().parent
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

from kalar_config_compiler import compile_data_to_kdat, decompile_kdat_to_data
from kdat_payload_codec import PAYLOAD_MOD_PACKAGE
from kmod_data_codec import (
    KMOD_DATA_ENTRY,
    KMOD_MANIFEST_ENTRY,
    collect_mod_compile_inputs,
    compute_entries_content_sha256,
    should_ignore_path,
)
from kmod_debug_exporter import export_mod_debug_workspace

ARCHIVE_FORMAT_VERSION: int = 2


def calculate_file_sha256(file_path: Path) -> str:
    """计算单个文件的 SHA-256 哈希字符串。"""
    sha = hashlib.sha256()
    with file_path.open("rb") as f:
        while chunk := f.read(65536):
            sha.update(chunk)
    return sha.hexdigest()


def safe_load_json(file_path: Path) -> dict[str, Any]:
    """安全读取并解析 JSON 文件（仅字典返回，异常返回空字典）。"""
    if not file_path.is_file():
        return {}
    try:
        parsed = json.loads(file_path.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, dict) else {}
    except Exception as exc:
        sys.stderr.write(f"[WARN] 读取 JSON 失败: {file_path} ({exc})\n")
        return {}


@dataclass(slots=True)
class ModBundleManifest:
    """模组二进制扩展包元数据对象 (GOV-DAT-001 / archive_format_version=2)。"""

    pack_id: str
    pack_name: str
    version: str
    engine_api_version: str
    tier: int | str
    author: str
    description: str
    dependencies: list[str]
    files_manifest: dict[str, dict[str, Any]]
    content_sha256: str
    created_timestamp_utc: str
    extra_fields: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        payload = dict(self.extra_fields)
        payload.update(
            {
                "archive_format_version": ARCHIVE_FORMAT_VERSION,
                "manifest_schema": "kalar.mod_sdk.bundle_manifest.v1",
                "pack_id": self.pack_id,
                "pack_name": self.pack_name,
                "version": self.version,
                "author": self.author,
                "engine_api_version": self.engine_api_version,
                "tier": self.tier,
                "description": self.description,
                "dependencies": list(self.dependencies),
                "files_manifest": self.files_manifest,
                "content_sha256": self.content_sha256,
                "kalar_sdk_version": str(payload.get("kalar_sdk_version") or "1.0.0"),
                "created_timestamp_utc": self.created_timestamp_utc,
            }
        )
        return payload


def scan_and_build_files_manifest(mod_dir: Path) -> dict[str, dict[str, Any]]:
    """查询接口：递归扫描开发目录资产返回路径与 SHA-256 指纹字典。"""
    manifest: dict[str, dict[str, Any]] = {}
    for p in sorted(mod_dir.rglob("*")):
        if p.is_dir() or should_ignore_path(p):
            continue
        rel_path = p.relative_to(mod_dir).as_posix()
        if rel_path != "pack.json":
            manifest[rel_path] = {
                "sha256": calculate_file_sha256(p),
                "size_bytes": p.stat().st_size,
            }
    return manifest


def build_kmod_package(
    mod_dir: Path,
    output_path: Path | None = None,
    manifest_overrides: dict[str, Any] | None = None,
) -> tuple[bool, Path | None, list[str]]:
    """将物理 JSON 开发目录编译封装为正式 .kmod 二进制归档包（零明文 JSON）。"""
    pack_json_file = mod_dir / "pack.json"
    if not pack_json_file.is_file():
        return False, None, [f"MOD 根目录缺失必需的 pack.json: {pack_json_file}"]
    pack_meta = safe_load_json(pack_json_file)
    if not pack_meta:
        return False, None, [f"pack.json 格式非法或为空: {pack_json_file}"]

    overrides = manifest_overrides or {}
    pack_id = str(
        overrides.get("pack_id") or pack_meta.get("pack_id") or mod_dir.name
    ).strip()
    pack_name = str(
        overrides.get("pack_name") or pack_meta.get("pack_name") or pack_id
    ).strip()
    version = str(
        overrides.get("version") or pack_meta.get("version") or "1.0.0"
    ).strip()
    deps_raw = overrides.get("dependencies", pack_meta.get("dependencies", []))

    try:
        mod_data, media_entries = collect_mod_compile_inputs(mod_dir, pack_meta)
        mod_data_kdat = compile_data_to_kdat(
            mod_data, compress=True, payload_type=PAYLOAD_MOD_PACKAGE
        )
    except Exception as exc:
        return False, None, [f"编译 mod_data.kdat 失败: {exc}"]

    binary_entries: dict[str, bytes] = {KMOD_DATA_ENTRY: mod_data_kdat}
    binary_entries.update(media_entries)
    files_manifest = {
        rel: {"sha256": hashlib.sha256(raw).hexdigest(), "size_bytes": len(raw)}
        for rel, raw in sorted(binary_entries.items())
    }
    reserved_keys = {
        "pack_id",
        "pack_name",
        "version",
        "author",
        "engine_api_version",
        "tier",
        "description",
        "dependencies",
        "files_manifest",
        "content_sha256",
    }
    extra_fields = {k: v for k, v in pack_meta.items() if k not in reserved_keys}
    extra_fields.setdefault(
        "pack_profile", pack_meta.get("pack_profile", "CONTENT_ADDON")
    )
    extra_fields.setdefault("is_active", pack_meta.get("is_active", True))
    extra_fields.setdefault("is_official", pack_meta.get("is_official", False))

    bundle_manifest = ModBundleManifest(
        pack_id=pack_id,
        pack_name=pack_name,
        version=version,
        engine_api_version=str(
            overrides.get("engine_api_version")
            or pack_meta.get("engine_api_version")
            or "1.0.0"
        ).strip(),
        tier=overrides.get("tier", pack_meta.get("tier", 2)),
        author=str(
            overrides.get("author") or pack_meta.get("author") or "Community Developer"
        ).strip(),
        description=str(
            overrides.get("description") or pack_meta.get("description") or ""
        ).strip(),
        dependencies=[str(d) for d in deps_raw] if isinstance(deps_raw, list) else [],
        files_manifest=files_manifest,
        content_sha256=compute_entries_content_sha256(binary_entries),
        created_timestamp_utc=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        extra_fields=extra_fields,
    )
    try:
        manifest_kdat = compile_data_to_kdat(
            bundle_manifest.to_dict(), compress=True, payload_type=PAYLOAD_MOD_PACKAGE
        )
    except Exception as exc:
        return False, None, [f"编译 manifest.kdat 失败: {exc}"]

    target_file = output_path or (mod_dir.parent / f"{pack_id}_v{version}.kmod")
    target_file.parent.mkdir(parents=True, exist_ok=True)
    tmp_target = target_file.with_suffix(".kmod.tmp")
    try:
        with zipfile.ZipFile(tmp_target, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(KMOD_MANIFEST_ENTRY, manifest_kdat)
            for rel_path in sorted(binary_entries.keys()):
                zf.writestr(rel_path, binary_entries[rel_path])
        tmp_target.replace(target_file)
    except Exception as exc:
        if tmp_target.exists():
            tmp_target.unlink(missing_ok=True)
        return False, None, [f"写入 .kmod 二进制归档包异常: {exc}"]
    return True, target_file, []


def verify_kmod_package(kmod_path: Path) -> tuple[bool, dict[str, Any], list[str]]:
    """严格校验 .kmod 二进制归档包（零明文 JSON + .kdat CRC32/结构校验 + SHA-256 验签）。"""
    if not kmod_path.is_file():
        return False, {}, [f"指定的 .kmod 文件不存在: {kmod_path}"]
    errors: list[str] = []
    manifest_data: dict[str, Any] = {}
    try:
        with zipfile.ZipFile(kmod_path, "r") as zf:
            namelist = zf.namelist()
            json_leaks = [n for n in namelist if n.lower().endswith(".json")]
            if json_leaks:
                return (
                    False,
                    {},
                    [
                        f"禁止包含明文 .json 文件，正式 .kmod 仅允许 .kdat 与媒体流: {json_leaks[0]}"
                    ],
                )
            for required_bin in (KMOD_MANIFEST_ENTRY, KMOD_DATA_ENTRY):
                if required_bin not in namelist:
                    return False, {}, [f"归档包缺少必需的二进制载荷: {required_bin}"]

            decoded_manifest, m_meta = decompile_kdat_to_data(
                zf.read(KMOD_MANIFEST_ENTRY)
            )
            decoded_data, d_meta = decompile_kdat_to_data(zf.read(KMOD_DATA_ENTRY))
            if not isinstance(decoded_manifest, dict) or not isinstance(
                decoded_data, dict
            ):
                return (
                    False,
                    {},
                    ["manifest.kdat 或 mod_data.kdat 解码根节点必须为字典对象"],
                )
            if (
                int(m_meta.get("payload_type", -1)) != PAYLOAD_MOD_PACKAGE
                or int(d_meta.get("payload_type", -1)) != PAYLOAD_MOD_PACKAGE
            ):
                return False, {}, ["二进制载荷 payload_type 必须为 PAYLOAD_MOD_PACKAGE"]
            manifest_data = decoded_manifest

            for req_key in (
                "pack_id",
                "pack_name",
                "version",
                "files_manifest",
                "content_sha256",
            ):
                if req_key not in manifest_data:
                    errors.append(f"manifest.kdat 缺失必需字段: {req_key}")

            files_manifest = manifest_data.get("files_manifest")
            if (
                not isinstance(files_manifest, dict)
                or KMOD_DATA_ENTRY not in files_manifest
            ):
                errors.append("files_manifest 结构非法或缺少 mod_data.kdat 条目")
                files_manifest = {}

            actual_entries = {
                n: zf.read(n)
                for n in namelist
                if n != KMOD_MANIFEST_ENTRY and not n.endswith("/")
            }
            for missing_entry in sorted(
                set(files_manifest.keys()) - set(actual_entries.keys())
            ):
                errors.append(f"归档内缺失清单声明条目: {missing_entry}")
            for extra_entry in sorted(
                set(actual_entries.keys()) - set(files_manifest.keys())
            ):
                errors.append(f"归档内发现未登记条目: {extra_entry}")
            for rel_path, meta in files_manifest.items():
                if rel_path in actual_entries and isinstance(meta, dict):
                    raw_bytes = actual_entries[rel_path]
                    if hashlib.sha256(raw_bytes).hexdigest() != meta.get("sha256"):
                        errors.append(f"内容哈希不匹配 (可能遭篡改): {rel_path}")
                    if "size_bytes" in meta and len(raw_bytes) != int(
                        meta["size_bytes"]
                    ):
                        errors.append(f"内容字节长度不匹配: {rel_path}")
            computed_digest = compute_entries_content_sha256(actual_entries)
            declared_digest = (
                str(manifest_data.get("content_sha256", "")).strip().lower()
            )
            if declared_digest and computed_digest != declared_digest:
                errors.append(
                    f"全包内容指纹 content_sha256 不一致: expected={declared_digest}, actual={computed_digest}"
                )
    except zipfile.BadZipFile:
        return False, {}, ["目标文件并非有效的 .kmod ZIP 二进制归档格式"]
    except Exception as exc:
        return False, {}, [f"解析 .kmod 二进制归档异常: {exc}"]
    return (False, manifest_data, errors) if errors else (True, manifest_data, [])


def inspect_kmod_package(
    kmod_path: Path, export_json_dir: Path | None = None
) -> tuple[bool, dict[str, Any], list[str]]:
    """检查 .kmod 二进制段头部指标与结构摘要；可选反编译还原为开发期 JSON 调试工作区。"""
    ok, manifest_data, verify_errors = verify_kmod_package(kmod_path)
    if not ok:
        return False, manifest_data, verify_errors
    with zipfile.ZipFile(kmod_path, "r") as zf:
        _, manifest_meta = decompile_kdat_to_data(zf.read(KMOD_MANIFEST_ENTRY))
        mod_data, data_meta = decompile_kdat_to_data(zf.read(KMOD_DATA_ENTRY))
        media_files = sorted(
            n
            for n in zf.namelist()
            if n not in (KMOD_MANIFEST_ENTRY, KMOD_DATA_ENTRY) and not n.endswith("/")
        )
        if export_json_dir is not None:
            export_mod_debug_workspace(
                export_json_dir, manifest_data, mod_data, zf, media_files
            )
    summary = {
        "kmod_path": str(kmod_path),
        "archive_size_bytes": kmod_path.stat().st_size,
        "archive_format_version": manifest_data.get(
            "archive_format_version", ARCHIVE_FORMAT_VERSION
        ),
        "pack_id": manifest_data.get("pack_id", ""),
        "version": manifest_data.get("version", ""),
        "content_sha256": manifest_data.get("content_sha256", ""),
        "manifest_kdat": manifest_meta,
        "mod_data_kdat": data_meta,
        "dag_count": len(mod_data.get("dag_graphs", {})),
        "locale_buckets": sorted(mod_data.get("custom_i18n_by_locale", {}).keys()),
        "content_record_count": len(mod_data.get("content_records", [])),
        "media_files": media_files,
        "exported_debug_dir": str(export_json_dir)
        if export_json_dir is not None
        else None,
    }
    return True, summary, []
