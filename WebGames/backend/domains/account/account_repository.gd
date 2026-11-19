# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/account_repository.gd
# 架构定位: Domain Repository / Persistence Engine
# 依赖与触发: 上游: AuthService, GameBootstrap | 下游: FileAccess, DirAccess, AccountProfile | 配置: config/domains/account.json | 信号: 无
# 职责说明: 负责全域账号的物理仓储、双层缓存索引（ID与用户名）与原子持久化落盘。
# 退出语义与设计依据: 业务域第一性原理 / 账号与槽位生命周期契约 / 事务型存档原子写入规范
# ==============================================================================

## AccountRepository：Domain Repository / Persistence Engine
class_name AccountRepository
extends RefCounted

const DOMAIN_ACCOUNT_CONFIG: String = "domains.account"
const DEFAULT_REGISTRY_FILE: String = "user://accounts/account_registry.json"
const DEFAULT_TMP_SUFFIX: String = ".tmp"
const DEFAULT_BACKUP_SUFFIX: String = ".bak"
const DEFAULT_BACKUP_RETENTION: int = 3
const DEFAULT_FORMAT_VERSION: String = "1.0.0"

# ==============================================================================
# 一、内存缓存与双层索引
# ==============================================================================

## 内存主缓存：account_id -> AccountProfile
var _accounts_cache: Dictionary = {}

## 内存用户名索引：username_lower -> account_id (用于 O(1) 登录/验重查询)
var _username_index: Dictionary = {}

## 是否已完成初次介质装载
var _loaded: bool = false

## 自定义注册表路径（支持测试沙箱物理隔离）
var _custom_registry_path: String = ""

## 全局单例引用
static var _instance: AccountRepository = null

# ==============================================================================
# 二、单例与生命周期管理
# ==============================================================================

## 获取仓储全局单例
static func get_instance() -> AccountRepository:
	if _instance == null:
		_instance = AccountRepository.new()
	return _instance

## 测试环境重置：清空内存缓存、索引并销毁单例
static func reset_for_tests() -> void:
	if _instance != null:
		_instance._accounts_cache.clear()
		_instance._username_index.clear()
		_instance._custom_registry_path = ""
		_instance._loaded = false
	_instance = null

## 检查是否已从介质装载数据
func is_loaded() -> bool:
	return _loaded

## 设置自定义注册表文件路径（用于测试沙箱）
func set_custom_registry_path(custom_path: String) -> void:
	_custom_registry_path = custom_path

## 获取注册表文件物理路径
func get_registry_file_path() -> String:
	if not _custom_registry_path.is_empty():
		return _custom_registry_path
	return GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "storage/registry_file", DEFAULT_REGISTRY_FILE)

## 获取分片文件物理路径
func get_account_shard_path(account_id: String) -> String:
	var base_directory: String = get_registry_file_path().get_base_dir()
	if not base_directory.ends_with("/"):
		base_directory += "/"
	return base_directory + account_id + ".json"

# ==============================================================================
# 三、查询与索引检索契约
# ==============================================================================

## 按账号 ID 检索聚合
func find_by_id(account_id: String) -> AccountProfile:
	if account_id.is_empty():
		return null
	return _accounts_cache.get(account_id, null)

## 按用户名检索聚合（大小写不敏感）
func find_by_username(username: String) -> AccountProfile:
	if username.is_empty():
		return null
	var account_id: String = str(_username_index.get(username.to_lower(), ""))
	if account_id.is_empty():
		return null
	return _accounts_cache.get(account_id, null)

## 检查账号 ID 是否已存在
func has_account(account_id: String) -> bool:
	if account_id.is_empty():
		return false
	return _accounts_cache.has(account_id)

## 检查用户名是否已存在（大小写不敏感）
func has_username(username: String) -> bool:
	if username.is_empty():
		return false
	return _username_index.has(username.to_lower())

## 获取已装载账号总数
func get_account_count() -> int:
	if not _loaded:
		load_all()
	return _accounts_cache.size()

