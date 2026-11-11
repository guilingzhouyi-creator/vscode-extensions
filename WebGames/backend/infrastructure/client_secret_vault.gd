# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Security & Masking)
# 文件路径: res://backend/infrastructure/client_secret_vault.gd
# 架构定位: 客户端无敏感密钥推导与流掩码混淆器 (Client Secret Vault)
# 依赖与触发: 上游: BinaryConfigReader, WorldGateway | 下游: PackedByteArray | 配置: 无 | 信号: 无
# 职责说明: 负责客户端流式掩码动态解混淆与内存凭据混淆保护；
#           不含任何硬编码服务端私钥或纯明文凭据，满足零凭据泄露门禁约束；
#           提供确定性 LCG 流掩码运算、上下文种子动态推导与内存敏感令牌保护。
# 退出语义与设计依据: 客户端防静态 Dump 与差分等价混淆规约 (Inv-SEC-VAULT-1)
# ==============================================================================

## ClientSecretVault：客户端安全混淆与流掩码解算器
class_name ClientSecretVault
extends RefCounted

# ==============================================================================
# 一、混淆掩码与推导种子常量
# ==============================================================================

## 默认对称流混淆种子（与离线编译器 kalar_config_compiler 对齐）
const DEFAULT_MASK_KEY_SEED: int = 0x5A7C3B19

## FNV-1a 32-bit 散列基数常量
const FNV_OFFSET_BASIS: int = 0x811C9DC5
const FNV_PRIME: int = 0x01000193

# ==============================================================================
# 二、流掩码加解密核心 API (Symmetric XOR Stream Mask)
# ==============================================================================

## 对二进制字节流执行对称 LCG 掩码反解/混淆（由于异或对称性，加混淆与解混淆相同）
static func unmask_stream(payload: PackedByteArray, key_seed: int = DEFAULT_MASK_KEY_SEED) -> PackedByteArray:
	var sz: int = payload.size()
	if sz == 0:
		return PackedByteArray()

	var out: PackedByteArray = payload.duplicate()
	var seed: int = key_seed & 0xFFFFFFFF
	for i in range(sz):
		seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
		var mask_byte: int = (seed >> 16) & 0xFF
		out[i] = out[i] ^ mask_byte
	return out

## 对二进制流执行掩码混淆（直接委托对称 unmask_stream）
static func mask_stream(payload: PackedByteArray, key_seed: int = DEFAULT_MASK_KEY_SEED) -> PackedByteArray:
	return unmask_stream(payload, key_seed)

# ==============================================================================
# 三、动态种子推导与内存令牌保护
# ==============================================================================

## 基于上下文特征字符串通过 FNV-1a 算法确定性推导 32 位整型种子
static func derive_key_seed(seed_material: String) -> int:
	if seed_material.is_empty():
		return DEFAULT_MASK_KEY_SEED

	var utf8_bytes: PackedByteArray = seed_material.to_utf8_buffer()
	var hash_val: int = FNV_OFFSET_BASIS
	var sz: int = utf8_bytes.size()
	for i in range(sz):
		hash_val = hash_val ^ utf8_bytes[i]
		hash_val = (hash_val * FNV_PRIME) & 0xFFFFFFFF

	return hash_val if hash_val != 0 else DEFAULT_MASK_KEY_SEED

## 对内存敏感令牌字符串执行即时掩码混淆，避免在进程堆中留存明文
static func mask_in_memory_token(token: String, key_seed: int = DEFAULT_MASK_KEY_SEED) -> PackedByteArray:
	if token.is_empty():
		return PackedByteArray()
	var raw_bytes: PackedByteArray = token.to_utf8_buffer()
	return unmask_stream(raw_bytes, key_seed)

## 从掩码混淆字节中即时还原内存敏感令牌字符串
static func reveal_in_memory_token(masked: PackedByteArray, key_seed: int = DEFAULT_MASK_KEY_SEED) -> String:
	if masked.is_empty():
		return ""
	var unmasked: PackedByteArray = unmask_stream(masked, key_seed)
	return unmasked.get_string_from_utf8()
