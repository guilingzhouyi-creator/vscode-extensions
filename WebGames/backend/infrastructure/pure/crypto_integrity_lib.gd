# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Pure Cryptography & Integrity Library)
# 文件路径: res://backend/infrastructure/pure/crypto_integrity_lib.gd
# 架构定位: Pure Cryptographic & Tamper-Evident Calculation Library
# 依赖与触发: 上游: LogFileExporter, LogQueryService, RedactionRule, SaveManager, GMArbitrationAuditService, EntitlementService | 下游: Godot Crypto, AESContext, HashingContext, GameConfig, OS | 配置: 按调用方传入配置表 | 信号: 无
# 职责说明: 全域纯计算密码学与防篡改哈希链域库：集中提供加盐摘要、HMAC-SHA256、常量时间比对、PKCS7 填充、AES-256-CBC 加解密及 Encrypt-then-MAC 日志审计信封算子。
# 退出语义与设计依据: 核心数据加密脱敏契约 / 纯计算域库化集中治理规范
# ==============================================================================

## CryptoIntegrityLib：Pure Cryptographic & Tamper-Evident Calculation Library
class_name CryptoIntegrityLib extends RefCounted

# ==============================================================================
# 一、哈希摘要、加盐与密钥派生算子 (Pure Functions)
# ==============================================================================

## 计算字符串 SHA-256 十六进制小写摘要
static func sha256_hex(content: String) -> String:
	return content.sha256_text()

## 加盐域隔离摘要：防止低熵 ID（如短账号、序号）遭受彩虹表反查
static func salted_hash_hex(input_text: String, salt: String = "", domain_tag: String = LogConstants.DEFAULT_SALT_DOMAIN) -> String:
	var effective_salt := salt if not salt.is_empty() else domain_tag
	var material := "%s|%s|%s" % [domain_tag, effective_salt, input_text]
	return material.sha256_text()

## 计算原生 HMAC-SHA256 原始字节序列（Fail-Closed：空密钥返回空数组）
static func hmac_sha256_bytes(key: PackedByteArray, payload: PackedByteArray) -> PackedByteArray:
	if key.is_empty():
		return PackedByteArray()
	return Crypto.new().hmac_digest(HashingContext.HASH_SHA256, key, payload)

## 计算 HMAC-SHA256 十六进制字符串签名
static func hmac_sha256_hex(key: PackedByteArray, payload: PackedByteArray) -> String:
	var digest := hmac_sha256_bytes(key, payload)
	return digest.hex_encode() if not digest.is_empty() else ""

## 便捷字符串输入 HMAC-SHA256 签名（UTF-8 编码，空密钥返回空串）
static func hmac_sha256_text(secret_key_text: String, payload_text: String) -> String:
	if secret_key_text.is_empty():
		return ""
	return hmac_sha256_hex(secret_key_text.to_utf8_buffer(), payload_text.to_utf8_buffer())

## 常量时间字符串相等性比对（防时序侧信道攻击，等长/不等长输入均完整遍历 max 长度不提前短路）
static func constant_time_equals(left_text: String, right_text: String) -> bool:
	var left_bytes := left_text.to_utf8_buffer()
	var right_bytes := right_text.to_utf8_buffer()
	var max_length: int = maxi(left_bytes.size(), right_bytes.size())
	var xor_difference: int = left_bytes.size() ^ right_bytes.size()
	for byte_index in range(max_length):
		var left_byte: int = int(left_bytes[byte_index]) if byte_index < left_bytes.size() else 0
		var right_byte: int = int(right_bytes[byte_index]) if byte_index < right_bytes.size() else 0
		xor_difference |= left_byte ^ right_byte
	return xor_difference == 0

