# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Error Governance)
# 文件路径: res://backend/infrastructure/error_code_registry.gd
# 架构定位: Error Code Registry / Reporter
# 跨域依赖: 上游: 全域后端与前端边界 | 下游: UnifiedLoggerService | 配置: config/infrastructure/errors.json | 信号: 严重错误上报信号
# 职责说明: 维护由 config/infrastructure/errors_catalog.json 驱动的全域英文协议错误码， 提供错误码校验、严重度映射、i18n 键定位与未登记遥测断点（Inv-LG-2）。
# 设计依据: Phase 75 错误码统一与可证伪契约
# ==============================================================================

class_name ErrorCodeRegistry extends RefCounted

# ==============================================================================
# 一、错误码条目实体
# ==============================================================================

## 单条错误码注册条目
class ErrorCodeEntry extends RefCounted:
	var code: String = ""             # 英文大写协议常量（如 "ERR_ACCOUNT_NOT_FOUND"）
	var severity: String = "error"    # 严重度（debug / info / warn / error）
	var message_key: String = ""      # i18n 本地化键
	var domain: String = ""           # 归属域（infrastructure, account, combat 等）

# ==============================================================================
# 二、注册表状态与加载
# ==============================================================================

static var _registry: Dictionary = {}          # code -> ErrorCodeEntry
static var _config_version: int = -1           # 配置版本（热重载失效重建依据）
static var _unregistered_counts: Dictionary = {} # 未登记错误码遥测计数器（code -> count）
static var _unregistered_overflow: int = 0       # 遥测表满后的丢弃计数（有界收敛，对齐 PATH_CACHE 上限惯例）

## 未登记遥测表上限：防攻击者可控 code 无界增长内存
const MAX_UNREGISTERED_TRACKED: int = 512

## 注册表新鲜度守卫：当配置表发生重载版本变更时自动重建
static func _ensure_loaded() -> void:
	if not _registry.is_empty() and _config_version == GameConfig.config_reload_version():
		return
	_registry.clear()
	var catalog: Dictionary = GameConfig.get_dict("infrastructure.errors_catalog", "errors", {})
	for code_str in catalog.keys():
		var raw_entry = catalog[code_str]
		if raw_entry is Dictionary:
			var entry := ErrorCodeEntry.new()
			entry.code = String(code_str)
			entry.severity = str(raw_entry.get("severity", "error"))
			entry.message_key = str(raw_entry.get("message_key", ""))
			entry.domain = str(raw_entry.get("domain", ""))
			_registry[entry.code] = entry
	_config_version = GameConfig.config_reload_version()

# ==============================================================================
# 三、查询与遥测
# ==============================================================================

## 按 code 查询（未登记返回 null；登记即视为合法英文错误码）
static func lookup(code: String) -> ErrorCodeEntry:
	_ensure_loaded()
	return _registry.get(code, null)

## 记录未登记错误码的调用次数（接通遥测断点；互异码超上限后仅计溢出，防无界增长）
static func report_unregistered(code: String) -> void:
	if _unregistered_counts.has(code):
		_unregistered_counts[code] = int(_unregistered_counts[code]) + 1
		return
	if _unregistered_counts.size() >= MAX_UNREGISTERED_TRACKED:
		_unregistered_overflow += 1
		return
	_unregistered_counts[code] = 1

## 获取特定未登记错误码被触发的累计次数
static func get_unregistered_count(code: String) -> int:
	return int(_unregistered_counts.get(code, 0))

## 获取遥测表满后的丢弃累计次数（运维判断是否需扩上限或治理散落码）
static func get_unregistered_overflow() -> int:
	return _unregistered_overflow

## 全域错误码登记断言：校验传入的错误码列表，返回所有未登记的非法错误码清单
static func missing_codes(used_codes: Array) -> Array:
	_ensure_loaded()
	var missing: Array = []
	for c in used_codes:
		var code_str := String(c)
		if not _registry.has(code_str):
			missing.append(code_str)
	return missing

## 测试隔离与状态复位
static func reset_for_test() -> void:
	_registry.clear()
	_config_version = -1
	_unregistered_counts.clear()
	_unregistered_overflow = 0
