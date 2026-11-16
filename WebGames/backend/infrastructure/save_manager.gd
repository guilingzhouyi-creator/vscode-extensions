# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Persistence & Save)
# 文件路径: res://backend/infrastructure/save_manager.gd
# 架构定位: Persistence Facade / Save Engine
# 依赖与触发: 上游: WorldState, CharacterProgression, Inventory | 下游: FileAccess, VersionedRuntimeContext | 配置: config/infrastructure/persistence.json | 信号: 存档开始 / 成功 / 失败事件
# 职责说明: 负责 .kalar_save 自洽存档文件的原子读写与 SHA-256 数据完整性校验。 存档目录/扩展名/信封版本/引擎标识/日志文案全部由 config/infrastructure/persistence.json 驱动。  完整性契约（重要）: 信封中【只存 data_json 一个数据字段】，不存在与之平行的 "data" 对象； 校验与消费必须指向同一字节序列：校验 data_json 的 SHA-256，并从该字符串反序列化返回。 原子写契约: 写入唯一 .tmp -> 校验写盘错误码 flush/close -> 备份旧档为 .bak -> rename 原子替换。 历史无签名 legacy 存档严格拒收（返回 INVALID_ENVELOPE）。
# 退出语义与设计依据: 事务型存档原子写入规范
# ==============================================================================

## SaveManager：Persistence Facade / Save Engine
class_name SaveManager extends RefCounted

const OP_RESTORE: String = "restore"

# ==============================================================================
# 一、状态与常量
# ==============================================================================

## 存档名非法字符（阻断路径穿越与平台非法文件名，单机本地校验）
static var _forbidden_tokens: Array[String] = [
	"/", "\\", ":", "*", "?", "\"", "<", ">", "|", ".."
]

## 确保存档目录存在（递归创建，幂等）；并按 recovery/orphan_tmp_cleanup 清理孤儿临时文件
static func ensure_save_directory() -> void:
	var save_directory := _save_dir()
	AtomicFileWriter.ensure_directory(save_directory)
	_cleanup_orphan_tmp_files(save_directory)

## 孤儿临时文件清理（存档韧性契约）：原子写在 rename 前被中断会遗留 *{tmp_suffix}
## 文件，既不参与校验也不被任何流程回收，长期累积占用存档目录。启动/写档入口按配置清理并留痕。
static func _cleanup_orphan_tmp_files(save_directory: String) -> void:
	if not GameConfig.get_bool("infrastructure.persistence", "recovery/orphan_tmp_cleanup", true):
		return
	var removed := AtomicFileWriter.cleanup_orphan_tmp_files(save_directory, _tmp_suffix())
	if removed > 0:
		EventBusCore.get_instance().emit_log("warn", _msg("orphan_tmp_cleaned", {"count": removed}))

## 内容 SHA-256 摘要（数据完整性校验用，委托纯密码学域库）
static func compute_sha256(content_string: String) -> String:
	return CryptoIntegrityLib.sha256_hex(content_string)

## 存档名合法性校验：拒绝空名、超长名、路径分隔符与路径穿越片段
static func is_valid_save_name(save_name: String) -> bool:
	if save_name.is_empty():
		return false
	if save_name.length() > _max_name_len():
		return false
	for token in _forbidden_tokens:
		if save_name.contains(token):
			return false
	return true

# ==============================================================================
# 二、存档写入
# ==============================================================================

