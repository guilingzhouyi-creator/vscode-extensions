# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Pure Cryptography & Integrity Library)
# 文件路径: res://backend/infrastructure/pure/crypto_integrity_lib.gd
# 架构定位: Pure Cryptographic & Tamper-Evident Calculation Library
# 依赖与触发: 上游: LogFileExporter, LogQueryService, RedactionRule, SaveManager, GMArbitrationAuditService, EntitlementService | 下游: Godot Crypto, AESContext, HashingContext | 配置: 无 | 信号: 无
# 职责说明: 全域纯计算密码学与防篡改哈希链域库：集中提供加盐摘要、HMAC-SHA256、常量时间比对、PKCS7 填充、AES-256-CBC 加解密及 Encrypt-then-MAC 日志审计信封算子。
# 退出语义与设计依据: 核心数据加密脱敏契约 / 纯计算域库化集中治理规范
# ==============================================================================

## CryptoIntegrityLib：Pure Cryptographic & Tamper-Evident Calculation Library
class_name CryptoIntegrityLib extends RefCounted

const LogConstants = preload("res://backend/infrastructure/logging/log_constants.gd")

# ==============================================================================
# 一、哈希摘要、加盐与密钥派生算子 (Pure Functions)
# ==============================================================================

## 计算字符串 SHA-256 十六进制小写摘要
static func sha256_hex(content: String) -> String:
	return content.sha256_text()

## 加盐域隔离摘要：防止低熵 ID（如短账号、序号）遭受彩虹表反查
static func salted_hash_hex(value: String, salt: String = "", domain_tag: String = LogConstants.DEFAULT_SALT_DOMAIN) -> String:
	var eff_salt := salt if not salt.is_empty() else domain_tag
	var material := "%s|%s|%s" % [domain_tag, eff_salt, value]
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
static func hmac_sha256_text(key_str: String, payload_str: String) -> String:
	if key_str.is_empty():
		return ""
	return hmac_sha256_hex(key_str.to_utf8_buffer(), payload_str.to_utf8_buffer())

## 常量时间字符串相等性比对（防时序侧信道攻击，不因首字节差异提前短路退出）
static func constant_time_equals(a: String, b: String) -> bool:
	var ab := a.to_utf8_buffer()
	var bb := b.to_utf8_buffer()
	var diff: int = ab.size() ^ bb.size()
	var n: int = mini(ab.size(), bb.size())
	for i in range(n):
		diff |= int(ab[i]) ^ int(bb[i])
	return diff == 0

## 域隔离 32 字节（256-bit）对称密钥派生算子（SHA-256 域绑定推导）
static func derive_key_32(secret_material: String, domain_context: String = LogConstants.ENC_DOMAIN_CONTEXT) -> PackedByteArray:
	if secret_material.is_empty():
		return PackedByteArray()
	var hc := HashingContext.new()
	if hc.start(HashingContext.HASH_SHA256) != OK:
		return PackedByteArray()
	hc.update(domain_context.to_utf8_buffer())
	hc.update(PackedByteArray([0x00]))
	hc.update(secret_material.to_utf8_buffer())
	var key := hc.finish()
	return key if key.size() == LogConstants.AES_KEY_SIZE else PackedByteArray()

## 统一受控环境密封密钥加载（从 GameConfig 指定环境变量获取，严禁回退明文配置元数据）
static func resolve_seal_key_bytes(config_table: String, config_path: String, fallback_env: String = "") -> PackedByteArray:
	var env_name := GameConfig.get_string(config_table, config_path, fallback_env)
	if env_name.is_empty():
		return PackedByteArray()
	var secret_val := OS.get_environment(env_name)
	return secret_val.to_utf8_buffer() if not secret_val.is_empty() else PackedByteArray()

## 从指定环境变量读取密钥原语并派生 32 字节（256-bit）对称加密/验签密钥
static func resolve_derived_key_32(env_name: String, domain_context: String = LogConstants.ENC_DOMAIN_CONTEXT) -> PackedByteArray:
	if env_name.is_empty():
		return PackedByteArray()
	var raw_secret := OS.get_environment(env_name)
	if raw_secret.is_empty():
		return PackedByteArray()
	return derive_key_32(raw_secret, domain_context)