## 获取所有已登记账号 ID 清单
func list_account_ids() -> Array[String]:
	var ids: Array[String] = []
	for cached_account_id in _accounts_cache.keys():
		ids.append(str(cached_account_id))
	return ids

## 获取已缓存的全部账号（浅拷贝字典，供外部只读遍历）
func get_all_accounts() -> Dictionary:
	return _accounts_cache.duplicate(false)

# ==============================================================================
# 四、数据装载与防损坏自愈引擎
# ==============================================================================

## 从物理磁盘读取 registry_file，反序列化还原所有 AccountProfile 并建双层索引
func load_all() -> Dictionary:
	_loaded = true
	_accounts_cache.clear()
	_username_index.clear()

	var file_path := get_registry_file_path()
	var accounts_directory := file_path.get_base_dir()
	AtomicFileWriter.ensure_directory(accounts_directory)
	_cleanup_orphan_tmp_files(accounts_directory)

	if not FileAccess.file_exists(file_path):
		var backup_path := file_path + _get_backup_suffix()
		if FileAccess.file_exists(backup_path):
			var is_restored := AtomicFileWriter.restore_from_backup(file_path, backup_path)
			if is_restored:
				return _load_from_file(file_path)
		var shard_count := _recover_from_shards(accounts_directory)
		if shard_count > 0:
			_save_registry_internal()
			return {"success": true, "count": shard_count, "error_code": "", "recovered_from": "shards"}
		return {"success": true, "count": 0, "error_code": ""}

	var load_result := _load_from_file(file_path)
	if bool(load_result.get("success", false)):
		return load_result

	# 正档解析失败，触发防损坏自愈流程
	if _auto_restore_enabled():
		var backup_path := file_path + _get_backup_suffix()
		if FileAccess.file_exists(backup_path):
			var is_restored := AtomicFileWriter.restore_from_backup(file_path, backup_path)
			if is_restored:
				var retry_result := _load_from_file(file_path)
				if bool(retry_result.get("success", false)):
					retry_result["auto_restored"] = true
					return retry_result
		var shard_count := _recover_from_shards(accounts_directory)
		if shard_count > 0:
			_save_registry_internal()
			return {"success": true, "count": shard_count, "error_code": "", "recovered_from": "shards"}

	return load_result

func _load_from_file(file_path: String) -> Dictionary:
	var file := FileAccess.open(file_path, FileAccess.READ)
	if file == null:
		return {"success": false, "count": 0, "error_code": "FILE_OPEN_FAILED"}
	var content := file.get_as_text()
	file.close()

	var json := JSON.new()
	var parse_error := json.parse(content)
	if parse_error != OK:
		return {"success": false, "count": 0, "error_code": "JSON_PARSE_ERROR"}

	var parsed: Variant = json.get_data()
	if not parsed is Dictionary:
		return {"success": false, "count": 0, "error_code": "INVALID_ROOT_CONTAINER"}

	var root_dictionary: Dictionary = parsed
	var raw_accounts: Dictionary = {}
	if root_dictionary.has("accounts"):
		var accounts_section: Variant = root_dictionary.get("accounts", null)
		if accounts_section is Dictionary:
			raw_accounts = accounts_section
	else:
		raw_accounts = root_dictionary

	_accounts_cache.clear()
	_username_index.clear()

	for account_key in raw_accounts.keys():
		_register_raw_account(raw_accounts[account_key])

	return {"success": true, "count": _accounts_cache.size(), "error_code": ""}

func _register_raw_account(raw_account_payload: Variant) -> void:
	if not raw_account_payload is Dictionary:
		return
	var account: AccountProfile = AccountProfile.deserialize(raw_account_payload)
	if account == null or account.account_id.is_empty():
		return
	_accounts_cache[account.account_id] = account
	if not account.username.is_empty():
		_username_index[account.username.to_lower()] = account.account_id