## 存档写入：名称合法性校验 → 信封组装（format_version/engine/SHA-256/data_json 单字段契约）→ 原子写
static func save_game(save_name: String, payload: Dictionary) -> Dictionary:
	if not is_valid_save_name(save_name):
		return _fail("save", "INVALID_SAVE_NAME", _msg("invalid_save_name", {"name": save_name}))

	ensure_save_directory()
	var file_path := _save_dir() + save_name + _save_extension()
	var has_existing_save := FileAccess.file_exists(file_path)
	var has_existing_backup := FileAccess.file_exists(file_path + _backup_suffix())

	var save_payload: Dictionary = payload.get("data", {})
	var canonical_data_text := JSON.stringify(save_payload)
	var sha256_hash := compute_sha256(canonical_data_text)

	var full_envelope := {
		"format_version": GameConfig.get_string("infrastructure.persistence", "format_version", "1.0.0"),
		"engine": GameConfig.get_string("infrastructure.persistence", "engine", "PureWorldEngine_Godot4"),
		"save_name": save_name,
		"created_timestamp": Time.get_unix_time_from_system(),
		"signature_sha256": sha256_hash,
		"data_json": canonical_data_text
	}

	var envelope_json_text := JSON.stringify(full_envelope, "\t")

	var write_result := _atomic_write(file_path, envelope_json_text)
	if not write_result.is_empty():
		write_result["stage"] = "WRITE_TMP"
		write_result["save_exists"] = has_existing_save
		write_result["backup_exists"] = has_existing_backup
		write_result["recovery"] = _restore_hint(has_existing_save, has_existing_backup)
		return write_result

	var hash_preview_length := GameConfig.get_int("infrastructure.persistence", "hash_preview_len", 8)
	EventBusCore.get_instance().emit_log("info", _msg("save_success", {"path": file_path, "hash": sha256_hash.substr(0, hash_preview_length)}))
	return {
		"success": true,
		"stage": "COMMIT",
		"error_code": "",
		"save_exists": FileAccess.file_exists(file_path),
		"backup_exists": FileAccess.file_exists(file_path + _backup_suffix()),
		"recovery": "",
		"path": file_path,
		"sha256": sha256_hash
	}

# ==============================================================================
# 三、存档读取
# ==============================================================================

## 存档读取：信封解析/版本方向闸门/签名校验（仅信任被签名的 data_json 同一字节序列）/
## 反序列化；legacy 无签名存档降级读取并告警（verified=false）
static func load_game(save_name: String) -> Dictionary:
	if not is_valid_save_name(save_name):
		return _fail("load", "INVALID_SAVE_NAME", _msg("invalid_save_name", {"name": save_name}))

	var file_path := _save_dir() + save_name + _save_extension()
	if not FileAccess.file_exists(file_path):
		return _fail("load", "FILE_NOT_EXIST", _msg("file_not_exist", {"path": file_path}))

	var file := FileAccess.open(file_path, FileAccess.READ)
	if not file:
		return _fail("load", "OPEN_READ_FAIL", _msg("open_read_fail"))

	var content := file.get_as_text()
	file.close()

	var json := JSON.new()
	var parse_error := json.parse(content)
	if parse_error != OK:
		return _fail_or_recover("load", "JSON_PARSE_FAIL", _msg("json_parse_fail", {"line": json.get_error_line(), "error": json.get_error_message()}), save_name)

	var envelope: Variant = json.get_data()
	if not envelope is Dictionary:
		return _fail_or_recover("load", "INVALID_ENVELOPE", _msg("invalid_envelope"), save_name)
	var envelope_map: Dictionary = envelope

	# format_version 方向闸门（Inv-DF-4）：旧引擎不得静默直通未来版本存档，
	# 低于最低支持版本亦拒绝（迁移链外）。当前单版本：min == current（配置驱动）
	var current_version := GameConfig.get_string("infrastructure.persistence", "format_version", "1.0.0")
	var min_supported := GameConfig.get_string("infrastructure.persistence", "min_supported_version", "1.0.0")
	var envelope_version: String = String(envelope_map.get("format_version", ""))
	if envelope_version.is_empty():
		return _fail_or_recover("load", "INVALID_ENVELOPE", SystemBaseMessages.MSG_SAVE_MISSING_FORMAT_VERSION, save_name)
	if _version_newer_than(envelope_version, current_version):
		return _fail("load", "VERSION_TOO_NEW", _msg("version_too_new", {"version": envelope_version}))
	if _version_newer_than(min_supported, envelope_version):
		return _fail("load", "VERSION_TOO_OLD", _msg("version_too_old", {"version": envelope_version}))

	# 校验对象与消费对象必须是同一字节序列：仅信任被签名的 data_json
	var raw_data_json: String = envelope_map.get("data_json", "")
	var recorded_hash: String = envelope_map.get("signature_sha256", "")

	if raw_data_json.is_empty():
		return _fail_or_recover("load", "INVALID_ENVELOPE", _msg("invalid_envelope"), save_name)

	var calculated_hash := compute_sha256(raw_data_json)
	if not CryptoIntegrityLib.constant_time_equals(calculated_hash, recorded_hash):
		return _fail_or_recover("load", "CHECKSUM_MISMATCH", _msg("checksum_mismatch"), save_name, {"recorded": recorded_hash, "calculated": calculated_hash})

	# 从已被校验的字节序列反序列化，杜绝 data / data_json 不一致
	var payload_json_parser := JSON.new()
	if payload_json_parser.parse(raw_data_json) != OK:
		return _fail_or_recover("load", "JSON_PARSE_FAIL", _msg("json_parse_fail", {"line": payload_json_parser.get_error_line(), "error": payload_json_parser.get_error_message()}), save_name)
	var parsed: Variant = payload_json_parser.get_data()
	if not parsed is Dictionary:
		return _fail_or_recover("load", "INVALID_ENVELOPE", _msg("invalid_envelope"), save_name)

	EventBusCore.get_instance().emit_log("info", _msg("load_success", {"path": file_path}))
	return {"success": true, "data": parsed, "meta": envelope_map, "verified": true, "stage": "LOAD", "error_code": ""}