# ==============================================================================
# 二、PKCS7 填充与 AES-256-CBC 对称加密算子
# ==============================================================================

## PKCS7 标准块填充（block_size 默认 16 字节）
static func pkcs7_pad(data: PackedByteArray, block_size: int = LogConstants.AES_BLOCK_SIZE) -> PackedByteArray:
	var pad_len: int = block_size - (data.size() % block_size)
	var out := data.duplicate()
	var old_sz := out.size()
	out.resize(old_sz + pad_len)
	for i in range(old_sz, out.size()):
		out[i] = pad_len
	return out

## PKCS7 标准逆填充校验（畸形填充返回空字节序列）
static func pkcs7_unpad(padded: PackedByteArray, block_size: int = LogConstants.AES_BLOCK_SIZE) -> PackedByteArray:
	var sz := padded.size()
	if sz == 0 or (sz % block_size) != 0:
		return PackedByteArray()
	var pad_len := int(padded[sz - 1])
	if pad_len < 1 or pad_len > block_size or pad_len > sz:
		return PackedByteArray()
	var invalid_acc := 0
	for i in range(sz - pad_len, sz):
		invalid_acc |= int(padded[i]) ^ pad_len
	if invalid_acc != 0:
		return PackedByteArray()
	return padded.slice(0, sz - pad_len)

## AES-256-CBC 加密并输出 Base64 密文串
static func aes_cbc_encrypt_b64(plaintext: PackedByteArray, key_32: PackedByteArray, iv_16: PackedByteArray) -> String:
	if key_32.size() != LogConstants.AES_KEY_SIZE or iv_16.size() != LogConstants.AES_BLOCK_SIZE:
		return ""
	var aes := AESContext.new()
	if aes.start(AESContext.MODE_CBC_ENCRYPT, key_32, iv_16) != OK:
		return ""
	var padded := pkcs7_pad(plaintext, LogConstants.AES_BLOCK_SIZE)
	var encrypted := aes.update(padded)
	aes.finish()
	return Marshalls.raw_to_base64(encrypted) if not encrypted.is_empty() else ""

## AES-256-CBC Base64 解密并还原原始字节序列（失败返回空数组）
static func aes_cbc_decrypt_b64(cipher_b64: String, key_32: PackedByteArray, iv_16: PackedByteArray) -> PackedByteArray:
	if cipher_b64.is_empty() or key_32.size() != LogConstants.AES_KEY_SIZE or iv_16.size() != LogConstants.AES_BLOCK_SIZE:
		return PackedByteArray()
	var raw_cipher := Marshalls.base64_to_raw(cipher_b64)
	if raw_cipher.is_empty() or (raw_cipher.size() % LogConstants.AES_BLOCK_SIZE) != 0:
		return PackedByteArray()
	var aes := AESContext.new()
	if aes.start(AESContext.MODE_CBC_DECRYPT, key_32, iv_16) != OK:
		return PackedByteArray()
	var decrypted := aes.update(raw_cipher)
	aes.finish()
	return pkcs7_unpad(decrypted, LogConstants.AES_BLOCK_SIZE)

# ==============================================================================
# 三、防篡改哈希链与 Encrypt-then-MAC 日志密封信封
# ==============================================================================

## 计算单调递增审计哈希链节点：SHA256(prev_hash | seq | payload_str)
static func compute_chain_digest(prev_hash: String, sequence: int, payload_str: String) -> String:
	var prev := prev_hash if not prev_hash.is_empty() else LogConstants.CHAIN_GENESIS_HASH
	return ("%s|%d|%s" % [prev, sequence, payload_str]).sha256_text()

