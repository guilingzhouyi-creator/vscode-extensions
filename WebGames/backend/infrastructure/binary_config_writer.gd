# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Configuration Core)
# 文件路径: res://backend/infrastructure/binary_config_writer.gd
# 架构定位: Infrastructure Encoder / .kdat High-Purity Binary Stream Writer
# 依赖与触发: 上游: WorldModArchiveOpsHelper, 测试与构建管线 | 下游: KDataHeaderDTO, BinaryConfigReader, ClientSecretVault, StreamPeerBuffer
# 职责说明: 将 Variant/Dictionary 数据编译为 .kdat 二进制流（32 字节定长头 + 字符串驻留池 + 递归 TLV + DEFLATE + CRC32），与 Python kdat_payload_codec 保持字节级双向互通。
# 退出语义与设计依据: 生产级二进制容器规约与双端契约一致性 (Inv-KDAT-MAGIC-PARITY-1)
# ==============================================================================

## BinaryConfigWriter：.kdat 二进制配置与 MOD 数据包编码器
class_name BinaryConfigWriter
extends RefCounted

const TAG_NIL: int = 0
const TAG_BOOL_FALSE: int = 1
const TAG_BOOL_TRUE: int = 2
const TAG_INT32: int = 3
const TAG_INT64: int = 4
const TAG_FLOAT64: int = 5
const TAG_STRING: int = 6
const TAG_STRING_REF: int = 7
const TAG_ARRAY: int = 8
const TAG_DICT: int = 9
const TAG_BINARY_BLOB: int = 10

const FLAG_ENCRYPTED: int = 0x0010
const INT32_MIN: int = -2147483648
const INT32_MAX: int = 2147483647
const MAX_STRING_POOL_SIZE: int = 65535
const LOG_CHANNEL: String = "config_kdat"

## 将任意 Variant（核心用于 Dictionary/Array）编译为完整 .kdat 字节流
static func encode_kdat_buffer(
	source_payload: Variant,
	compress: bool = true,
	payload_type: int = KDataHeaderDTO.PAYLOAD_MOD_PACKAGE,
	encrypt: bool = false
) -> PackedByteArray:
	var pool_strings := _build_string_pool(source_payload)
	var pool_index: Dictionary = {}
	for pool_position in range(pool_strings.size()):
		pool_index[pool_strings[pool_position]] = pool_position

	var raw_stream := StreamPeerBuffer.new()
	raw_stream.big_endian = false
	raw_stream.put_u16(pool_strings.size())
	for pooled_text in pool_strings:
		var utf8_bytes := pooled_text.to_utf8_buffer()
		raw_stream.put_u16(utf8_bytes.size())
		if not utf8_bytes.is_empty():
			raw_stream.put_data(utf8_bytes)

	if not _encode_tlv_value(raw_stream, source_payload, pool_index):
		return PackedByteArray()

	var raw_payload := raw_stream.data_array
	var uncompressed_size := raw_payload.size()
	var flags := KDataHeaderDTO.FLAG_LITTLE_ENDIAN | (KDataHeaderDTO.FLAG_STRING_POOL if not pool_strings.is_empty() else 0)
	var compress_type := KDataHeaderDTO.COMPRESS_RAW
	var final_payload := raw_payload
	if compress and uncompressed_size > 0:
		var compressed := raw_payload.compress(FileAccess.COMPRESSION_DEFLATE)
		if not compressed.is_empty() and compressed.size() < uncompressed_size:
			final_payload = compressed
			compress_type = KDataHeaderDTO.COMPRESS_DEFLATE
			flags |= KDataHeaderDTO.FLAG_COMPRESSED
	if encrypt:
		final_payload = ClientSecretVault.mask_stream(final_payload)
		flags |= FLAG_ENCRYPTED

	var header := KDataHeaderDTO.new()
	header.flags = flags
	header.compress_type = compress_type
	header.payload_type = payload_type
	header.uncompressed_size = uncompressed_size
	header.compressed_size = final_payload.size()
	header.crc32 = BinaryConfigReader.compute_crc32(final_payload)
	var out_bytes := header.serialize()
	out_bytes.append_array(final_payload)
	return out_bytes

static func _build_string_pool(root_value: Variant) -> Array[String]:
	var freq_map: Dictionary = {}
	_collect_string_frequencies(root_value, freq_map)
	var candidates: Array[String] = []
	for key_variant in freq_map.keys():
		var text := String(key_variant)
		if text.to_utf8_buffer().size() <= MAX_STRING_POOL_SIZE and int(freq_map[key_variant]) >= 2:
			candidates.append(text)
	candidates.sort()
	if candidates.size() > MAX_STRING_POOL_SIZE:
		candidates.resize(MAX_STRING_POOL_SIZE)
	return candidates