# ==============================================================================
# 四、备份恢复
# ==============================================================================

## 从备份恢复上一次的正档（用于新档写坏或误覆盖时回滚）。
## 契约：先验证备份可读、写恢复临时文件，再原子交换到正档——
## 不执行“先删除正档”（rename 覆盖即原子替换，旧正档保留到新正档就位）。
static func restore_backup(save_name: String) -> Dictionary:
	if not is_valid_save_name(save_name):
		return _fail(OP_RESTORE, "INVALID_SAVE_NAME", _msg("invalid_save_name", {"name": save_name}))
	var file_path := _save_dir() + save_name + _save_extension()
	var backup_path := file_path + _backup_suffix()
	if not FileAccess.file_exists(backup_path):
		return _fail(OP_RESTORE, "FILE_NOT_EXIST", _msg("file_not_exist", {"path": backup_path}))

	# 1. 验证备份可读（不完整备份不进入恢复）
	var backup_file := FileAccess.open(backup_path, FileAccess.READ)
	if not backup_file:
		return _fail(OP_RESTORE, "BACKUP_UNREADABLE", _msg("open_read_fail"))
	var backup_content := backup_file.get_as_text()
	backup_file.close()

	# 恢复前可解析性预检（Inv-DF-4）：截断/损坏的 .bak 即使可 open
	# 也拒绝覆盖正档（坏数据不得替换好数据）；预检失败正档保持原样
	var backup_json := JSON.new()
	if backup_json.parse(backup_content) != OK:
		return _fail(OP_RESTORE, "BACKUP_CORRUPT", _msg("backup_corrupt", {"path": backup_json.get_error_message()}))
	var parsed_backup: Variant = backup_json.get_data()
	if not parsed_backup is Dictionary:
		return _fail(OP_RESTORE, "BACKUP_CORRUPT", _msg("backup_corrupt", {"path": SystemBaseMessages.MSG_SAVE_TOPLEVEL_NOT_OBJECT}))
	var backup_envelope: Dictionary = parsed_backup
	var backup_version: String = String(backup_envelope.get("format_version", ""))
	var current_version := GameConfig.get_string("infrastructure.persistence", "format_version", "1.0.0")
	var min_version := GameConfig.get_string("infrastructure.persistence", "min_supported_version", "1.0.0")
	if backup_version.is_empty() or _version_newer_than(backup_version, current_version) or _version_newer_than(min_version, backup_version):
		return _fail(OP_RESTORE, "BACKUP_CORRUPT", _msg("backup_corrupt", {"path": SystemBaseMessages.MSG_SAVE_UNVERIFIED_BACKUP}))
	var backup_payload_json: String = String(backup_envelope.get("data_json", ""))
	var backup_signature: String = String(backup_envelope.get("signature_sha256", ""))
	if backup_payload_json.is_empty() or backup_signature.is_empty():
		return _fail(OP_RESTORE, "BACKUP_CORRUPT", _msg("backup_corrupt", {"path": SystemBaseMessages.MSG_SAVE_NO_VALID_PAYLOAD}))
	if not CryptoIntegrityLib.constant_time_equals(compute_sha256(backup_payload_json), backup_signature):
		return _fail(OP_RESTORE, "BACKUP_CORRUPT", _msg("backup_corrupt", {"path": SystemBaseMessages.MSG_SAVE_UNVERIFIED_BACKUP}))
	var payload_json_parser := JSON.new()
	if payload_json_parser.parse(backup_payload_json) != OK or not (payload_json_parser.get_data() is Dictionary):
		return _fail(OP_RESTORE, "BACKUP_CORRUPT", _msg("backup_corrupt", {"path": payload_json_parser.get_error_message()}))

	# 2. 写恢复临时文件并原子交换至正档（不先删除正档）
	var replace_result: Dictionary = AtomicFileWriter.replace_via_tmp(file_path, backup_content, _tmp_suffix())
	if not bool(replace_result.get("success", false)):
		var error_code_text: String = str(replace_result.get("error_code", ERR_FILE_CANT_WRITE))
		if str(replace_result.get("error_stage", "")) == "tmp_open":
			return _fail(OP_RESTORE, "OPEN_WRITE_FAIL", _msg("open_write_fail", {"error": error_code_text}))
		return _fail(OP_RESTORE, "ATOMIC_REPLACE_FAIL", _msg("atomic_replace_fail", {"error": error_code_text}))
	return {"success": true, "stage": "RESTORE_COMMIT", "error_code": "", "path": file_path}