## 32 字节主密钥域隔离次级子密钥派生算子（用于严格分离 AES 加密密钥与 HMAC 认证密钥）
static func derive_subkey_32(master_key_32: PackedByteArray, subkey_context: String) -> PackedByteArray:
	if master_key_32.size() != LogConstants.AES_KEY_SIZE or subkey_context.is_empty():
		return PackedByteArray()
	var hashing_context := HashingContext.new()
	if hashing_context.start(HashingContext.HASH_SHA256) != OK:
		return PackedByteArray()
	hashing_context.update(subkey_context.to_utf8_buffer())
	hashing_context.update(PackedByteArray([0x00]))
	hashing_context.update(master_key_32)
	var subkey := hashing_context.finish()
	return subkey if subkey.size() == LogConstants.AES_KEY_SIZE else PackedByteArray()

## 域隔离 32 字节（256-bit）对称密钥派生算子（SHA-256 域绑定推导）
static func derive_key_32(secret_material: String, domain_context: String = LogConstants.ENC_DOMAIN_CONTEXT) -> PackedByteArray:
	if secret_material.is_empty():
		return PackedByteArray()
	var hashing_context := HashingContext.new()
	if hashing_context.start(HashingContext.HASH_SHA256) != OK:
		return PackedByteArray()
	hashing_context.update(domain_context.to_utf8_buffer())
	hashing_context.update(PackedByteArray([0x00]))
	hashing_context.update(secret_material.to_utf8_buffer())
	var key := hashing_context.finish()
	return key if key.size() == LogConstants.AES_KEY_SIZE else PackedByteArray()

## 统一受控环境密封密钥加载（从 GameConfig 指定环境变量获取，严禁回退明文配置元数据）
static func resolve_seal_key_bytes(config_table: String, config_path: String, fallback_environment_var: String = "") -> PackedByteArray:
	var environment_variable_name := GameConfig.get_string(config_table, config_path, fallback_environment_var)
	if environment_variable_name.is_empty():
		return PackedByteArray()
	var secret_value := OS.get_environment(environment_variable_name)
	return secret_value.to_utf8_buffer() if not secret_value.is_empty() else PackedByteArray()

## 从指定环境变量读取密钥原语并派生 32 字节（256-bit）对称加密/验签密钥
static func resolve_derived_key_32(environment_variable_name: String, domain_context: String = LogConstants.ENC_DOMAIN_CONTEXT) -> PackedByteArray:
	if environment_variable_name.is_empty():
		return PackedByteArray()
	var raw_secret := OS.get_environment(environment_variable_name)
	if raw_secret.is_empty():
		return PackedByteArray()
	return derive_key_32(raw_secret, domain_context)

# ==============================================================================
# 二、PKCS7 填充与 AES-256-CBC 对称加密算子
# ==============================================================================

## PKCS7 标准块填充（block_size 默认 16 字节）
static func pkcs7_pad(raw_bytes: PackedByteArray, block_size: int = LogConstants.AES_BLOCK_SIZE) -> PackedByteArray:
	var padding_length: int = block_size - (raw_bytes.size() % block_size)
	var padded_bytes := raw_bytes.duplicate()
	var original_size := padded_bytes.size()
	padded_bytes.resize(original_size + padding_length)
	for byte_index in range(original_size, padded_bytes.size()):
		padded_bytes[byte_index] = padding_length
	return padded_bytes

## PKCS7 标准逆填充校验（畸形填充返回空字节序列）
static func pkcs7_unpad(padded: PackedByteArray, block_size: int = LogConstants.AES_BLOCK_SIZE) -> PackedByteArray:
	var padded_size := padded.size()
	if padded_size == 0 or (padded_size % block_size) != 0:
		return PackedByteArray()
	var padding_length := int(padded[padded_size - 1])
	if padding_length < 1 or padding_length > block_size or padding_length > padded_size:
		return PackedByteArray()
	# 全程按位累加校验每个填充字节，消除提前短路带来的 padding-oracle 时序差异
	var invalid_mask := 0
	for byte_index in range(padded_size - padding_length, padded_size):
		invalid_mask |= int(padded[byte_index]) ^ padding_length
	if invalid_mask != 0:
		return PackedByteArray()
	return padded.slice(0, padded_size - padding_length)