func _recover_from_shards(accounts_directory: String) -> int:
	var directory_access := DirAccess.open(accounts_directory)
	if directory_access == null:
		return 0

	var recovered := 0
	directory_access.list_dir_begin()
	var entry_name := directory_access.get_next()
	while not entry_name.is_empty():
		if not directory_access.current_is_dir() and entry_name.ends_with(".json") and not entry_name.begins_with("account_registry"):
			var shard_file_path := accounts_directory + ("/" if not accounts_directory.ends_with("/") else "") + entry_name
			if _load_and_register_single_shard(shard_file_path):
				recovered += 1
		entry_name = directory_access.get_next()
	directory_access.list_dir_end()
	return recovered

func _load_and_register_single_shard(shard_file_path: String) -> bool:
	if not FileAccess.file_exists(shard_file_path):
		return false
	var file_handle := FileAccess.open(shard_file_path, FileAccess.READ)
	if file_handle == null:
		return false
	var text := file_handle.get_as_text()
	file_handle.close()
	var json := JSON.new()
	if json.parse(text) != OK:
		return false
	var parsed_payload: Variant = json.get_data()
	if not parsed_payload is Dictionary:
		return false
	var account: AccountProfile = AccountProfile.deserialize(parsed_payload)
	if account == null or account.account_id.is_empty():
		return false
	_accounts_cache[account.account_id] = account
	if not account.username.is_empty():
		_username_index[account.username.to_lower()] = account.account_id
	return true

# ==============================================================================
# 五、账号持久化与原子落盘
# ==============================================================================

## 原子刷盘单个账号与全局索引表（tmp->bak->rename 事务原子写）
func save_account(account: AccountProfile) -> Dictionary:
	if account == null:
		return {"success": false, "error_code": "ACCOUNT_IS_NULL"}
	if account.account_id.is_empty():
		return {"success": false, "error_code": "EMPTY_ACCOUNT_ID"}
	if account.username.is_empty():
		return {"success": false, "error_code": "EMPTY_USERNAME"}

	# 若用户名发生变更，先从反向索引中移除旧名称
	var previous_account: AccountProfile = _accounts_cache.get(account.account_id, null)
	if previous_account != null and previous_account.username != account.username:
		_username_index.erase(previous_account.username.to_lower())

	# 更新内存缓存与双层索引
	_accounts_cache[account.account_id] = account
	_username_index[account.username.to_lower()] = account.account_id

	# 确保存档目录物理存在
	var registry_path := get_registry_file_path()
	var accounts_directory := registry_path.get_base_dir()
	AtomicFileWriter.ensure_directory(accounts_directory)

	# 1. 独立单账号分片原子落盘（若启用）
	if _save_individual_shards_enabled():
		var shard_path := get_account_shard_path(account.account_id)
		var shard_payload := account.serialize()
		var shard_json := JSON.stringify(shard_payload, "\t")
		var shard_write_result := _atomic_write_file(shard_path, shard_json)
		if not bool(shard_write_result.get("success", false)):
			return {"success": false, "error_code": "SHARD_WRITE_FAILED", "detail": shard_write_result.get("error_code", "")}

	# 2. 全局注册表原子落盘
	var registry_write_result := _save_registry_internal()
	if not bool(registry_write_result.get("success", false)):
		return {"success": false, "error_code": "REGISTRY_WRITE_FAILED", "detail": registry_write_result.get("error_code", "")}

	return {
		"success": true,
		"account_id": account.account_id,
		"username": account.username,
		"error_code": ""
	}

## 删除指定账号并原子落盘
func delete_account(account_id: String) -> bool:
	if account_id.is_empty():
		return false
	if not _accounts_cache.has(account_id):
		return false

	var account: AccountProfile = _accounts_cache[account_id]
	if account != null and not account.username.is_empty():
		_username_index.erase(account.username.to_lower())
	_accounts_cache.erase(account_id)

	# 清理独立分片数据（若存在）
	var shard_path := get_account_shard_path(account_id)
	if FileAccess.file_exists(shard_path):
		DirAccess.remove_absolute(shard_path)
	var shard_backup_path := shard_path + _get_backup_suffix()
	if FileAccess.file_exists(shard_backup_path):
		DirAccess.remove_absolute(shard_backup_path)

	# 原子更新全局注册表
	var save_result := _save_registry_internal()
	return bool(save_result.get("success", false))

