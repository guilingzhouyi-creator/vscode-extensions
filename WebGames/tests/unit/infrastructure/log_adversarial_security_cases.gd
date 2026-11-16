# ==============================================================================
# 单元测试子集：日志加密防篡改、跨重启链续接、嵌套脱敏与损坏备份拒止
# 文件路径: res://tests/unit/infrastructure/log_adversarial_security_cases.gd
# 职责: 承担 TC-RM-44 ~ TC-RM-47 对抗性安全边界用例，隔离日志加解密主测试套件体积
# ==============================================================================
class_name LogAdversarialSecurityCases
extends RefCounted

class _MockRingBuffer extends RefCounted:
	var records: Array = []
	func push_record(dto: Dictionary) -> void:
		records.append(dto)

static func run_all_cases() -> Array:
	return [
		test_template_formatter_single_pass_and_encryption_fail_closed(),
		test_cross_restart_chain_and_rotation_isolation(),
		test_nested_redaction_and_unified_ring_buffer(),
		test_save_manager_rejects_corrupt_backup_restore()
	]

static func _cleanup_dir(dir_path: String) -> void:
	if not DirAccess.dir_exists_absolute(dir_path):
		return
	var d := DirAccess.open(dir_path)
	if d != null:
		for f in d.get_files():
			DirAccess.remove_absolute("%s/%s" % [dir_path, f])
	DirAccess.remove_absolute(dir_path)

## TC-RM-44: TemplateFormatter 单趟非重入替换与加密日志 Fail-Closed 拒写明文断言
static func test_template_formatter_single_pass_and_encryption_fail_closed() -> Dictionary:
	var injected := TemplateFormatter.format("user={a} role={b}", {"a": "{b}", "b": "ADMIN"})
	var single_pass_ok := injected == "user={b} role=ADMIN"

	LogFileExporter.reset_for_test()
	var test_dir := "user://test_enc_fail_closed_tc44"
	_cleanup_dir(test_dir)
	var prev_key := OS.get_environment(LogConstants.ENC_DEFAULT_SEAL_ENV)
	OS.set_environment(LogConstants.ENC_DEFAULT_SEAL_ENV, "")

	var cfg := LogExportConfigDTO.new()
	cfg.enabled = true
	cfg.directory = test_dir
	cfg.file_prefix = "fc_tc44"
	cfg.min_level = LogConstants.LEVEL_LOWER_INFO
	cfg.max_bytes = LogConstants.DEFAULT_MAX_LOG_BYTES
	cfg.max_files = 2
	cfg.encryption_enabled = true
	cfg.hmac_chain_enabled = true
	LogFileExporter._config = cfg
	LogFileExporter._config_version = GameConfig.config_reload_version()

	var rec := LogRecordDTO.new()
	rec.level = LogConstants.LEVEL_INFO
	rec.channel = LogConstants.CHANNEL_SYSTEM
	rec.message = "Must never leak in plaintext"
	var consume_ok := LogFileExporter.consume(rec)
	var main_file := "%s/fc_tc44%s" % [test_dir, LogConstants.LOG_FILE_EXTENSION]
	var fail_closed_ok := (not consume_ok) and (not FileAccess.file_exists(main_file))

	OS.set_environment(LogConstants.ENC_DEFAULT_SEAL_ENV, prev_key)
	_cleanup_dir(test_dir)
	LogFileExporter.reset_for_test()
	return {
		"test": "TC-RM-44: TemplateFormatter 单趟非重入与日志加密缺钥 Fail-Closed 拒写明文",
		"passed": single_pass_ok and fail_closed_ok
	}

## TC-RM-45: 跨进程重启哈希链续接、轮转新链独立性与空档/序号篡改拒止断言
static func test_cross_restart_chain_and_rotation_isolation() -> Dictionary:
	LogFileExporter.reset_for_test()
	LogQueryService.reset_for_test()
	var test_dir := "user://test_restart_chain_tc45"
	_cleanup_dir(test_dir)

	var key_32 := CryptoIntegrityLib.derive_key_32("kalar_restart_chain_key", LogConstants.ENC_DOMAIN_CONTEXT)
	var cfg := LogExportConfigDTO.new()
	cfg.enabled = true
	cfg.directory = test_dir
	cfg.file_prefix = "chain_tc45"
	cfg.min_level = LogConstants.LEVEL_LOWER_INFO
	cfg.max_bytes = LogConstants.DEFAULT_MAX_LOG_BYTES
	cfg.max_files = 3
	cfg.encryption_enabled = true
	cfg.hmac_chain_enabled = true
	LogFileExporter._config = cfg
	LogFileExporter._config_version = GameConfig.config_reload_version()
	LogFileExporter.set_encryption_key_for_test(key_32)

	var r1 := LogRecordDTO.new()
	r1.level = LogConstants.LEVEL_INFO
	r1.message = "Before restart event"
	LogFileExporter.consume(r1)

	LogFileExporter.reset_for_test()
	LogFileExporter._config = cfg
	LogFileExporter._config_version = GameConfig.config_reload_version()
	LogFileExporter.set_encryption_key_for_test(key_32)
	var r2 := LogRecordDTO.new()
	r2.level = LogConstants.LEVEL_INFO
	r2.message = "After restart event"
	LogFileExporter.consume(r2)

	var main_file := "%s/chain_tc45%s" % [test_dir, LogConstants.LOG_FILE_EXTENSION]
	var verify_restart := LogQueryService.verify_encrypted_log_file(main_file, key_32)
	var restart_ok := bool(verify_restart.get("ok", false)) and int(verify_restart.get("verified_count", 0)) == 2

	cfg.max_bytes = 220
	var r3 := LogRecordDTO.new()
	r3.level = LogConstants.LEVEL_INFO
	r3.message = "Post rotation independent chain event with sufficient length to roll over"
	LogFileExporter.consume(r3)
	var verify_post_rot := LogQueryService.verify_encrypted_log_file(main_file, key_32)
	var rotation_ok := bool(verify_post_rot.get("ok", false))

	var empty_file := "%s/empty_tc45%s" % [test_dir, LogConstants.LOG_FILE_EXTENSION]
	var ef := FileAccess.open(empty_file, FileAccess.WRITE)
	if ef != null:
		ef.store_string("\n")
		ef.close()
	var verify_empty := LogQueryService.verify_encrypted_log_file(empty_file, key_32)
	var empty_rejected := (not bool(verify_empty.get("ok", true))) and str(verify_empty.get("error", "")) == LogConstants.LOG_ERR_TRUNCATED_EMPTY

	_cleanup_dir(test_dir)
	LogFileExporter.reset_for_test()
	LogQueryService.reset_for_test()
	return {
		"test": "TC-RM-45: 跨重启日志哈希链续接、轮转独立性与空档拒止断言",
		"passed": restart_ok and rotation_ok and empty_rejected
	}