## AES-256-CBC 加密并输出 Base64 密文串
static func aes_cbc_encrypt_b64(plaintext: PackedByteArray, key_32: PackedByteArray, initialization_vector: PackedByteArray) -> String:
	if key_32.size() != LogConstants.AES_KEY_SIZE or initialization_vector.size() != LogConstants.AES_BLOCK_SIZE:
		return ""
	var aes_context := AESContext.new()
	if aes_context.start(AESContext.MODE_CBC_ENCRYPT, key_32, initialization_vector) != OK:
		return ""
	var padded := pkcs7_pad(plaintext, LogConstants.AES_BLOCK_SIZE)
	var encrypted := aes_context.update(padded)
	aes_context.finish()
	return Marshalls.raw_to_base64(encrypted) if not encrypted.is_empty() else ""

## AES-256-CBC Base64 解密并还原原始字节序列（失败返回空数组）
static func aes_cbc_decrypt_b64(ciphertext_base64: String, key_32: PackedByteArray, initialization_vector: PackedByteArray) -> PackedByteArray:
	if ciphertext_base64.is_empty() or key_32.size() != LogConstants.AES_KEY_SIZE or initialization_vector.size() != LogConstants.AES_BLOCK_SIZE:
		return PackedByteArray()
	var raw_cipher := Marshalls.base64_to_raw(ciphertext_base64)
	if raw_cipher.is_empty() or (raw_cipher.size() % LogConstants.AES_BLOCK_SIZE) != 0:
		return PackedByteArray()
	var aes_context := AESContext.new()
	if aes_context.start(AESContext.MODE_CBC_DECRYPT, key_32, initialization_vector) != OK:
		return PackedByteArray()
	var decrypted := aes_context.update(raw_cipher)
	aes_context.finish()
	return pkcs7_unpad(decrypted, LogConstants.AES_BLOCK_SIZE)

# ==============================================================================
# 三、防篡改哈希链与 Encrypt-then-MAC 日志密封信封
# ==============================================================================

## 计算单调递增审计哈希链节点：SHA256(previous_hash | sequence | payload_text)
static func compute_chain_digest(previous_hash: String, sequence: int, payload_text: String) -> String:
	var normalized_previous_hash := previous_hash if not previous_hash.is_empty() else LogConstants.CHAIN_GENESIS_HASH
	return ("%s|%d|%s" % [normalized_previous_hash, sequence, payload_text]).sha256_text()

## 构造 Encrypt-then-MAC 安全日志加密信封（先派生独立 AES/HMAC 子密钥并 AES-256-CBC 加密，再附链哈希与 HMAC-SHA256 认证）
static func seal_log_record_envelope(
	record_json: String,
	sequence: int,
	key_32: PackedByteArray,
	previous_chain_hash: String = LogConstants.CHAIN_GENESIS_HASH
) -> Dictionary:
	if record_json.is_empty() or key_32.size() != LogConstants.AES_KEY_SIZE:
		return {}
	var encryption_key := derive_subkey_32(key_32, LogConstants.ENC_SUBKEY_AES_CONTEXT)
	var mac_key := derive_subkey_32(key_32, LogConstants.ENC_SUBKEY_HMAC_CONTEXT)
	var initialization_vector := Crypto.new().generate_random_bytes(LogConstants.AES_BLOCK_SIZE)
	var ciphertext_base64 := aes_cbc_encrypt_b64(record_json.to_utf8_buffer(), encryption_key, initialization_vector)
	if ciphertext_base64.is_empty():
		return {}
	var initialization_vector_hex := initialization_vector.hex_encode()
	var chain_hash := compute_chain_digest(previous_chain_hash, sequence, ciphertext_base64)
	var mac_payload := "%d:%s:%d:%s:%s:%s" % [LogConstants.ENC_VERSION_V1, LogConstants.ENC_ALGO_AES_256_CBC, sequence, initialization_vector_hex, ciphertext_base64, chain_hash]
	var mac_hex := hmac_sha256_hex(mac_key, mac_payload.to_utf8_buffer())
	return {
		LogConstants.ENC_KEY_VERSION: LogConstants.ENC_VERSION_V1,
		LogConstants.ENC_KEY_ALGO: LogConstants.ENC_ALGO_AES_256_CBC,
		LogConstants.ENC_KEY_SEQUENCE: sequence,
		LogConstants.ENC_KEY_IV: initialization_vector_hex,
		LogConstants.ENC_KEY_CIPHERTEXT: ciphertext_base64,
		LogConstants.ENC_KEY_CHAIN_HASH: chain_hash,
		LogConstants.ENC_KEY_MAC: mac_hex,
	}