static func _collect_string_frequencies(current_value: Variant, freq_map: Dictionary) -> void:
	if current_value is String or current_value is StringName:
		var text := String(current_value)
		freq_map[text] = int(freq_map.get(text, 0)) + 1
		return
	if current_value is Array:
		for element in (current_value as Array):
			_collect_string_frequencies(element, freq_map)
		return
	if current_value is Dictionary:
		var table_value := current_value as Dictionary
		for key_variant in table_value.keys():
			var key_text := String(key_variant)
			freq_map[key_text] = maxi(int(freq_map.get(key_text, 0)) + 1, 2)
			_collect_string_frequencies(table_value[key_variant], freq_map)

static func _encode_string_token(stream: StreamPeerBuffer, text: String, pool_index: Dictionary) -> bool:
	if pool_index.has(text):
		stream.put_u8(TAG_STRING_REF)
		stream.put_u16(int(pool_index[text]))
		return true
	var utf8_bytes := text.to_utf8_buffer()
	if utf8_bytes.size() > MAX_STRING_POOL_SIZE:
		ErrorReporter.emit_error(LOG_CHANNEL, "CONFIG_VALIDATION_FAILED", TemplateFormatter.format("String exceeds .kdat u16 byte limit: {byte_len}", {"byte_len": utf8_bytes.size()}), {"byte_len": utf8_bytes.size()})
		return false
	stream.put_u8(TAG_STRING)
	stream.put_u16(utf8_bytes.size())
	if not utf8_bytes.is_empty():
		stream.put_data(utf8_bytes)
	return true

static func _encode_tlv_value(stream: StreamPeerBuffer, node_value: Variant, pool_index: Dictionary) -> bool:
	match typeof(node_value):
		TYPE_NIL:
			stream.put_u8(TAG_NIL)
			return true
		TYPE_BOOL:
			stream.put_u8(TAG_BOOL_TRUE if bool(node_value) else TAG_BOOL_FALSE)
			return true
		TYPE_INT:
			var signed_number := int(node_value)
			if signed_number >= INT32_MIN and signed_number <= INT32_MAX:
				stream.put_u8(TAG_INT32)
				stream.put_32(signed_number)
			else:
				stream.put_u8(TAG_INT64)
				stream.put_64(signed_number)
			return true
		TYPE_FLOAT:
			stream.put_u8(TAG_FLOAT64)
			stream.put_double(float(node_value))
			return true
		TYPE_STRING, TYPE_STRING_NAME:
			return _encode_string_token(stream, String(node_value), pool_index)
		TYPE_PACKED_BYTE_ARRAY:
			return _encode_binary_blob(stream, node_value as PackedByteArray)
		TYPE_ARRAY:
			return _encode_array_tlv(stream, node_value as Array, pool_index)
		TYPE_DICTIONARY:
			return _encode_dict_tlv(stream, node_value as Dictionary, pool_index)
		_:
			return _encode_string_token(stream, str(node_value), pool_index)

static func _encode_binary_blob(stream: StreamPeerBuffer, blob: PackedByteArray) -> bool:
	var mime_bytes := "application/octet-stream".to_utf8_buffer()
	stream.put_u8(TAG_BINARY_BLOB)
	stream.put_u32(blob.size())
	stream.put_u16(mime_bytes.size())
	stream.put_data(mime_bytes)
	if not blob.is_empty():
		stream.put_data(blob)
	return true

static func _encode_array_tlv(stream: StreamPeerBuffer, source_list: Array, pool_index: Dictionary) -> bool:
	stream.put_u8(TAG_ARRAY)
	stream.put_u32(source_list.size())
	for element in source_list:
		if not _encode_tlv_value(stream, element, pool_index):
			return false
	return true

static func _encode_dict_tlv(stream: StreamPeerBuffer, source_table: Dictionary, pool_index: Dictionary) -> bool:
	var sorted_keys: Array[String] = []
	var key_lookup: Dictionary = {}
	for raw_key in source_table.keys():
		var string_key := String(raw_key)
		sorted_keys.append(string_key)
		key_lookup[string_key] = raw_key
	sorted_keys.sort()
	stream.put_u8(TAG_DICT)
	stream.put_u32(sorted_keys.size())
	for string_key in sorted_keys:
		if not _encode_string_token(stream, string_key, pool_index):
			return false
		if not _encode_tlv_value(stream, source_table[key_lookup[string_key]], pool_index):
			return false
	return true
