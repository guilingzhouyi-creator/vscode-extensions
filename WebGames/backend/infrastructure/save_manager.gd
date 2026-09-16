# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Persistence & Save)
# 文件路径: res://backend/infrastructure/save_manager.gd
# 架构定位: Persistence Facade / Save Engine
# 跨域依赖: 上游: WorldState, CharacterProgression, Inventory | 下游: FileAccess, VersionedRuntimeContext | 配置: config/infrastructure/save.json | 信号: 存档开始 / 成功 / 失败事件
# 职责说明: 负责 .kalar_save 自洽存档文件的原子读写与 SHA-256 数据完整性校验。 存档目录/扩展名/信封版本/引擎标识/日志文案全部由 config/infrastructure/persistence.json 驱动。  完整性契约（重要）: 信封中【只存 data_json 一个数据字段】，不存在与之平行的 "data" 对象。 校验与消费必须指向同一字节序列：校验 data_json 的 SHA-256，并从 该字符串反序列化返回。若同时存在可写的 "data" 字段，攻击者只需改写 data 而不动 data_json 即可绕过校验，校验将形同虚设。  原子写契约: 写入 .tmp -> flush/close -> 备份旧档为 .bak -> rename 原子替换。 任一步失败都不会破坏已存在的正档（rename 是文件系统级原子操作）。  旧档兼容: 仅含 "data" 而无 "data_json" 的历史存档按 legacy 降级读取， 无法校验（缺少被签名的原始字节序列），返回 verified=false 并告警。
# 设计依据: Phase 14 事务型存档原子写入规范
# ==============================================================================

class_name SaveManager extends RefCounted

# ==============================================================================
# 一、状态与常量
# ==============================================================================

## 存档名非法字符（阻断路径穿越与平台非法文件名，单机本地校验）
static var _forbidden_tokens: Array[String] = [
	"/", "\\", ":", "*", "?", "\"", "<", ">", "|", ".."
]

## 确保存档目录存在（递归创建，幂等）；并按 recovery/orphan_tmp_cleanup 清理孤儿临时文件
static func ensure_save_directory() -> void:
	var save_dir := _save_dir()
	if DirAccess.open(save_dir) == null:
		DirAccess.make_dir_recursive_absolute(save_dir)
	_cleanup_orphan_tmp_files(save_dir)

## 孤儿临时文件清理（Phase 88 · A5 存档韧性）：原子写在 rename 前被中断会遗留 *{tmp_suffix}
## 文件，既不参与校验也不被任何流程回收，长期累积占用存档目录。启动/写档入口按配置清理并留痕。
static func _cleanup_orphan_tmp_files(save_dir: String) -> void:
	if not GameConfig.get_bool("infrastructure.persistence", "recovery/orphan_tmp_cleanup", true):
		return
	var dir := DirAccess.open(save_dir)
	if dir == null:
		return
	var orphan_suffix := _tmp_suffix()
	var removed := 0
	dir.list_dir_begin()
	var fname := dir.get_next()
	while not fname.is_empty():
		if not dir.current_is_dir() and fname.ends_with(orphan_suffix):
			if DirAccess.remove_absolute(save_dir + fname) == OK:
				removed += 1
		fname = dir.get_next()
	dir.list_dir_end()
	if removed > 0:
		EventBusCore.get_instance().emit_log("warn", _msg("orphan_tmp_cleaned") % removed)

