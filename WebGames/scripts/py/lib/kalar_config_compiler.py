#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与构建期工具链 (Tooling · 二进制编译器)
# 文件路径: WebGames/scripts/py/lib/kalar_config_compiler.py
# 架构定位: KDS (Kalar Data Stream) 配置与数据高纯度二进制编译器
# 依赖与触发: 触发方: kalar_mod.py / kalar_workbench.py / CI 构建 | 下游: .kdat 产物
# 职责说明: 将 JSON 配置库或 MOD 资产在打包构建期编译烘焙为高纯度紧凑二进制流 (.kdat)；
#           负责定长 Header 组装、字符串驻留池生成、纯净 TLV 编码、DEFLATE/ZSTD 压缩
#           与 32 位 CRC 校验和计算，并提供 100% 往返差分等价反编译验证。
# 退出语义与设计依据: 退出码 0=编译通过, 1=损坏输入 | 依据: Inv-ROUNDTRIP-BYTE-PARITY-1
# ==============================================================================
"""卡拉尔世界引擎高纯度二进制数据流 (.kdat) 编译器与逆向解包器。"""

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import struct
import sys
from typing import Any
import zlib

from kdat_payload_codec import (
    MAGIC_KDAT,
    FORMAT_VERSION_1_0,
    HEADER_SIZE,
    FLAG_COMPRESSED,
    FLAG_STRING_POOL,
    FLAG_MONOLITHIC_TOC,
    FLAG_LITTLE_ENDIAN,
    FLAG_ENCRYPTED,
    COMPRESS_RAW,
    COMPRESS_DEFLATE,
    COMPRESS_ZSTD,
    PAYLOAD_SINGLE_TABLE,
    PAYLOAD_MONOLITHIC_BUNDLE,
    PAYLOAD_MOD_PACKAGE,
    TAG_NIL,
    TAG_BOOL_FALSE,
    TAG_BOOL_TRUE,
    TAG_INT32,
    TAG_INT64,
    TAG_FLOAT64,
    TAG_STRING,
    TAG_STRING_REF,
    TAG_ARRAY,
    TAG_DICT,
    TAG_BINARY_BLOB,
    DEFAULT_MASK_KEY_SEED,
    apply_stream_mask,
    CompiledKDataResult,
    build_string_pool,
    encode_tlv,
    TLVDecoder,
)


# ==============================================================================
# 四、二进制组装与编译核心 API
# ==============================================================================

def serialize_data_to_payload(data: Any, use_string_pool: bool = True) -> tuple[bytes, list[str]]:
    """将数据字典序列化为未压缩的二进制 Payload（含首部字符串池）。"""
    if use_string_pool:
        pool_list, pool_map = build_string_pool(data)
    else:
        pool_list, pool_map = [], {}

    buf = bytearray()
    # 1. 写入字符串池
    buf.extend(struct.pack("<H", len(pool_list)))
    for s in pool_list:
        utf8 = s.encode("utf-8")
        buf.extend(struct.pack("<H", len(utf8)))
        buf.extend(utf8)

    # 2. 写入主体 TLV
    encode_tlv(data, pool_map, buf)
    return bytes(buf), pool_list


def compile_data_to_kdat(
    data: Any,
    compress: bool = True,
    payload_type: int = PAYLOAD_SINGLE_TABLE,
    encrypt: bool = False,
    key_seed: int = DEFAULT_MASK_KEY_SEED,
) -> bytes:
    """将数据编译为符合 32 字节定长 Header 规范的完整 .kdat 字节流。"""
    raw_payload, pool_list = serialize_data_to_payload(data, use_string_pool=True)
    uncompressed_size = len(raw_payload)

    flags = FLAG_LITTLE_ENDIAN | FLAG_STRING_POOL
    compress_type = COMPRESS_RAW
    if compress:
        compressed_payload = zlib.compress(raw_payload, level=9)
        # 仅当压缩后确实缩减体积时使用压缩
        if len(compressed_payload) < uncompressed_size:
            flags |= FLAG_COMPRESSED
            compress_type = COMPRESS_DEFLATE
            final_payload = compressed_payload
        else:
            final_payload = raw_payload
    else:
        final_payload = raw_payload

    if encrypt:
        flags |= FLAG_ENCRYPTED
        final_payload = apply_stream_mask(final_payload, key_seed)

    compressed_size = len(final_payload)
    crc32_val = zlib.crc32(final_payload) & 0xFFFFFFFF

    # 组装 32 字节 Header
    header = struct.pack(
        "<IHBBHHIII8x",
        MAGIC_KDAT,
        FORMAT_VERSION_1_0,
        flags,
        compress_type,
        payload_type,
        HEADER_SIZE,
        uncompressed_size,
        compressed_size,
        crc32_val,
    )
    return header + final_payload