# ==============================================================================
# 五、内部实现（原子写 / 失败构造 / 配置读取）
# ==============================================================================

## SaveResult 失败统一构造（阶段/错误码/存在性/恢复建议）
static func _fail(stage: String, error_code: String, error_text: String) -> Dictionary:
	return {
		"success": false,
		"stage": stage,
		"error_code": error_code,
		"error": error_text,
		"recovery": ""
	}

## 读取失败统一出口：对「正档损坏」类失败按配置尝试从 .bak 自动恢复并重读一次。
## 契约：① 仅损坏类错误码走本出口（版本方向闸门 / 文件缺失不参与，避免掩盖真实错误）；
## ② 恢复深度硬上限 1（_recovering 守卫，防 .bak 亦坏时的无界递归）；
## ③ 恢复或重读任一不成功，一律回退原始失败结果，绝不美化失败语义。
static var _is_recovering: bool = false

static func _auto_restore_enabled() -> bool:
	return GameConfig.get_bool("infrastructure.persistence", "recovery/auto_restore_enabled", true)

static func _fail_or_recover(
	stage: String,
	error_code: String,
	error_text: String,
	save_name: String,
	extra: Dictionary = {}
) -> Dictionary:
	var base := _fail(stage, error_code, error_text)
	if not extra.is_empty():
		base.merge(extra, true)
	if _is_recovering or not _auto_restore_enabled():
		return base
	var file_path := _save_dir() + save_name + _save_extension()
	if not FileAccess.file_exists(file_path + _backup_suffix()):
		return base
	_is_recovering = true
	var restore_result := restore_backup(save_name)
	var reloaded: Dictionary = {}
	if bool(restore_result.get("success", false)):
		reloaded = load_game(save_name)
	_is_recovering = false
	if not reloaded.is_empty() and bool(reloaded.get("success", false)):
		EventBusCore.get_instance().emit_log("warn", _msg("auto_restored", {"path": save_name}))
		reloaded["auto_restored"] = true
		reloaded["recovered_from"] = error_code
		return reloaded
	return base

