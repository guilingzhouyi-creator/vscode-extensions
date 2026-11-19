#!/usr/bin/env python3
# ==============================================================================
# 模块归属: 工程效能与构建期工具链 (Tooling · 二进制编解码核心)
# 文件路径: WebGames/scripts/py/lib/kdat_payload_codec.py
# 架构定位: KDS (Kalar Data Stream) TLV 与字符串池编解码核心算子库
# 依赖与触发: 触发方: kalar_config_compiler.py | 下游: 纯净字节流
# 职责说明: 提供高纯度二进制数据流 (.kdat) 的类型标签 (TLV) 编码器、解码器、
#           高频字符串驻留池构建算法、掩码混淆算子与结构化编译结果元数据。
# 退出语义与设计依据: 纯计算无状态库 | 依据: Inv-ROUNDTRIP-BYTE-PARITY-1
# ==============================================================================
"""kdat_payload_codec.py — 卡拉尔世界引擎二进制 TLV 编解码与字符串驻留池核心。"""

from collections import Counter
from dataclasses import dataclass
from pathlib import Path
import struct
from typing import Any

# ==============================================================================
# 一、协议魔数与常量定义
# ==============================================================================

MAGIC_KDAT = 0x4B444154  # 'K', 'D', 'A', 'T'
FORMAT_VERSION_1_0 = 0x0100
HEADER_SIZE = 32

FLAG_COMPRESSED = 0x0001
FLAG_STRING_POOL = 0x0002
FLAG_MONOLITHIC_TOC = 0x0004
FLAG_LITTLE_ENDIAN = 0x0008
FLAG_ENCRYPTED = 0x0010

COMPRESS_RAW = 0
COMPRESS_DEFLATE = 1
COMPRESS_ZSTD = 2

PAYLOAD_SINGLE_TABLE = 1
PAYLOAD_MONOLITHIC_BUNDLE = 2
PAYLOAD_MOD_PACKAGE = 3

# TLV 类型标签定义
TAG_NIL = 0x00
TAG_BOOL_FALSE = 0x01
TAG_BOOL_TRUE = 0x02
TAG_INT32 = 0x03
TAG_INT64 = 0x04
TAG_FLOAT64 = 0x05
TAG_STRING = 0x06
TAG_STRING_REF = 0x07
TAG_ARRAY = 0x08
TAG_DICT = 0x09
TAG_BINARY_BLOB = 0x0A

DEFAULT_MASK_KEY_SEED = 0x5A


def apply_stream_mask(payload: bytes, key_seed: int = DEFAULT_MASK_KEY_SEED) -> bytes:
    """确定性流式加解密混淆遮罩 (可逆 XOR 轮转算子，零额外堆开销)。"""
    out = bytearray(len(payload))
    for i, b in enumerate(payload):
        mask = (key_seed + (i * 37)) & 0xFF
        out[i] = b ^ mask
    return bytes(out)


@dataclass
class CompiledKDataResult:
    """编译结果元数据对象"""
    output_path: Path
    uncompressed_size: int
    compressed_size: int
    compression_ratio: float
    crc32_hex: str
    sha256_hex: str
    table_name: str


# ==============================================================================
# 二、字符串驻留池萃取与 TLV 序列化器
# ==============================================================================

def collect_string_frequencies(data: Any, freq: Counter) -> None:
    """递归统计对象中字符串与键名的出现频度，用于建立字符串驻留池。"""
    if isinstance(data, dict):
        for k, v in data.items():
            freq[str(k)] += 2  # 字典键名权重加倍
            collect_string_frequencies(v, freq)
    elif isinstance(data, list):
        for item in data:
            collect_string_frequencies(item, freq)
    elif isinstance(data, str):
        if len(data) <= 64:  # 短字符串纳入候选
            freq[data] += 1


def build_string_pool(data: Any, max_pool_size: int = 1024) -> tuple[list[str], dict[str, int]]:
    """筛选出现频度 >= 2 的高频字符串构建首部索引池。"""
    freq: Counter = Counter()
    collect_string_frequencies(data, freq)
    candidates = [s for s, count in freq.most_common(max_pool_size) if count >= 2]
    pool_list = sorted(candidates)  # 确定性字母序排序
    pool_map = {s: i for i, s in enumerate(pool_list)}
    return pool_list, pool_map