## TC-RM-46: 嵌套容器敏感键整键丢弃与 UnifiedLoggerService 环形缓冲脱敏断言
static func test_nested_redaction_and_unified_ring_buffer() -> Dictionary:
	RedactionRule.reset_state()
	LogRingBuffer.reset_state()

	var nested_in := {"password": {"raw": "TopSecretNested123"}, "safe": "ok"}
	var nested_res := RedactionRule.apply(nested_in)
	var nested_dict: Dictionary = nested_res.get("dict", {})
	var nested_ok := (not nested_dict.has("password")) and str(nested_dict.get("safe", "")) == "ok"

	var ext_ring := _MockRingBuffer.new()
	var logger := UnifiedLoggerService.new()
	logger.set_mute_console(true)
	logger.set_ring_buffer(ext_ring)
	logger.log_event("SYS_BOOT_OK", "auth_test", UnifiedLoggerService.Severity.INFO, {
		"token": "RING_BUF_SECRET_9999",
		"password": "DropFromRing!"
	})
	var ext_ring_ok := false
	if ext_ring.records.size() == 1:
		var dto: Dictionary = ext_ring.records[0]
		var ctx_dict: Dictionary = dto.get("context", {})
		var dumped := str(ctx_dict)
		ext_ring_ok = (not dumped.contains("RING_BUF_SECRET")) and (not ctx_dict.has("password"))

	var default_logger := UnifiedLoggerService.new()
	default_logger.set_mute_console(true)
	default_logger.log_event("SYS_BOOT_OK", "auth_test", UnifiedLoggerService.Severity.INFO, {
		"token": "RING_BUF_SECRET_8888",
		"password": "DropFromDefaultRing!"
	})
	var recs := LogRingBuffer.query(0, [], ["auth_test"])
	var ring_ok := false
	if recs.size() > 0:
		var last_rec: StructuredLogRecord = recs[recs.size() - 1]
		var dumped_default := str(last_rec.context)
		ring_ok = (not dumped_default.contains("RING_BUF_SECRET")) and (not last_rec.context.has("password"))

	LogRingBuffer.reset_state()
	return {
		"test": "TC-RM-46: RedactionRule 嵌套容器整键阻断与 UnifiedLoggerService 环形缓冲脱敏",
		"passed": nested_ok and ext_ring_ok and ring_ok
	}

## TC-RM-47: SaveManager 拒止损坏 .bak 覆盖完好正档断言
static func test_save_manager_rejects_corrupt_backup_restore() -> Dictionary:
	var slot := "test_corrupt_bak_guard_tc47"
	var file_path := SaveManager._save_dir() + slot + SaveManager._save_extension()
	var backup_path := file_path + SaveManager._backup_suffix()
	for p in [file_path, backup_path]:
		if FileAccess.file_exists(p):
			DirAccess.remove_absolute(p)

	var s1 := SaveManager.save_game(slot, {"data": {"round": 101}})
	var s2 := SaveManager.save_game(slot, {"data": {"round": 202}})
	var setup_ok := bool(s1.get("success", false)) and bool(s2.get("success", false)) and FileAccess.file_exists(backup_path)

	var bf := FileAccess.open(backup_path, FileAccess.WRITE)
	if bf != null:
		bf.store_string(JSON.stringify({"format_version": "1.0.0", "data_json": "{\"round\":999}", "signature_sha256": "0".repeat(64)}))
		bf.close()

	var rest_res := SaveManager.restore_backup(slot)
	var rejected := not bool(rest_res.get("success", true))
	var reload_primary := SaveManager.load_game(slot)
	var primary_intact := bool(reload_primary.get("success", false)) and int(reload_primary.get("data", {}).get("round", 0)) == 202

	for p in [file_path, backup_path]:
		if FileAccess.file_exists(p):
			DirAccess.remove_absolute(p)
	return {
		"test": "TC-RM-47: SaveManager.restore_backup 拒止签名失配 .bak 覆盖正档断言",
		"passed": setup_ok and rejected and primary_intact
	}
