# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/account/account_repository.gd
# 架构定位: Domain Repository / Persistence Engine
# 依赖与触发: 上游: AuthService, GameBootstrap | 下游: FileAccess, DirAccess, AccountProfileAggregate | 配置: config/domains/account.json | 信号: 无
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

## 内存主缓存：account_id -> AccountProfileAggregate
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
	var base_dir: String = get_registry_file_path().get_base_dir()
	if not base_dir.ends_with("/"):
		base_dir += "/"
	return base_dir + account_id + ".json"

# ==============================================================================
# 三、查询与索引检索契约
# ==============================================================================

## 按账号 ID 检索聚合
func find_by_id(account_id: String) -> AccountProfileAggregate:
	if account_id.is_empty():
		return null
	return _accounts_cache.get(account_id, null)

## 按用户名检索聚合（大小写不敏感）
func find_by_username(username: String) -> AccountProfileAggregate:
	if username.is_empty():
		return null
	var acc_id: String = str(_username_index.get(username.to_lower(), ""))
	if acc_id.is_empty():
		return null
	return _accounts_cache.get(acc_id, null)

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
	for acc_id in _accounts_cache.keys():
		ids.append(str(acc_id))
	return ids

## 获取已缓存的全部账号（浅拷贝字典，供外部只读遍历）
func get_all_accounts() -> Dictionary:
	return _accounts_cache.duplicate(false)

# ==============================================================================
# 四、数据装载与防损坏自愈引擎
# ==============================================================================

## 从物理磁盘读取 registry_file，反序列化还原所有 AccountProfileAggregate 并建双层索引
func load_all() -> Dictionary:
	_loaded = true
	_accounts_cache.clear()
	_username_index.clear()

	var file_path := get_registry_file_path()
	var accounts_dir := file_path.get_base_dir()
	_ensure_directory(accounts_dir)
	_cleanup_orphan_tmp_files(accounts_dir)

	if not FileAccess.file_exists(file_path):
		var bak_path := file_path + _get_backup_suffix()
		if FileAccess.file_exists(bak_path):
			var restored := _restore_from_backup(file_path, bak_path)
			if restored:
				return _load_from_file(file_path)
		var shard_count := _recover_from_shards(accounts_dir)
		if shard_count > 0:
			_save_registry_internal()
			return {"success": true, "count": shard_count, "error": "", "recovered_from": "shards"}
		return {"success": true, "count": 0, "error": ""}

	var res := _load_from_file(file_path)
	if bool(res.get("success", false)):
		return res

	# 正档解析失败，触发防损坏自愈流程
	if _auto_restore_enabled():
		var bak_path := file_path + _get_backup_suffix()
		if FileAccess.file_exists(bak_path):
			var restored := _restore_from_backup(file_path, bak_path)
			if restored:
				var retry_res := _load_from_file(file_path)
				if bool(retry_res.get("success", false)):
					retry_res["auto_restored"] = true
					return retry_res
		var shard_count := _recover_from_shards(accounts_dir)
		if shard_count > 0:
			_save_registry_internal()
			return {"success": true, "count": shard_count, "error": "", "recovered_from": "shards"}

	return res

func _load_from_file(file_path: String) -> Dictionary:
	var file := FileAccess.open(file_path, FileAccess.READ)
	if file == null:
		return {"success": false, "count": 0, "error": "FILE_OPEN_FAILED"}
	var content := file.get_as_text()
	file.close()

	var json := JSON.new()
	var parse_err := json.parse(content)
	if parse_err != OK:
		return {"success": false, "count": 0, "error": "JSON_PARSE_ERROR"}

	var parsed: Variant = json.get_data()
	if not parsed is Dictionary:
		return {"success": false, "count": 0, "error": "INVALID_ROOT_CONTAINER"}

	var root_dict: Dictionary = parsed
	var raw_accounts: Dictionary = {}
	if root_dict.has("accounts"):
		var accounts_val: Variant = root_dict.get("accounts", null)
		if accounts_val is Dictionary:
			raw_accounts = accounts_val
	else:
		raw_accounts = root_dict

	_accounts_cache.clear()
	_username_index.clear()

	for k in raw_accounts.keys():
		_register_raw_account(raw_accounts[k])

	return {"success": true, "count": _accounts_cache.size(), "error": ""}

func _register_raw_account(raw_item: Variant) -> void:
	if not raw_item is Dictionary:
		return
	var acc: AccountProfileAggregate = AccountProfileAggregate.deserialize(raw_item)
	if acc == null or acc.account_id.is_empty():
		return
	_accounts_cache[acc.account_id] = acc
	if not acc.username.is_empty():
		_username_index[acc.username.to_lower()] = acc.account_id