## 验证并解封 Encrypt-then-MAC 安全日志信封（先常量时间验签含版本算法头，通过后再解密与序号一致性核验）
static func open_log_record_envelope(
	envelope: Dictionary,
	key_32: PackedByteArray,
	should_verify_mac: bool = true
) -> Dictionary:
	if not is_encrypted_envelope(envelope):
		return {"ok": false, "data": {}, "chain_hash": "", "error_code": "INVALID_ENVELOPE"}
	if key_32.size() != LogConstants.AES_KEY_SIZE:
		return {"ok": false, "data": {}, "chain_hash": "", "error_code": "INVALID_KEY_SIZE"}

	var version := int(envelope.get(LogConstants.ENC_KEY_VERSION, LogConstants.ENC_VERSION_V1))
	var algorithm_name := str(envelope.get(LogConstants.ENC_KEY_ALGO, LogConstants.ENC_ALGO_AES_256_CBC))
	var sequence_number := int(envelope.get(LogConstants.ENC_KEY_SEQUENCE, 0))
	var initialization_vector_hex := str(envelope.get(LogConstants.ENC_KEY_IV, ""))
	var ciphertext_base64 := str(envelope.get(LogConstants.ENC_KEY_CIPHERTEXT, ""))
	var chain_hash := str(envelope.get(LogConstants.ENC_KEY_CHAIN_HASH, ""))
	var mac_hex := str(envelope.get(LogConstants.ENC_KEY_MAC, ""))

	if should_verify_mac:
		var mac_key := derive_subkey_32(key_32, LogConstants.ENC_SUBKEY_HMAC_CONTEXT)
		var mac_payload := "%d:%s:%d:%s:%s:%s" % [version, algorithm_name, sequence_number, initialization_vector_hex, ciphertext_base64, chain_hash]
		var expected_mac := hmac_sha256_hex(mac_key, mac_payload.to_utf8_buffer())
		if not constant_time_equals(expected_mac, mac_hex):
			return {"ok": false, "data": {}, "chain_hash": chain_hash, "error_code": LogConstants.LOG_ERR_MAC_MISMATCH}

	var encryption_key := derive_subkey_32(key_32, LogConstants.ENC_SUBKEY_AES_CONTEXT)
	var initialization_vector_bytes := initialization_vector_hex.hex_decode()
	var plain_bytes := aes_cbc_decrypt_b64(ciphertext_base64, encryption_key, initialization_vector_bytes)
	if plain_bytes.is_empty():
		return {"ok": false, "data": {}, "chain_hash": chain_hash, "error_code": "DECRYPT_FAILED"}

	var parsed: Variant = JSON.parse_string(plain_bytes.get_string_from_utf8())
	if not (parsed is Dictionary):
		return {"ok": false, "data": {}, "chain_hash": chain_hash, "error_code": "JSON_PARSE_FAILED"}
	var parsed_payload: Dictionary = parsed
	if parsed_payload.has(LogConstants.KEY_SEQUENCE) and int(parsed_payload.get(LogConstants.KEY_SEQUENCE, sequence_number)) != sequence_number:
		return {"ok": false, "data": {}, "chain_hash": chain_hash, "error_code": "SEQUENCE_MISMATCH"}
	return {"ok": true, "data": parsed_payload, "chain_hash": chain_hash, "error_code": ""}

## 判断 JSON 字典是否为本引擎加密日志信封格式
static func is_encrypted_envelope(candidate_envelope: Dictionary) -> bool:
	return candidate_envelope.get(LogConstants.ENC_KEY_ALGO, "") == LogConstants.ENC_ALGO_AES_256_CBC \
		and candidate_envelope.has(LogConstants.ENC_KEY_CIPHERTEXT) \
		and candidate_envelope.has(LogConstants.ENC_KEY_IV)
