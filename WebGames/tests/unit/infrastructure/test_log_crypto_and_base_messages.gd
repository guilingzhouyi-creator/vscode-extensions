# ==============================================================================
# 单元测试：日志加密信封、内联脱敏、纯计算库与标准英文底座文本库
# 文件路径: res://tests/unit/infrastructure/test_log_crypto_and_base_messages.gd
# 职责: 验证 Encrypt-then-MAC 密封解封、篡改检测、加盐摘要、消息内联洗净与底座文本解耦（TC-RM-40 ~ TC-RM-43）
# ==============================================================================
class_name TestLogCryptoAndBaseMessages extends RefCounted

const LogConstants = preload("res://backend/infrastructure/logging/log_constants.gd")
const SystemBaseMessages = preload("res://backend/infrastructure/logging/system_base_messages.gd")
const CryptoIntegrityLib = preload("res://backend/infrastructure/pure/crypto_integrity_lib.gd")
const StatisticsMathLib = preload("res://backend/infrastructure/pure/statistics_math_lib.gd")
const LogAdversarialSecurityCases = preload("res://tests/unit/infrastructure/log_adversarial_security_cases.gd")

static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_crypto_integrity_lib_encrypt_and_tamper_reject())
	results.append(test_encrypted_log_export_query_and_chain_verify())
	results.append(test_redaction_inline_scrub_and_salted_hash())
	results.append(test_base_messages_and_statistics_lib_separation())
	results.append_array(LogAdversarialSecurityCases.run_all_cases())

	var all_passed: bool = true
	for r in results:
		if not bool(r.get("passed", false)):
			all_passed = false
			break
	return {
		"domain": "日志安全加密、脱敏清洗与底座英文文本库",
		"all_passed": all_passed,
		"results": results
	}

## TC-RM-40: CryptoIntegrityLib Encrypt-then-MAC 加解密与篡改拒止断言
static func test_crypto_integrity_lib_encrypt_and_tamper_reject() -> Dictionary:
	var key_32 := CryptoIntegrityLib.derive_key_32("kalar_synthetic_material_v1", LogConstants.ENC_DOMAIN_CONTEXT)
	var key_ok := key_32.size() == LogConstants.AES_KEY_SIZE
	var plain := JSON.stringify({"sequence": 7, "level": "INFO", "message": "Encrypted payload check"})
	var env := CryptoIntegrityLib.seal_log_record_envelope(plain, 7, key_32, LogConstants.CHAIN_GENESIS_HASH)
	var env_ok := CryptoIntegrityLib.is_encrypted_envelope(env)

	var opened := CryptoIntegrityLib.open_log_record_envelope(env, key_32, true)
	var opened_data: Dictionary = opened.get("data", {})
	var open_ok: bool = bool(opened.get("ok", false)) and int(opened_data.get("sequence", 0)) == 7

	# 篡改 MAC 签名，必须返回 MAC_MISMATCH 拒止
	var tampered := env.duplicate(true)
	tampered[LogConstants.ENC_KEY_MAC] = "0".repeat(LogConstants.SHA256_HEX_LEN)
	var tamper_res := CryptoIntegrityLib.open_log_record_envelope(tampered, key_32, true)
	var tamper_rejected := (not bool(tamper_res.get("ok", true))) and str(tamper_res.get("error", "")) == "MAC_MISMATCH"

	var ct_eq_ok := CryptoIntegrityLib.constant_time_equals("abc123", "abc123") and not CryptoIntegrityLib.constant_time_equals("abc123", "abc124")
	return {
		"test": "TC-RM-40: CryptoIntegrityLib Encrypt-then-MAC 加解密与篡改拒止断言",
		"passed": key_ok and env_ok and open_ok and tamper_rejected and ct_eq_ok,
		"detail": "open_ok=%s, tamper_rejected=%s" % [str(open_ok), str(tamper_rejected)]
	}