## 内容 SHA-256 摘要（数据完整性校验用）
static func compute_sha256(content_string: String) -> String:
	return content_string.sha256_text()

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
		return _fail("save", "INVALID_SAVE_NAME", _msg("invalid_save_name") % save_name)

	ensure_save_directory()
	var file_path := _save_dir() + save_name + _save_extension()
	var save_exists := FileAccess.file_exists(file_path)
	var backup_exists := FileAccess.file_exists(file_path + _backup_suffix())

	var data_dict: Dictionary = payload.get("data", {})
	var canonical_data_str := JSON.stringify(data_dict)
	var sha256_hash := compute_sha256(canonical_data_str)

	var full_envelope := {
		"format_version": GameConfig.get_string("infrastructure.persistence", "format_version", "1.0.0"),
		"engine": GameConfig.get_string("infrastructure.persistence", "engine", "KalarWorldEngine_Godot4"),
		"save_name": save_name,
		"created_timestamp": Time.get_unix_time_from_system(),
		"signature_sha256": sha256_hash,
		"data_json": canonical_data_str
	}

	var json_str := JSON.stringify(full_envelope, "\t")

	var write_result := _atomic_write(file_path, json_str)
	if not write_result.is_empty():
		write_result["stage"] = "WRITE_TMP"
		write_result["save_exists"] = save_exists
		write_result["backup_exists"] = backup_exists
		write_result["recovery"] = _restore_hint(save_exists, backup_exists)
		return write_result

	var preview_len := GameConfig.get_int("infrastructure.persistence", "hash_preview_len", 8)
	EventBusCore.get_instance().emit_log("info", _msg("save_success") % [file_path, sha256_hash.substr(0, preview_len)])
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
		return _fail("load", "INVALID_SAVE_NAME", _msg("invalid_save_name") % save_name)

	var file_path := _save_dir() + save_name + _save_extension()
	if not FileAccess.file_exists(file_path):
		return _fail("load", "FILE_NOT_EXIST", _msg("file_not_exist") % file_path)

	var file := FileAccess.open(file_path, FileAccess.READ)
	if not file:
		return _fail("load", "OPEN_READ_FAIL", _msg("open_read_fail"))

	var content := file.get_as_text()
	file.close()

	var json := JSON.new()
	var parse_err := json.parse(content)
	if parse_err != OK:
		return _fail_or_recover("load", "JSON_PARSE_FAIL", _msg("json_parse_fail") % [json.get_error_line(), json.get_error_message()], save_name)

	var envelope: Variant = json.get_data()
	if not envelope is Dictionary:
		return _fail_or_recover("load", "INVALID_ENVELOPE", _msg("invalid_envelope"), save_name)
	var env: Dictionary = envelope

	# L6（Phase 56）：format_version 方向闸门（Inv-DF-4）——旧引擎不得静默直通未来版本存档，
	# 低于最低支持版本亦拒绝（迁移链外）。当前单版本：min == current（配置驱动）
	var current_version := GameConfig.get_string("infrastructure.persistence", "format_version", "1.0.0")
	var min_supported := GameConfig.get_string("infrastructure.persistence", "min_supported_version", "1.0.0")
	var env_version: String = String(env.get("format_version", min_supported))
	if _version_newer_than(env_version, current_version):
		return _fail("load", "VERSION_TOO_NEW", _msg("version_too_new") % env_version)
	if _version_newer_than(min_supported, env_version):
		return _fail("load", "VERSION_TOO_OLD", _msg("version_too_old") % env_version)

	# 校验对象与消费对象必须是同一字节序列：仅信任被签名的 data_json
	var raw_data_str: String = env.get("data_json", "")
	var recorded_hash: String = env.get("signature_sha256", "")

	if raw_data_str.is_empty():
		# legacy 存档：无 data_json，缺少被签名的原始字节，无法校验
		if env.has("data"):
			push_warning("SaveManager: %s (%s)" % [_msg("legacy_unverified"), file_path])
			EventBusCore.get_instance().emit_log("warn", _msg("legacy_unverified"))
			return { "success": true, "data": env.get("data", {}), "meta": env, "verified": false, "stage": "LOAD", "error_code": "LEGACY_UNVERIFIED" }
		return _fail("load", "INVALID_ENVELOPE", _msg("invalid_envelope"))

	var calculated_hash := compute_sha256(raw_data_str)
	if calculated_hash != recorded_hash:
		return _fail_or_recover("load", "CHECKSUM_MISMATCH", _msg("checksum_mismatch"), save_name, { "recorded": recorded_hash, "calculated": calculated_hash })

	# 从已被校验的字节序列反序列化，杜绝 data / data_json 不一致
	var data_json := JSON.new()
	if data_json.parse(raw_data_str) != OK:
		return _fail_or_recover("load", "JSON_PARSE_FAIL", _msg("json_parse_fail") % [data_json.get_error_line(), data_json.get_error_message()], save_name)
	var parsed: Variant = data_json.get_data()
	if not parsed is Dictionary:
		return _fail_or_recover("load", "INVALID_ENVELOPE", _msg("invalid_envelope"), save_name)

	EventBusCore.get_instance().emit_log("info", _msg("load_success") % file_path)
	return { "success": true, "data": parsed, "meta": env, "verified": true, "stage": "LOAD", "error_code": "" }

