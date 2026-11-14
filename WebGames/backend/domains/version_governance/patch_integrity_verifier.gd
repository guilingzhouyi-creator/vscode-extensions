# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/version_governance/patch_integrity_verifier.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/version_governance.json | 信号: EventBus 领域广播
# 职责说明: 基于 Godot 原生 HashingContext，分块计算流式 SHA-256 数字指纹，杜绝篡改与残缺补丁包
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## PatchIntegrityVerifier：Domain Logic Component
class_name PatchIntegrityVerifier
extends RefCounted

const CHUNK_SIZE_BYTES: int = 65536 # 64 KB 硬件对齐缓冲区

static func _hash_file_sha256(file_path: String) -> Dictionary:
	if not FileAccess.file_exists(file_path):
		return {"ok": false, "sha256": "", "error": "FILE_NOT_FOUND"}
	var file_access := FileAccess.open(file_path, FileAccess.READ)
	if file_access == null:
		return {"ok": false, "sha256": "", "error": "FILE_OPEN_FAILED"}
	var hashing_context := HashingContext.new()
	if hashing_context.start(HashingContext.HASH_SHA256) != OK:
		file_access.close()
		return {"ok": false, "sha256": "", "error": "HASHING_CONTEXT_INIT_FAILED"}
	while not file_access.eof_reached():
		var chunk := file_access.get_buffer(CHUNK_SIZE_BYTES)
		if chunk.is_empty():
			break
		hashing_context.update(chunk)
	var digest := hashing_context.finish()
	file_access.close()
	return {"ok": true, "sha256": digest.hex_encode().to_lower(), "error": ""}

## 流式分块计算并校验文件的 SHA-256
static func verify_file_sha256(file_path: String, expected_sha256: String) -> Dictionary:
	if expected_sha256.is_empty():
		return {"success": false, "error": "MISSING_EXPECTED_HASH"}
	var hashed := _hash_file_sha256(file_path)
	if not bool(hashed.get("ok", false)):
		return {"success": false, "error": str(hashed.get("error", "FILE_OPEN_FAILED"))}
	var computed_hex := str(hashed.get("sha256", ""))
	var is_matched := CryptoIntegrityLib.constant_time_equals(computed_hex, expected_sha256.strip_edges().to_lower())
	return {
		"success": is_matched,
		"computed_sha256": computed_hex,
		"error": "" if is_matched else "HASH_MISMATCH"
	}

## 计算单个文件的 SHA-256 十六进制字符串
static func compute_file_sha256(file_path: String) -> String:
	var hashed := _hash_file_sha256(file_path)
	return str(hashed.get("sha256", "")) if bool(hashed.get("ok", false)) else ""