func _save_registry_internal() -> Dictionary:
	var registry_path := get_registry_file_path()
	var accounts_directory := registry_path.get_base_dir()
	AtomicFileWriter.ensure_directory(accounts_directory)

	var serialized_accounts := {}
	for cached_account_id in _accounts_cache.keys():
		var account: AccountProfile = _accounts_cache[cached_account_id]
		if account != null:
			serialized_accounts[cached_account_id] = account.serialize()

	var envelope := {
		"format_version": GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "storage/format_version", DEFAULT_FORMAT_VERSION),
		"engine": "PureWorldEngine_Godot4",
		"updated_timestamp_utc": int(Time.get_unix_time_from_system()),
		"account_count": _accounts_cache.size(),
		"accounts": serialized_accounts
	}

	var json_text := JSON.stringify(envelope, "\t")
	return _atomic_write_file(registry_path, json_text)

# ==============================================================================
# 六、底层事务原子写与文件操作
# ==============================================================================

func _atomic_write_file(file_path: String, content: String) -> Dictionary:
	var is_atomic_enabled: bool = _atomic_write_enabled()
	var policy: String = GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "storage/backup_fail_policy", "abort")
	var retention: int = GameConfig.get_int(DOMAIN_ACCOUNT_CONFIG, "storage/backup_retention", DEFAULT_BACKUP_RETENTION)
	var write_result: Dictionary = AtomicFileWriter.write_text_atomic(file_path, content, {
		"atomic_enabled": is_atomic_enabled,
		"tmp_suffix": _get_tmp_suffix(),
		"create_backup": true,
		"backup_suffix": _get_backup_suffix(),
		"backup_retention": retention,
		"backup_fail_policy": policy
	})
	if bool(write_result.get("success", false)):
		return {"success": true, "error_code": ""}
	var stage: String = str(write_result.get("error_stage", ""))
	var error_code: int = int(write_result.get("error_code", ERR_FILE_CANT_WRITE))
	if not is_atomic_enabled:
		return {"success": false, "error_code": "DIRECT_WRITE_OPEN_FAILED"}
	if stage == "tmp_open":
		return {"success": false, "error_code": TemplateFormatter.format("TMP_OPEN_FAILED: {error}", {"error": str(error_code)})}
	if stage == "backup":
		return {"success": false, "error_code": TemplateFormatter.format("BACKUP_FAILED: {error}", {"error": error_code})}
	return {"success": false, "error_code": TemplateFormatter.format("RENAME_FAILED: {error}", {"error": error_code})}

func _cleanup_orphan_tmp_files(accounts_directory: String) -> void:
	if not GameConfig.get_bool(DOMAIN_ACCOUNT_CONFIG, "storage/orphan_tmp_cleanup", true):
		return
	AtomicFileWriter.cleanup_orphan_tmp_files(accounts_directory, _get_tmp_suffix())

func _atomic_write_enabled() -> bool:
	return GameConfig.get_bool(DOMAIN_ACCOUNT_CONFIG, "storage/atomic_write", true)

func _auto_restore_enabled() -> bool:
	return GameConfig.get_bool(DOMAIN_ACCOUNT_CONFIG, "storage/auto_restore_enabled", true)

func _save_individual_shards_enabled() -> bool:
	return GameConfig.get_bool(DOMAIN_ACCOUNT_CONFIG, "storage/save_individual_shards", true)

func _get_tmp_suffix() -> String:
	return GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "storage/tmp_suffix", DEFAULT_TMP_SUFFIX)

func _get_backup_suffix() -> String:
	return GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "storage/backup_suffix", DEFAULT_BACKUP_SUFFIX)