# ==============================================================================
# 四、备份恢复
# ==============================================================================

## 从备份恢复上一次的正档（用于新档写坏或误覆盖时回滚）。
## 契约（Phase 31 S2）：先验证备份可读、写恢复临时文件，再原子交换到正档——
## 不执行“先删除正档”（rename 覆盖即原子替换，旧正档保留到新正档就位）。
static func restore_backup(save_name: String) -> Dictionary:
	if not is_valid_save_name(save_name):
		return _fail("restore", "INVALID_SAVE_NAME", _msg("invalid_save_name") % save_name)
	var file_path := _save_dir() + save_name + _save_extension()
	var backup_path := file_path + _backup_suffix()
	if not FileAccess.file_exists(backup_path):
		return _fail("restore", "FILE_NOT_EXIST", _msg("file_not_exist") % backup_path)

	# 1. 验证备份可读（不完整备份不进入恢复）
	var backup_file := FileAccess.open(backup_path, FileAccess.READ)
	if not backup_file:
		return _fail("restore", "BACKUP_UNREADABLE", _msg("open_read_fail"))
	var backup_content := backup_file.get_as_text()
	backup_file.close()

	# L6（Phase 56）：恢复前可解析性预检（Inv-DF-4）——截断/损坏的 .bak 即使可 open
	# 也拒绝覆盖正档（坏数据不得替换好数据）；预检失败正档保持原样
	var backup_json := JSON.new()
	if backup_json.parse(backup_content) != OK:
		return _fail("restore", "BACKUP_CORRUPT", _msg("backup_corrupt") % backup_json.get_error_message())
	var backup_data: Variant = backup_json.get_data()
	if not backup_data is Dictionary:
		return _fail("restore", "BACKUP_CORRUPT", _msg("backup_corrupt") % "顶层非对象")
	var env_b: Dictionary = backup_data
	var backup_data_json: String = String(env_b.get("data_json", ""))
	if not backup_data_json.is_empty():
		var inner := JSON.new()
		if inner.parse(backup_data_json) != OK:
			return _fail("restore", "BACKUP_CORRUPT", _msg("backup_corrupt") % inner.get_error_message())
	elif not (env_b.get("data") is Dictionary):
		return _fail("restore", "BACKUP_CORRUPT", _msg("backup_corrupt") % "无合法载荷")

	# 2. 写恢复临时文件（校验中间产物可写）
	var tmp_path := file_path + _tmp_suffix()
	var tmp_file := FileAccess.open(tmp_path, FileAccess.WRITE)
	if not tmp_file:
		return _fail("restore", "OPEN_WRITE_FAIL", _msg("open_write_fail") % str(FileAccess.get_open_error()))
	tmp_file.store_string(backup_content)
	tmp_file.flush()
	tmp_file.close()

	# 3. 原子交换（rename 覆盖正档——不先删除正档）
	var err := DirAccess.rename_absolute(tmp_path, file_path)
	if err != OK:
		DirAccess.remove_absolute(tmp_path)
		return _fail("restore", "ATOMIC_REPLACE_FAIL", _msg("atomic_replace_fail") % str(err))
	return { "success": true, "stage": "RESTORE_COMMIT", "error_code": "", "path": file_path }

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