func _recover_from_shards(accounts_dir: String) -> int:
	var dir := DirAccess.open(accounts_dir)
	if dir == null:
		return 0

	var recovered := 0
	dir.list_dir_begin()
	var fname := dir.get_next()
	while not fname.is_empty():
		if not dir.current_is_dir() and fname.ends_with(".json") and not fname.begins_with("account_registry"):
			var shard_file_path := accounts_dir + ("/" if not accounts_dir.ends_with("/") else "") + fname
			if _load_and_register_single_shard(shard_file_path):
				recovered += 1
		fname = dir.get_next()
	dir.list_dir_end()
	return recovered

func _load_and_register_single_shard(shard_file_path: String) -> bool:
	if not FileAccess.file_exists(shard_file_path):
		return false
	var f := FileAccess.open(shard_file_path, FileAccess.READ)
	if f == null:
		return false
	var text := f.get_as_text()
	f.close()
	var json := JSON.new()
	if json.parse(text) != OK:
		return false
	var data: Variant = json.get_data()
	if not data is Dictionary:
		return false
	var acc: AccountProfileAggregate = AccountProfileAggregate.deserialize(data)
	if acc == null or acc.account_id.is_empty():
		return false
	_accounts_cache[acc.account_id] = acc
	if not acc.username.is_empty():
		_username_index[acc.username.to_lower()] = acc.account_id
	return true

# ==============================================================================
# 五、账号持久化与原子落盘
# ==============================================================================

## 原子刷盘单个账号与全局索引表（tmp->bak->rename 事务原子写）
func save_account(account: AccountProfileAggregate) -> Dictionary:
	if account == null:
		return {"success": false, "error": "ACCOUNT_IS_NULL"}
	if account.account_id.is_empty():
		return {"success": false, "error": "EMPTY_ACCOUNT_ID"}
	if account.username.is_empty():
		return {"success": false, "error": "EMPTY_USERNAME"}

	# 若用户名发生变更，先从反向索引中移除旧名称
	var old_acc: AccountProfileAggregate = _accounts_cache.get(account.account_id, null)
	if old_acc != null and old_acc.username != account.username:
		_username_index.erase(old_acc.username.to_lower())

	# 更新内存缓存与双层索引
	_accounts_cache[account.account_id] = account
	_username_index[account.username.to_lower()] = account.account_id

	# 确保存档目录物理存在
	var reg_path := get_registry_file_path()
	var accounts_dir := reg_path.get_base_dir()
	_ensure_directory(accounts_dir)

	# 1. 独立单账号分片原子落盘（若启用）
	if _save_individual_shards_enabled():
		var shard_path := get_account_shard_path(account.account_id)
		var shard_dict := account.serialize()
		var shard_json := JSON.stringify(shard_dict, "\t")
		var shard_write_res := _atomic_write_file(shard_path, shard_json)
		if not bool(shard_write_res.get("success", false)):
			return {"success": false, "error": "SHARD_WRITE_FAILED", "detail": shard_write_res.get("error", "")}

	# 2. 全局注册表原子落盘
	var reg_write_res := _save_registry_internal()
	if not bool(reg_write_res.get("success", false)):
		return {"success": false, "error": "REGISTRY_WRITE_FAILED", "detail": reg_write_res.get("error", "")}

	return {
		"success": true,
		"account_id": account.account_id,
		"username": account.username,
		"error": ""
	}

## 删除指定账号并原子落盘
func delete_account(account_id: String) -> bool:
	if account_id.is_empty():
		return false
	if not _accounts_cache.has(account_id):
		return false

	var acc: AccountProfileAggregate = _accounts_cache[account_id]
	if acc != null and not acc.username.is_empty():
		_username_index.erase(acc.username.to_lower())
	_accounts_cache.erase(account_id)

	# 清理独立分片数据（若存在）
	var shard_path := get_account_shard_path(account_id)
	if FileAccess.file_exists(shard_path):
		DirAccess.remove_absolute(shard_path)
	var shard_bak := shard_path + _get_backup_suffix()
	if FileAccess.file_exists(shard_bak):
		DirAccess.remove_absolute(shard_bak)

	# 原子更新全局注册表
	var res := _save_registry_internal()
	return bool(res.get("success", false))