def decompile_kdat_to_data(
    kdat_bytes: bytes,
    key_seed: int = DEFAULT_MASK_KEY_SEED,
) -> tuple[Any, dict[str, Any]]:
    """解包并反编译 .kdat 字节流为 Python 原始数据对象与元数据。"""
    if len(kdat_bytes) < HEADER_SIZE:
        raise ValueError(f"字节流长度不足 32 字节 Header: {len(kdat_bytes)}")

    (
        magic,
        version,
        flags,
        compress_type,
        payload_type,
        header_len,
        uncompressed_size,
        compressed_size,
        crc32_val,
    ) = struct.unpack_from("<IHBBHHIII", kdat_bytes, 0)

    if magic != MAGIC_KDAT:
        raise ValueError(f"非法魔数: 0x{magic:08X} (期望 0x{MAGIC_KDAT:08X})")
    if version != FORMAT_VERSION_1_0:
        raise ValueError(f"不支持的规范版本: 0x{version:04X}")

    payload = kdat_bytes[header_len : header_len + compressed_size]
    actual_crc = zlib.crc32(payload) & 0xFFFFFFFF
    if actual_crc != crc32_val:
        raise ValueError(f"CRC32 校验失败: 期望 0x{crc32_val:08X}, 实际 0x{actual_crc:08X}")

    if flags & FLAG_ENCRYPTED:
        payload = apply_stream_mask(payload, key_seed)

    if flags & FLAG_COMPRESSED:
        if compress_type == COMPRESS_DEFLATE:
            raw_payload = zlib.decompress(payload)
        else:
            raise ValueError(f"暂不支持的解压算法: {compress_type}")
    else:
        raw_payload = payload

    if len(raw_payload) != uncompressed_size:
        raise ValueError(f"解压尺寸不匹配: 期望 {uncompressed_size}, 实际 {len(raw_payload)}")

    # 解析首部字符串池
    offset = 0
    pool_len = struct.unpack_from("<H", raw_payload, offset)[0]
    offset += 2
    pool = []
    for _ in range(pool_len):
        s_len = struct.unpack_from("<H", raw_payload, offset)[0]
        offset += 2
        s = raw_payload[offset : offset + s_len].decode("utf-8")
        offset += s_len
        pool.append(s)

    # TLV 解码
    decoder = TLVDecoder(raw_payload[offset:], pool)
    data = decoder.decode_next()

    metadata = {
        "magic": magic,
        "version": version,
        "flags": flags,
        "compress_type": compress_type,
        "payload_type": payload_type,
        "uncompressed_size": uncompressed_size,
        "compressed_size": compressed_size,
        "crc32": crc32_val,
        "pool_size": pool_len,
    }
    return data, metadata


# ==============================================================================
# 五、单文件与单包融合编译驱动函数
# ==============================================================================