## TC-RM-41: 加密日志落盘、哈希链校验与零明文落盘回归断言
static func test_encrypted_log_export_query_and_chain_verify() -> Dictionary:
	LogFileExporter.reset_for_test()
	LogQueryService.reset_for_test()
	var test_dir := "user://test_encrypted_logs_tc41"
	_cleanup_dir(test_dir)

	var key_32 := CryptoIntegrityLib.derive_key_32("kalar_chain_test_key", LogConstants.ENC_DOMAIN_CONTEXT)
	var cfg := LogExportConfigDTO.new()
	cfg.enabled = true
	cfg.directory = test_dir
	cfg.file_prefix = "enc_tc41"
	cfg.min_level = LogConstants.LEVEL_LOWER_INFO
	cfg.max_bytes = LogConstants.DEFAULT_MAX_LOG_BYTES
	cfg.max_files = 2
	cfg.encryption_enabled = true
	cfg.hmac_chain_enabled = true
	LogFileExporter._config = cfg
	LogFileExporter._config_version = GameConfig.config_reload_version()
	LogFileExporter.set_encryption_key_for_test(key_32)
	LogQueryService.set_decryption_key_for_test(key_32)

	for i in range(2):
		var rec := LogRecordDTO.new()
		rec.level = LogConstants.LEVEL_INFO
		rec.channel = LogConstants.CHANNEL_SYSTEM
		rec.message = "Confidential event %d" % i
		LogFileExporter.consume(rec)

	var main_file := "%s/enc_tc41%s" % [test_dir, LogConstants.LOG_FILE_EXTENSION]
	var verify_ok := LogQueryService.verify_encrypted_log_file(main_file, key_32)
	var chain_valid := bool(verify_ok.get("ok", false)) and int(verify_ok.get("verified_count", 0)) == 2
	var no_plaintext_leak := not FileAccess.get_file_as_string(main_file).contains("Confidential event")

	_cleanup_dir(test_dir)
	LogFileExporter.reset_for_test()
	LogQueryService.reset_for_test()
	return {
		"test": "TC-RM-41: 加密日志落盘、哈希链校验与零明文落盘回归断言",
		"passed": chain_valid and no_plaintext_leak,
		"detail": "chain_valid=%s, no_plaintext_leak=%s" % [str(chain_valid), str(no_plaintext_leak)]
	}

static func _cleanup_dir(dir_path: String) -> void:
	if not DirAccess.dir_exists_absolute(dir_path):
		return
	var d := DirAccess.open(dir_path)
	if d != null:
		for f in d.get_files():
			DirAccess.remove_absolute("%s/%s" % [dir_path, f])
	DirAccess.remove_absolute(dir_path)

## TC-RM-42: RedactionRule 消息正文内联敏感凭据二次清洗与加盐摘要断言
static func test_redaction_inline_scrub_and_salted_hash() -> Dictionary:
	RedactionRule.reset_state()
	var srec := StructuredLogRecord.new()
	srec.message = "Auth failed with password=SecretValue99 and Bearer syntheticTokenVal88"
	RedactionRule.apply_to_record(srec, {"detail": "token=InlineTok777"})

	var msg_scrubbed := (not srec.message.contains("SecretValue99")) \
		and (not srec.message.contains("syntheticTokenVal88")) \
		and srec.redacted_keys.has(LogConstants.KEY_MESSAGE)
	var ctx_scrubbed := (not str(srec.context.get("detail", "")).contains("InlineTok777")) \
		and srec.redacted_keys.has("detail")

	var raw_id := "ACC_SALT_TEST_1"
	var salted_a := CryptoIntegrityLib.salted_hash_hex(raw_id, "salt_domain_a")
	var salted_b := CryptoIntegrityLib.salted_hash_hex(raw_id, "salt_domain_b")
	var salted_ok := salted_a.length() == LogConstants.SHA256_HEX_LEN and salted_a != raw_id.sha256_text() and salted_a != salted_b

	return {
		"test": "TC-RM-42: RedactionRule 消息正文内联洗净与加盐防彩虹表摘要断言",
		"passed": msg_scrubbed and ctx_scrubbed and salted_ok,
		"detail": "msg_scrubbed=%s, ctx_scrubbed=%s, salted_ok=%s" % [str(msg_scrubbed), str(ctx_scrubbed), str(salted_ok)]
	}

## TC-RM-43: SystemBaseMessages 英文底座库化区分与 StatisticsMathLib 纯计算校验
static func test_base_messages_and_statistics_lib_separation() -> Dictionary:
	var base_msg := SystemBaseMessages.format(SystemBaseMessages.MSG_POOL_HARD_LIMIT_ERR, {"pool_name": "EventPacketPool"})
	var base_ok := base_msg == "ObjectPool[EventPacketPool] reached hard limit with overflow allocation forbidden."

	var cfg_resolved := SystemBaseMessages.resolve_event_or_base(
		"LOG_LIFECYCLE_SHUTDOWN_START",
		SystemBaseMessages.MSG_FALLBACK_EVENT,
		{"exit_reason": "user_quit"}
	)
	var cfg_ok := cfg_resolved.contains("user_quit") and not cfg_resolved.contains("{exit_reason}")

	var stats := StatisticsMathLib.compute_p50_p95([50, 10, 40, 20, 30])
	var stats_ok := int(stats.get("p50_ms", 0)) >= 30 and int(stats.get("p95_ms", 0)) == 50

	return {
		"test": "TC-RM-43: SystemBaseMessages 英文底座与配置文案分离及纯统计库断言",
		"passed": base_ok and cfg_ok and stats_ok,
		"detail": "base_ok=%s, cfg_ok=%s, stats_ok=%s" % [str(base_ok), str(cfg_ok), str(stats_ok)]
	}
