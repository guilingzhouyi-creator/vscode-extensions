# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Configuration Core)
# 文件路径: res://backend/infrastructure/binary_config_reader.gd
# 架构定位: 高纯度二进制数据流 (.kdat) 解码器 (Binary Config Reader)
# 依赖与触发: 上游: GameConfig, AuxiliaryWorkerPool | 下游: FileAccess, StreamPeerBuffer | 配置: 无 | 信号: 无
# 职责说明: 高性能流式解析 .kdat 高纯度紧凑二进制流；
#           负责魔数拦截、CRC32 完整性校验、DEFLATE 解压、字符串驻留池还原与 TLV 装配；
#           支持单表极速读取与全库单包融合模式 (Monolithic Bundle) 的 TOC 索引解析。
# 退出语义与设计依据: 生产级二进制容器规约 (Inv-KDAT-MAGIC-PARITY-1 / Inv-ZERO-HEAP-DECODE-2)
# ==============================================================================

## BinaryConfigReader：.kdat 高纯度二进制数据流高性能解码器
class_name BinaryConfigReader
extends RefCounted

# ==============================================================================
# 一、协议魔数与常量定义
# ==============================================================================

const MAGIC_KDAT: int = 0x4B444154 # 'K', 'D', 'A', 'T'
const FORMAT_VERSION: int = 0x0100
const HEADER_SIZE: int = 32

const FLAG_COMPRESSED: int = 0x0001
const FLAG_STRING_POOL: int = 0x0002
const FLAG_MONOLITHIC_TOC: int = 0x0004
const FLAG_LITTLE_ENDIAN: int = 0x0008
const FLAG_ENCRYPTED: int = 0x0010

const COMPRESS_RAW: int = 0
const COMPRESS_DEFLATE: int = 1
const COMPRESS_ZSTD: int = 2

const PAYLOAD_SINGLE_TABLE: int = 1
const PAYLOAD_MONOLITHIC_BUNDLE: int = 2
const PAYLOAD_MOD_PACKAGE: int = 3

const TAG_NIL: int = 0x00
const TAG_BOOL_FALSE: int = 0x01
const TAG_BOOL_TRUE: int = 0x02
const TAG_INT32: int = 0x03
const TAG_INT64: int = 0x04
const TAG_FLOAT64: int = 0x05
const TAG_STRING: int = 0x06
const TAG_STRING_REF: int = 0x07
const TAG_ARRAY: int = 0x08
const TAG_DICT: int = 0x09
const TAG_BINARY_BLOB: int = 0x0A

static var _crc_table: PackedInt32Array = PackedInt32Array()

# ==============================================================================
# 二、CRC32 完整性计算
# ==============================================================================

## 惰性初始化 CRC-32 静态查找表 (IEEE 802.3)
static func _ensure_crc_table() -> void:
	if not _crc_table.is_empty():
		return
	_crc_table.resize(256)
	for i in range(256):
		var c: int = i
		for _j in range(8):
			if (c & 1) != 0:
				c = 0xEDB88320 ^ ((c >> 1) & 0x7FFFFFFF)
			else:
				c = (c >> 1) & 0x7FFFFFFF
		_crc_table[i] = c

## 计算二进制字节数组的 CRC-32 校验和
static func compute_crc32(bytes: PackedByteArray) -> int:
	_ensure_crc_table()
	var c: int = 0xFFFFFFFF
	var sz: int = bytes.size()
	for i in range(sz):
		var b: int = bytes[i]
		var idx: int = (c ^ b) & 0xFF
		c = _crc_table[idx] ^ ((c >> 8) & 0x00FFFFFF)
	return (c ^ 0xFFFFFFFF) & 0xFFFFFFFF

# ==============================================================================
# 三、核心解码与文件加载 API
# ==============================================================================

## 从物理文件路径加载并解码 .kdat 数据
static func load_kdat_file(file_path: String) -> Variant:
	if not FileAccess.file_exists(file_path):
		return null
	var file := FileAccess.open(file_path, FileAccess.READ)
	if file == null:
		return null
	var buffer := file.get_buffer(file.get_length())
	file.close()
	return load_kdat_buffer(buffer)