def compile_single_json_file(
    json_path: Path,
    output_kdat_path: Path | None = None,
    compress: bool = True,
) -> CompiledKDataResult:
    """编译单个 JSON 文件为同名或指定目标的 .kdat 二进制文件。"""
    if not json_path.is_file():
        raise FileNotFoundError(f"源 JSON 文件不存在: {json_path}")

    raw_text = json_path.read_text(encoding="utf-8")
    data = json.loads(raw_text)

    if output_kdat_path is None:
        output_kdat_path = json_path.with_suffix(".kdat")

    kdat_bytes = compile_data_to_kdat(data, compress=compress)
    output_kdat_path.parent.mkdir(parents=True, exist_ok=True)
    output_kdat_path.write_bytes(kdat_bytes)

    # 验证往返等价
    decompiled, meta = decompile_kdat_to_data(kdat_bytes)
    if decompiled != data:
        raise RuntimeError(f"往返差分等价自检未通过: {json_path.name}")

    sha256 = hashlib.sha256(kdat_bytes).hexdigest()
    ratio = meta["compressed_size"] / max(1, meta["uncompressed_size"])
    return CompiledKDataResult(
        output_path=output_kdat_path,
        uncompressed_size=meta["uncompressed_size"],
        compressed_size=meta["compressed_size"],
        compression_ratio=round(ratio, 4),
        crc32_hex=f"{meta['crc32']:08x}",
        sha256_hex=sha256,
        table_name=json_path.stem,
    )


def build_monolithic_bundle(
    config_dir: Path,
    output_bundle_path: Path,
    compress: bool = True,
) -> tuple[CompiledKDataResult, dict[str, Any]]:
    """将整个配置目录编译为单一全库融合包 (config.kdat)，内嵌目录索引表 (TOC)。"""
    json_files = sorted(config_dir.rglob("*.json"))
    toc_entries = []
    payload_blobs = bytearray()

    for jf in json_files:
        rel_parts = jf.relative_to(config_dir).with_suffix("").parts
        table_name = ".".join(rel_parts)
        data = json.loads(jf.read_text(encoding="utf-8"))
        raw_bytes, _ = serialize_data_to_payload(data, use_string_pool=True)

        offset = len(payload_blobs)
        payload_blobs.extend(raw_bytes)
        toc_entries.append({
            "table_name": table_name,
            "offset": offset,
            "length": len(raw_bytes),
            "uncompressed_length": len(raw_bytes),
            "crc32": zlib.crc32(raw_bytes) & 0xFFFFFFFF,
        })

    bundle_data = {
        "toc": toc_entries,
        "payload": bytes(payload_blobs),
    }

    kdat_bytes = compile_data_to_kdat(
        bundle_data,
        compress=compress,
        payload_type=PAYLOAD_MONOLITHIC_BUNDLE,
    )
    output_bundle_path.parent.mkdir(parents=True, exist_ok=True)
    output_bundle_path.write_bytes(kdat_bytes)

    # 往返验证
    decompiled, meta = decompile_kdat_to_data(kdat_bytes)
    if len(decompiled.get("toc", [])) != len(toc_entries):
        raise RuntimeError("单包融合 TOC 还原条目数不匹配")

    sha256 = hashlib.sha256(kdat_bytes).hexdigest()
    ratio = meta["compressed_size"] / max(1, meta["uncompressed_size"])
    res = CompiledKDataResult(
        output_path=output_bundle_path,
        uncompressed_size=meta["uncompressed_size"],
        compressed_size=meta["compressed_size"],
        compression_ratio=round(ratio, 4),
        crc32_hex=f"{meta['crc32']:08x}",
        sha256_hex=sha256,
        table_name="config_bundle",
    )
    return res, bundle_data


# ==============================================================================
# 六、CLI 自检与命令行调用入口
# ==============================================================================