## 恢复建议：正档或备份存在性提示（供调用方决定 restore_backup）
static func _restore_hint(has_existing_save: bool, has_existing_backup: bool) -> String:
	if has_existing_backup:
		return "restore_backup"
	if has_existing_save:
		return "keep_existing"
	return ""

## 返回空 Dictionary 表示成功；否则为失败结果字典
static func _atomic_write(file_path: String, content: String) -> Dictionary:
	var is_atomic_enabled: bool = GameConfig.get_bool("infrastructure.persistence", "atomic_write/enabled", true)
	var policy: String = GameConfig.get_string("infrastructure.persistence", "atomic_write/backup_fail_policy", "abort")
	var write_result: Dictionary = AtomicFileWriter.write_text_atomic(file_path, content, {
		"atomic_enabled": is_atomic_enabled,
		"tmp_suffix": _tmp_suffix(),
		"create_backup": true,
		"backup_suffix": _backup_suffix(),
		"backup_retention": 1,
		"backup_fail_policy": policy
	})
	var backup_error: int = int(write_result.get("backup_error", OK))
	if backup_error != OK:
		EventBusCore.get_instance().emit_log("warn", _msg("backup_failed", {"error": str(backup_error)}))
	if bool(write_result.get("success", false)):
		return {}
	var error_stage: String = str(write_result.get("error_stage", ""))
	var error_code_text: String = str(write_result.get("error_code", ERR_FILE_CANT_WRITE))
	if error_stage == "backup":
		return _fail("BACKUP", "BACKUP_FAILED", _msg("backup_failed", {"error": error_code_text}))
	if error_stage == "rename":
		return {"success": false, "error": _msg("atomic_replace_fail", {"error": error_code_text})}
	return {"success": false, "error": _msg("open_write_fail", {"error": error_code_text})}

## 存档根目录（infrastructure.persistence save_dir 配置，默认 user://saves/）
static func _save_dir() -> String:
	return GameConfig.get_string("infrastructure.persistence", "save_dir", "user://saves/")

## 存档扩展名（infrastructure.persistence save_extension 配置，默认 .kalar_save）
static func _save_extension() -> String:
	return GameConfig.get_string("infrastructure.persistence", "save_extension", ".kalar_save")

## 临时文件后缀（atomic_write/tmp_suffix 配置，默认 .tmp）
static func _tmp_suffix() -> String:
	return GameConfig.get_string("infrastructure.persistence", "atomic_write/tmp_suffix", ".tmp")

## 备份文件后缀（atomic_write/backup_suffix 配置，默认 .bak）
static func _backup_suffix() -> String:
	return GameConfig.get_string("infrastructure.persistence", "atomic_write/backup_suffix", ".bak")

## 存档名最大长度（atomic_write/max_save_name_length 配置，默认 64）
static func _max_name_len() -> int:
	return GameConfig.get_int("infrastructure.persistence", "atomic_write/max_save_name_length", 64)

## 点分版本比较（left_version > right_version 返回 true；非数字段按 0 处理）
static func _version_newer_than(left_version: String, right_version: String) -> bool:
	var left_parts := left_version.split(".")
	var right_parts := right_version.split(".")
	for part_index in range(max(left_parts.size(), right_parts.size())):
		var left_part := int(left_parts[part_index]) if part_index < left_parts.size() else 0
		var right_part := int(right_parts[part_index]) if part_index < right_parts.size() else 0
		if left_part != right_part:
			return left_part > right_part
	return false

## 日志文案查表与动态占位符注入（infrastructure.persistence messages 段，未登记回传 key）
static func _msg(key: String, parameters: Dictionary = {}) -> String:
	var template_text := GameConfig.get_string("infrastructure.persistence", "messages/" + key, key)
	if parameters.is_empty():
		return template_text
	return TemplateFormatter.format(template_text, parameters)