## 从内存 PackedByteArray 解码 .kdat 数据
static func load_kdat_buffer(buffer: PackedByteArray) -> Variant:
	if buffer.size() < HEADER_SIZE:
		return null

	var header_buf := StreamPeerBuffer.new()
	header_buf.data_array = buffer
	header_buf.big_endian = false

	var magic: int = header_buf.get_u32()
	var version: int = header_buf.get_u16()
	var flags: int = header_buf.get_u16()
	var compress_type: int = header_buf.get_u8()
	var _payload_type: int = header_buf.get_u8()
	var header_len: int = header_buf.get_u16()
	var uncompressed_size: int = header_buf.get_u32()
	var compressed_size: int = header_buf.get_u32()
	var crc32_val: int = header_buf.get_u32()

	if magic != MAGIC_KDAT or version != FORMAT_VERSION:
		return null
	if buffer.size() < header_len + compressed_size:
		return null

	var payload_slice := buffer.slice(header_len, header_len + compressed_size)
	var actual_crc: int = compute_crc32(payload_slice)
	if actual_crc != crc32_val:
		return null

	var payload_to_decompress: PackedByteArray
	if (flags & FLAG_ENCRYPTED) != 0:
		payload_to_decompress = ClientSecretVault.unmask_stream(payload_slice)
	else:
		payload_to_decompress = payload_slice

	var raw_payload: PackedByteArray
	if (flags & FLAG_COMPRESSED) != 0:
		if compress_type == COMPRESS_DEFLATE:
			raw_payload = payload_to_decompress.decompress(uncompressed_size, FileAccess.COMPRESSION_DEFLATE)
		elif compress_type == COMPRESS_ZSTD:
			raw_payload = payload_to_decompress.decompress(uncompressed_size, FileAccess.COMPRESSION_ZSTD)
		else:
			return null
	else:
		raw_payload = payload_to_decompress

	if raw_payload.size() != uncompressed_size:
		return null

	return _decode_payload_stream(raw_payload)

# ==============================================================================
# 四、TLV 数据流解析与装配
# ==============================================================================

## 解析解压后的原始载荷流（含字符串池与 TLV 根节点）
static func _decode_payload_stream(raw_payload: PackedByteArray) -> Variant:
	var buf := StreamPeerBuffer.new()
	buf.data_array = raw_payload
	buf.big_endian = false

	# 1. 解析首部字符串池
	var pool_len: int = buf.get_u16()
	var pool: Array[String] = []
	pool.resize(pool_len)
	for i in range(pool_len):
		var s_len: int = buf.get_u16()
		pool[i] = buf.get_utf8_string(s_len)

	# 2. 递归解析 TLV
	return _decode_tlv_value(buf, pool)

## 递归解析单个 TLV 数据项（形参 <= 5）
static func _decode_tlv_value(buf: StreamPeerBuffer, pool: Array[String]) -> Variant:
	if buf.get_position() >= buf.get_size():
		return null
	var tag: int = buf.get_u8()

	if tag == TAG_NIL:
		return null
	if tag == TAG_BOOL_FALSE:
		return false
	if tag == TAG_BOOL_TRUE:
		return true
	if tag == TAG_INT32:
		return buf.get_32()
	if tag == TAG_INT64:
		return buf.get_64()
	if tag == TAG_FLOAT64:
		return buf.get_double()
	if tag == TAG_STRING:
		var s_len: int = buf.get_u16()
		return buf.get_utf8_string(s_len)
	if tag == TAG_STRING_REF:
		var idx: int = buf.get_u16()
		if idx < pool.size():
			return pool[idx]
		return ""
	if tag == TAG_ARRAY:
		var count: int = buf.get_u32()
		var arr: Array = []
		arr.resize(count)
		for i in range(count):
			arr[i] = _decode_tlv_value(buf, pool)
		return arr
	if tag == TAG_DICT:
		var count: int = buf.get_u32()
		var d: Dictionary = {}
		for _i in range(count):
			var k: String = str(_decode_tlv_value(buf, pool))
			var v: Variant = _decode_tlv_value(buf, pool)
			d[k] = v
		return d
	if tag == TAG_BINARY_BLOB:
		var data_len: int = buf.get_u32()
		var mime_len: int = buf.get_u16()
		var mime: String = buf.get_utf8_string(mime_len)
		var blob_data: PackedByteArray = buf.data_array.slice(buf.get_position(), buf.get_position() + data_len)
		buf.seek(buf.get_position() + data_len)
		return {
			"__type": "binary_blob",
			"mime_type": mime,
			"data": blob_data
		}
	return null

# ==============================================================================
# 五、单包融合模式 (Monolithic Bundle) 装配
# ==============================================================================

## 从全库单包 config.kdat 解码全量配置表字典 { "domains.combat.mechanics": Dictionary, ... }
static func load_monolithic_bundle(file_path: String) -> Dictionary:
	var raw_data: Variant = load_kdat_file(file_path)
	if raw_data == null or not (raw_data is Dictionary):
		return {}

	var toc_list: Variant = raw_data.get("toc", null)
	var payload_bytes: Variant = raw_data.get("payload", null)
	if payload_bytes is Dictionary and (payload_bytes as Dictionary).has("data"):
		payload_bytes = (payload_bytes as Dictionary)["data"]
	if not (toc_list is Array) or not (payload_bytes is PackedByteArray):
		return {}

	var result: Dictionary = {}
	var payload: PackedByteArray = payload_bytes
	for entry in (toc_list as Array):
		if not (entry is Dictionary):
			continue
		var t_name: String = str(entry.get("table_name", ""))
		var offset: int = int(entry.get("offset", 0))
		var length: int = int(entry.get("length", 0))
		if t_name.is_empty() or offset + length > payload.size():
			continue

		var table_slice := payload.slice(offset, offset + length)
		var table_data: Variant = _decode_payload_stream(table_slice)
		if table_data != null and (table_data is Dictionary):
			result[t_name] = table_data

	return result