func _save_registry_internal() -> Dictionary:
	var reg_path := get_registry_file_path()
	var accounts_dir := reg_path.get_base_dir()
	_ensure_directory(accounts_dir)

	var accounts_dict := {}
	for acc_id in _accounts_cache.keys():
		var acc: AccountProfileAggregate = _accounts_cache[acc_id]
		if acc != null:
			accounts_dict[acc_id] = acc.serialize()

	var envelope := {
		"format_version": GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "storage/format_version", DEFAULT_FORMAT_VERSION),
		"engine": "KalarWorldEngine_Godot4",
		"updated_timestamp_utc": int(Time.get_unix_time_from_system()),
		"account_count": _accounts_cache.size(),
		"accounts": accounts_dict
	}

	var json_str := JSON.stringify(envelope, "\t")
	return _atomic_write_file(reg_path, json_str)

# ==============================================================================
# 六、底层事务原子写与文件操作
# ==============================================================================

func _atomic_write_file(file_path: String, content: String) -> Dictionary:
	if not _atomic_write_enabled():
		return _write_direct(file_path, content)

	var tmp_path := file_path + _get_tmp_suffix()
	var tmp_file := FileAccess.open(tmp_path, FileAccess.WRITE)
	if tmp_file == null:
		return {"success": false, "error": "TMP_OPEN_FAILED: %s" % str(FileAccess.get_open_error())}

	tmp_file.store_string(content)
	tmp_file.flush()
	tmp_file.close()

	# 备份已存在的正档
	if FileAccess.file_exists(file_path):
		var bak_path := file_path + _get_backup_suffix()
		_rotate_backups(file_path)
		var backup_err := DirAccess.copy_absolute(file_path, bak_path)
		if backup_err != OK:
			var policy := GameConfig.get_string(DOMAIN_ACCOUNT_CONFIG, "storage/backup_fail_policy", "abort")
			if policy == "abort":
				DirAccess.remove_absolute(tmp_path)
				return {"success": false, "error": "BACKUP_FAILED: %d" % backup_err}

	# rename 原子替换
	var rename_err := DirAccess.rename_absolute(tmp_path, file_path)
	if rename_err != OK:
		DirAccess.remove_absolute(tmp_path)
		return {"success": false, "error": "RENAME_FAILED: %d" % rename_err}

	return {"success": true, "error": ""}

func _rotate_backups(file_path: String) -> void:
	var retention := GameConfig.get_int(DOMAIN_ACCOUNT_CONFIG, "storage/backup_retention", DEFAULT_BACKUP_RETENTION)
	if retention <= 1:
		return
	var bak_suffix := _get_backup_suffix()
	var i := retention - 1
	while i >= 1:
		_shift_backup_version(file_path, bak_suffix, i)
		i -= 1

func _shift_backup_version(file_path: String, bak_suffix: String, version_idx: int) -> void:
	var src := file_path + bak_suffix if version_idx == 1 else file_path + bak_suffix + "." + str(version_idx - 1)
	var dst := file_path + bak_suffix + "." + str(version_idx)
	if not FileAccess.file_exists(src):
		return
	if FileAccess.file_exists(dst):
		DirAccess.remove_absolute(dst)
	DirAccess.rename_absolute(src, dst)

func _cleanup_orphan_tmp_files(accounts_dir: String) -> void:
	if not GameConfig.get_bool(DOMAIN_ACCOUNT_CONFIG, "storage/orphan_tmp_cleanup", true):
		return
	var dir := DirAccess.open(accounts_dir)
	if dir == null:
		return
	var tmp_suffix := _get_tmp_suffix()
	dir.list_dir_begin()
	var fname := dir.get_next()
	while not fname.is_empty():
		if not dir.current_is_dir() and fname.ends_with(tmp_suffix):
			var file_to_remove := accounts_dir + ("/" if not accounts_dir.ends_with("/") else "") + fname
			DirAccess.remove_absolute(file_to_remove)
		fname = dir.get_next()
	dir.list_dir_end()

func _ensure_directory(dir_path: String) -> void:
	if not DirAccess.dir_exists_absolute(dir_path):
		DirAccess.make_dir_recursive_absolute(dir_path)

func _restore_from_backup(file_path: String, bak_path: String) -> bool:
	if not FileAccess.file_exists(bak_path):
		return false
	var err := DirAccess.copy_absolute(bak_path, file_path)
	return err == OK

func _write_direct(file_path: String, content: String) -> Dictionary:
	var f := FileAccess.open(file_path, FileAccess.WRITE)
	if f == null:
		return {"success": false, "error": "DIRECT_WRITE_OPEN_FAILED"}
	f.store_string(content)
	f.flush()
	f.close()
	return {"success": true, "error": ""}

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