## 构造 Encrypt-then-MAC 安全日志加密信封（先 AES-256-CBC 加密，再附链哈希与 HMAC-SHA256 认证）
static func seal_log_record_envelope(
	record_json: String,
	sequence: int,
	key_32: PackedByteArray,
	prev_chain_hash: String = LogConstants.CHAIN_GENESIS_HASH
) -> Dictionary:
	if record_json.is_empty() or key_32.size() != LogConstants.AES_KEY_SIZE:
		return {}
	var iv_16 := Crypto.new().generate_random_bytes(LogConstants.AES_BLOCK_SIZE)
	var ct_b64 := aes_cbc_encrypt_b64(record_json.to_utf8_buffer(), key_32, iv_16)
	if ct_b64.is_empty():
		return {}
	var iv_hex := iv_16.hex_encode()
	var chain_hash := compute_chain_digest(prev_chain_hash, sequence, ct_b64)
	var mac_payload := "%d:%s:%s:%s" % [sequence, iv_hex, ct_b64, chain_hash]
	var mac_hex := hmac_sha256_hex(key_32, mac_payload.to_utf8_buffer())
	return {
		LogConstants.ENC_KEY_VERSION: LogConstants.ENC_VERSION_V1,
		LogConstants.ENC_KEY_ALGO: LogConstants.ENC_ALGO_AES_256_CBC,
		LogConstants.ENC_KEY_SEQUENCE: sequence,
		LogConstants.ENC_KEY_IV: iv_hex,
		LogConstants.ENC_KEY_CIPHERTEXT: ct_b64,
		LogConstants.ENC_KEY_CHAIN_HASH: chain_hash,
		LogConstants.ENC_KEY_MAC: mac_hex,
	}

## 验证并解封 Encrypt-then-MAC 安全日志信封（先常量时间验签，通过后再解密与 JSON 解析）
static func open_log_record_envelope(
	envelope: Dictionary,
	key_32: PackedByteArray,
	verify_mac: bool = true
) -> Dictionary:
	if not is_encrypted_envelope(envelope):
		return {"ok": false, "data": {}, "chain_hash": "", "error": "INVALID_ENVELOPE"}
	if key_32.size() != LogConstants.AES_KEY_SIZE:
		return {"ok": false, "data": {}, "chain_hash": "", "error": "INVALID_KEY_SIZE"}

	var seq := int(envelope.get(LogConstants.ENC_KEY_SEQUENCE, 0))
	var iv_hex := str(envelope.get(LogConstants.ENC_KEY_IV, ""))
	var ct_b64 := str(envelope.get(LogConstants.ENC_KEY_CIPHERTEXT, ""))
	var chain_hash := str(envelope.get(LogConstants.ENC_KEY_CHAIN_HASH, ""))
	var mac_hex := str(envelope.get(LogConstants.ENC_KEY_MAC, ""))

	if verify_mac:
		var mac_payload := "%d:%s:%s:%s" % [seq, iv_hex, ct_b64, chain_hash]
		var expected_mac := hmac_sha256_hex(key_32, mac_payload.to_utf8_buffer())
		if not constant_time_equals(expected_mac, mac_hex):
			return {"ok": false, "data": {}, "chain_hash": chain_hash, "error": "MAC_MISMATCH"}

	var iv_bytes := iv_hex.hex_decode()
	var plain_bytes := aes_cbc_decrypt_b64(ct_b64, key_32, iv_bytes)
	if plain_bytes.is_empty():
		return {"ok": false, "data": {}, "chain_hash": chain_hash, "error": "DECRYPT_FAILED"}

	var parsed = JSON.parse_string(plain_bytes.get_string_from_utf8())
	if not (parsed is Dictionary):
		return {"ok": false, "data": {}, "chain_hash": chain_hash, "error": "JSON_PARSE_FAILED"}
	return {"ok": true, "data": parsed, "chain_hash": chain_hash, "error": ""}

## 判断 JSON 字典是否为本引擎加密日志信封格式
static func is_encrypted_envelope(obj: Dictionary) -> bool:
	return obj.get(LogConstants.ENC_KEY_ALGO, "") == LogConstants.ENC_ALGO_AES_256_CBC \
		and obj.has(LogConstants.ENC_KEY_CIPHERTEXT) \
		and obj.has(LogConstants.ENC_KEY_IV)
