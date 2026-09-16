# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/item_namespace_registry/item_uid_generator.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_namespace_registry.json | 信号: EventBus 领域广播
# 职责说明: 物品实例级全局唯一标识生成与校验（权威/可追溯/幂等）： UID = <域前缀> + <单调计数 8 位> + <校验尾 2 位>； - 前缀按发放来源隔离（GM_/CDK_/GAC_/MAIL_/SRV_），配置白名单登记； - 单调计数持久化（uid/persistent_counter 开关），重启不重复； - 校验尾 = sha256(prefix+count) 前 2 位（确定性可复现，禁全局随机）； 全部由 config/domains/item_namespace_registry.json 的 uid 段驱动。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name ItemUIDGenerator extends RefCounted

# ==============================================================================
# 一、UID 生成与校验
# ==============================================================================

static var _counter: int = -1

## 生成 UID：前缀须登记；计数单调（首启从配置起始值续增）
static func generate_uid(prefix: String) -> String:
	if not _is_registered_prefix(prefix):
		return ""
	if _counter < 0:
		_counter = _initial_counter()
	_counter += 1
	var count_str := str(_counter).pad_zeros(_count_width())
	return prefix + count_str + _checksum(prefix, _counter)

## 校验：旧档迁移 UID（legacy_prefixes 配置登记，LGC_ + 20 位十六进制）直接放行；
## 常规 UID 需前缀登记 + 长度匹配 + 校验尾重算比对（防篡改）
static func validate_uid(uid: String) -> bool:
	for lp in _legacy_prefixes():
		var lpfx := String(lp)
		if lpfx.is_empty() or not uid.begins_with(lpfx):
			continue
		var body := uid.substr(lpfx.length())
		# 注意：is_valid_hex_number(true) 在本构建对无 0x 前缀串恒 false（API 怪癖），须用 (false)
		return body.length() == 20 and body.is_valid_hex_number(false)
	var prefixes: Array = GameConfig.get_array("domains.item_namespace_registry", "uid/prefixes", ["GM_", "CDK_", "GAC_", "MAIL_", "SRV_"])
	for prefix in prefixes:
		if String(prefix).is_empty():
			continue
		var pfx := String(prefix)
		if not uid.begins_with(pfx):
			continue
		var body := uid.substr(pfx.length())
		var width := _count_width()
		if body.length() != width + 2:
			return false
		var count_str := body.substr(0, width)
		if not count_str.is_valid_int():
			return false
		var check := body.substr(width, 2)
		return check == _checksum(pfx, count_str.to_int())
	return false

## 来源追溯：返回 UID 的域前缀（含旧档迁移 legacy 前缀；均未登记返回空）
static func prefix_of(uid: String) -> String:
	for lp in _legacy_prefixes():
		if uid.begins_with(String(lp)):
			return String(lp)
	for pfx in GameConfig.get_array("domains.item_namespace_registry", "uid/prefixes", ["GM_", "CDK_", "GAC_", "MAIL_", "SRV_"]):
		if uid.begins_with(String(pfx)):
			return String(pfx)
	return ""

## 单调计数持久化入口：外部落盘后经此续增（重启防重复）
static func restore_counter(saved_count: int) -> void:
	if saved_count > _counter:
		_counter = saved_count

static func current_counter() -> int:
	if _counter < 0:
		_counter = _initial_counter()
	return _counter

# ==============================================================================
# 二、内部实现（配置读取 / 校验尾）
# ==============================================================================

## 旧档迁移 UID 前缀（配置驱动；仅供校验/溯源，不参与 generate_uid 白名单）
static func _legacy_prefixes() -> Array:
	return GameConfig.get_array("domains.item_namespace_registry", "uid/legacy_prefixes", ["LGC_"])

static func _is_registered_prefix(prefix: String) -> bool:
	var prefixes: Array = GameConfig.get_array("domains.item_namespace_registry", "uid/prefixes", ["GM_", "CDK_", "GAC_", "MAIL_", "SRV_"])
	return prefixes.has(prefix)

static func _initial_counter() -> int:
	return GameConfig.get_int("domains.item_namespace_registry", "uid/start_count", 0)

static func _count_width() -> int:
	return clampi(GameConfig.get_int("domains.item_namespace_registry", "uid/count_width", 8), 4, 12)

static func _checksum(prefix: String, count: int) -> String:
	return (prefix + str(count)).sha256_text().substr(0, 2)