def encode_tlv(val: Any, pool_map: dict[str, int], out: bytearray) -> None:
    """将 Python 原生类型递归编码为纯净 TLV 二进制字节流。"""
    if val is None:
        out.append(TAG_NIL)
    elif isinstance(val, bool):
        out.append(TAG_BOOL_TRUE if val else TAG_BOOL_FALSE)
    elif isinstance(val, int):
        if -0x80000000 <= val <= 0x7FFFFFFF:
            out.append(TAG_INT32)
            out.extend(struct.pack("<i", val))
        else:
            out.append(TAG_INT64)
            out.extend(struct.pack("<q", val))
    elif isinstance(val, float):
        out.append(TAG_FLOAT64)
        out.extend(struct.pack("<d", val))
    elif isinstance(val, str):
        if val in pool_map and pool_map[val] <= 0xFFFF:
            out.append(TAG_STRING_REF)
            out.extend(struct.pack("<H", pool_map[val]))
        else:
            utf8 = val.encode("utf-8")
            if len(utf8) > 0xFFFF:
                raise ValueError(f"字符串超出 65535 字节长度限制: {val[:30]}...")
            out.append(TAG_STRING)
            out.extend(struct.pack("<H", len(utf8)))
            out.extend(utf8)
    elif isinstance(val, list):
        out.append(TAG_ARRAY)
        out.extend(struct.pack("<I", len(val)))
        for item in val:
            encode_tlv(item, pool_map, out)
    elif isinstance(val, (bytes, bytearray)):
        out.append(TAG_BINARY_BLOB)
        out.extend(struct.pack("<I", len(val)))
        mime_bytes = b"application/octet-stream"
        out.extend(struct.pack("<H", len(mime_bytes)))
        out.extend(mime_bytes)
        out.extend(val)
    elif isinstance(val, dict) and val.get("__type") == "binary_blob":
        out.append(TAG_BINARY_BLOB)
        blob_bytes = val.get("data", b"")
        if isinstance(blob_bytes, str):
            blob_bytes = blob_bytes.encode("utf-8")
        out.extend(struct.pack("<I", len(blob_bytes)))
        mime_bytes = str(val.get("mime_type", "application/octet-stream")).encode("utf-8")
        out.extend(struct.pack("<H", len(mime_bytes)))
        out.extend(mime_bytes)
        out.extend(blob_bytes)
    elif isinstance(val, dict):
        out.append(TAG_DICT)
        out.extend(struct.pack("<I", len(val)))
        sorted_keys = sorted(val.keys(), key=lambda k: str(k))
        for k in sorted_keys:
            encode_tlv(str(k), pool_map, out)
            encode_tlv(val[k], pool_map, out)
    else:
        encode_tlv(str(val), pool_map, out)


# ==============================================================================
# 三、TLV 解码器与反编译器
# ==============================================================================

class TLVDecoder:
    """流式解码器，反解 TLV 字节流为 Python 原始数据对象。"""

    def __init__(self, data: bytes, string_pool: list[str]) -> None:
        self.data = data
        self.offset = 0
        self.pool = string_pool

    def decode_next(self) -> Any:
        """从当前字节游标顺序解码单个 TLV 值并推进偏移。"""
        if self.offset >= len(self.data):
            raise ValueError("TLV 解码提前遇到流末尾")
        tag = self.data[self.offset]
        self.offset += 1

        if tag == TAG_NIL:
            return None
        if tag == TAG_BOOL_FALSE:
            return False
        if tag == TAG_BOOL_TRUE:
            return True
        if tag == TAG_INT32:
            val = struct.unpack_from("<i", self.data, self.offset)[0]
            self.offset += 4
            return val
        if tag == TAG_INT64:
            val = struct.unpack_from("<q", self.data, self.offset)[0]
            self.offset += 8
            return val
        if tag == TAG_FLOAT64:
            val = struct.unpack_from("<d", self.data, self.offset)[0]
            self.offset += 8
            return val
        if tag == TAG_STRING:
            str_len = struct.unpack_from("<H", self.data, self.offset)[0]
            self.offset += 2
            s_bytes = self.data[self.offset : self.offset + str_len]
            self.offset += str_len
            return s_bytes.decode("utf-8")
        if tag == TAG_STRING_REF:
            pool_idx = struct.unpack_from("<H", self.data, self.offset)[0]
            self.offset += 2
            if pool_idx >= len(self.pool):
                raise ValueError(f"字符串驻留池索引越界: {pool_idx} >= {len(self.pool)}")
            return self.pool[pool_idx]
        if tag == TAG_ARRAY:
            count = struct.unpack_from("<I", self.data, self.offset)[0]
            self.offset += 4
            arr = []
            for _ in range(count):
                arr.append(self.decode_next())
            return arr
        if tag == TAG_DICT:
            count = struct.unpack_from("<I", self.data, self.offset)[0]
            self.offset += 4
            d = {}
            for _ in range(count):
                k = str(self.decode_next())
                v = self.decode_next()
                d[k] = v
            return d
        if tag == TAG_BINARY_BLOB:
            data_len = struct.unpack_from("<I", self.data, self.offset)[0]
            self.offset += 4
            mime_len = struct.unpack_from("<H", self.data, self.offset)[0]
            self.offset += 2
            mime = self.data[self.offset : self.offset + mime_len].decode("utf-8")
            self.offset += mime_len
            raw_blob = self.data[self.offset : self.offset + data_len]
            self.offset += data_len
            return {"__type": "binary_blob", "mime_type": mime, "data": bytes(raw_blob)}
        raise ValueError(f"未知 TLV 数据标签: 0x{tag:02X} (位于偏移 {self.offset - 1})")