def handle_bake_cli(args: Any) -> int:
    """CLI bake 命令核心分发处理。"""
    in_path = Path(args.input_path).resolve()
    out_path = Path(args.output).resolve() if getattr(args, "output", None) else None
    compress = not getattr(args, "no_compress", False)

    if in_path.is_file():
        target_out = out_path if out_path else in_path.with_suffix(".kdat")
        res = compile_single_json_file(in_path, target_out, compress=compress)
        print("==============================================================================")
        print(f"📦 成功编译单表: {res.output_path.name}")
        print("------------------------------------------------------------------------------")
        print(f"  • 输出路径:   {res.output_path}")
        print(f"  • 压缩前大小: {res.uncompressed_size} bytes")
        print(f"  • 压缩后大小: {res.compressed_size} bytes (压缩率: {res.compression_ratio})")
        print(f"  • CRC32:      {res.crc32_hex}")
        print(f"  • SHA-256:    {res.sha256_hex}")
        print("==============================================================================")
        return 0
    elif in_path.is_dir():
        if getattr(args, "monolithic", False):
            target_bundle = out_path if out_path else (in_path / "config.kdat")
            res, bundle = build_monolithic_bundle(in_path, target_bundle, compress=compress)
            print("==============================================================================")
            print(f"📦 成功构建单包融合: {res.output_path.name}")
            print("------------------------------------------------------------------------------")
            print(f"  • 输出路径:   {res.output_path}")
            print(f"  • 子表总数:   {len(bundle.get('toc', []))} 张")
            print(f"  • 压缩前大小: {res.uncompressed_size} bytes")
            print(f"  • 压缩后大小: {res.compressed_size} bytes (压缩率: {res.compression_ratio})")
            print("==============================================================================")
            return 0
        else:
            json_files = sorted(in_path.rglob("*.json"))
            count = 0
            for jf in json_files:
                target_out = (out_path / jf.relative_to(in_path)).with_suffix(".kdat") if out_path else jf.with_suffix(".kdat")
                compile_single_json_file(jf, target_out, compress=compress)
                count += 1
            print(f"✔ 成功批量编译 {count} 个 JSON 配置表至 .kdat")
            return 0
    else:
        print(f"❌ 输入路径不存在: {in_path}", file=sys.stderr)
        return 1


def run_compiler_self_test() -> bool:
    """运行编译器内存往返差分等价自检。"""
    test_cases = [
        {"int": 42, "neg": -100, "large": 1234567890123},
        {"float": 3.1415926535, "zero": 0.0},
        {"bool_t": True, "bool_f": False, "nil": None},
        {"str": "卡拉尔世界", "nested": {"list": [1, "two", 3.0, None, True]}},
        {"repeated": ["key", "key", "key"], "dict_keys": {"rates": 100, "silver": 50}},
        {
            "asset_id": "tex_hero_avatar",
            "blob": {
                "__type": "binary_blob",
                "mime_type": "image/png",
                "data": b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01",
            },
        },
    ]
    for case in test_cases:
        kdat_bytes = compile_data_to_kdat(case, compress=True)
        decompiled, _ = decompile_kdat_to_data(kdat_bytes)
        if decompiled != case:
            print("❌ 自测失败: 往返不一致", case, "!=", decompiled)
            return False

    # 加密掩码往返自检
    encrypted_case = {"secret_seed": 99999, "role_token": "mock_token_abc"}
    enc_kdat = compile_data_to_kdat(encrypted_case, compress=True, encrypt=True)
    dec_unmasked, meta = decompile_kdat_to_data(enc_kdat)
    if (meta["flags"] & FLAG_ENCRYPTED) == 0:
        print("❌ 自测失败: 未置位 FLAG_ENCRYPTED")
        return False
    if dec_unmasked != encrypted_case:
        print("❌ 自测失败: 加密掩码往返不一致", encrypted_case, "!=", dec_unmasked)
        return False

    # 损坏魔数拦截测试
    bad_magic = bytearray(kdat_bytes)
    bad_magic[0] = 0x00
    try:
        decompile_kdat_to_data(bytes(bad_magic))
        print("❌ 自测失败: 未能拦截损坏魔数")
        return False
    except ValueError:
        pass

    # CRC32 损坏篡改测试
    bad_crc = bytearray(kdat_bytes)
    bad_crc[-1] ^= 0xFF
    try:
        decompile_kdat_to_data(bytes(bad_crc))
        print("❌ 自测失败: 未能拦截 CRC 篡改")
        return False
    except ValueError:
        pass

    print("✔ 编译器 TLV 往返差分自检全部 PASS！")
    return True


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "--test":
        success = run_compiler_self_test()
        sys.exit(0 if success else 1)
    print("kalar_config_compiler ready.")