## Phase 88 · A5 读取失败统一出口：对「正档损坏」类失败按配置尝试从 .bak 自动恢复并重读一次。
## 契约：① 仅损坏类错误码走本出口（版本方向闸门 / 文件缺失不参与，避免掩盖真实错误）；
## ② 恢复深度硬上限 1（_recovering 守卫，防 .bak 亦坏时的无界递归）；
## ③ 恢复或重读任一不成功，一律回退原始失败结果，绝不美化失败语义。
static var _recovering: bool = false

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
	if _recovering or not _auto_restore_enabled():
		return base
	var file_path := _save_dir() + save_name + _save_extension()
	if not FileAccess.file_exists(file_path + _backup_suffix()):
		return base
	_recovering = true
	var restore_res := restore_backup(save_name)
	var reloaded: Dictionary = {}
	if bool(restore_res.get("success", false)):
		reloaded = load_game(save_name)
	_recovering = false
	if not reloaded.is_empty() and bool(reloaded.get("success", false)):
		EventBusCore.get_instance().emit_log("warn", _msg("auto_restored") % save_name)
		reloaded["auto_restored"] = true
		reloaded["recovered_from"] = error_code
		return reloaded
	return base

## 恢复建议：正档或备份存在性提示（供调用方决定 restore_backup）
static func _restore_hint(save_exists: bool, backup_exists: bool) -> String:
	if backup_exists:
		return "restore_backup"
	if save_exists:
		return "keep_existing"
	return ""

## 返回空 Dictionary 表示成功；否则为失败结果字典
static func _atomic_write(file_path: String, content: String) -> Dictionary:
	if not GameConfig.get_bool("infrastructure.persistence", "atomic_write/enabled", true):
		return _write_direct(file_path, content)

	var tmp_path := file_path + _tmp_suffix()

	var tmp_file := FileAccess.open(tmp_path, FileAccess.WRITE)
	if not tmp_file:
		return { "success": false, "error": _msg("open_write_fail") % str(FileAccess.get_open_error()) }
	tmp_file.store_string(content)
	tmp_file.flush()
	tmp_file.close()

	# 先备份已存在的正档，保证任何后续失败都可回滚；备份失败按配置策略处理（abort 中止替换 / continue 告警继续）
	if FileAccess.file_exists(file_path):
		var backup_err := DirAccess.copy_absolute(file_path, file_path + _backup_suffix())
		if backup_err != OK:
			var policy := GameConfig.get_string("infrastructure.persistence", "atomic_write/backup_fail_policy", "abort")
			EventBusCore.get_instance().emit_log("warn", _msg("backup_failed") % str(backup_err))
			if policy == "abort":
				DirAccess.remove_absolute(tmp_path)
				return _fail("BACKUP", "BACKUP_FAILED", _msg("backup_failed") % str(backup_err))

	# rename 是文件系统级原子操作，正档要么全旧要么全新
	var rename_err := DirAccess.rename_absolute(tmp_path, file_path)
	if rename_err != OK:
		DirAccess.remove_absolute(tmp_path)
		return { "success": false, "error": _msg("atomic_replace_fail") % str(rename_err) }
	return {}

## 直写模式（atomic_write 禁用时）：直接写文件（无备份/无原子替换保护）
static func _write_direct(file_path: String, content: String) -> Dictionary:
	var file := FileAccess.open(file_path, FileAccess.WRITE)
	if not file:
		return { "success": false, "error": _msg("open_write_fail") % str(FileAccess.get_open_error()) }
	file.store_string(content)
	file.flush()
	file.close()
	return {}

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

## L6（Phase 56）：点分版本比较（a > b 返回 true；非数字段按 0 处理）
static func _version_newer_than(a: String, b: String) -> bool:
	var pa := a.split(".")
	var pb := b.split(".")
	for i in range(max(pa.size(), pb.size())):
		var va := int(pa[i]) if i < pa.size() else 0
		var vb := int(pb[i]) if i < pb.size() else 0
		if va != vb:
			return va > vb
	return false

## 日志文案查表（infrastructure.persistence messages 段，未登记回传 key）
static func _msg(key: String) -> String:
	return GameConfig.get_string("infrastructure.persistence", "messages/" + key, key)
