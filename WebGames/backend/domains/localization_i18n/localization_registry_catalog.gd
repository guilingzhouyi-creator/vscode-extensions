# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/localization_i18n/localization_registry_catalog.gd
# 架构定位: Domain Registry / Specification Catalog
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/localization_i18n.json | 信号: EventBus 领域广播
# 职责说明: 注册多语言词条字典、多层级回退策略与当前语言环境管理
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name LocalizationRegistryCatalog
extends RefCounted

## 全局共享词库实例（懒加载）：启动即灌入 config/i18n 双词典（英文唯一底座 + 中文展示层）
static var _shared: LocalizationRegistryCatalog = null

static func get_shared() -> LocalizationRegistryCatalog:
	if _shared == null:
		_shared = LocalizationRegistryCatalog.new()
		# 表名约定：config/i18n/en_US.json -> 表 "i18n.en_US"（点分全名，与 items.<文件> 一致）
		_shared.load_locale_dict("en_US", GameConfig.get_dict("i18n.en_US", "", {}))
		_shared.load_locale_dict("zh_CN", GameConfig.get_dict("i18n.zh_CN", "", {}))
	return _shared

## 重置共享词库实例（测试/热重载隔离）
static func reset_shared() -> void:
	_shared = null

var current_locale: String = GameConfig.get_string("domains.localization_i18n", "defaults/current_locale", "zh_CN")
var fallback_locale: String = GameConfig.get_string("domains.localization_i18n", "defaults/fallback_locale", "en_US")

# locale -> (loc_key -> template_string)
# 例如: "zh_CN" -> {"item.iron_sword.name": "铁铸长剑", "combat.hit": "{attacker} 击中了 {target}，造成 {dmg} 点物理伤害"}
var _locale_dictionaries: Dictionary = {}

# 全局名称键注册表（Phase 19 统一名称注册表）：
# _name_key_owners: key -> domain（跨域唯一，冲突检测）；registered_name_keys: 已登记键清单（audit 只读）
var _name_key_owners: Dictionary = {}
var registered_name_keys: Array = []

## 登记单条翻译模板（locale → loc_key → template）
func register_translation(locale: String, loc_key: String, template_str: String) -> void:
	if not _locale_dictionaries.has(locale):
		_locale_dictionaries[locale] = {}
	_locale_dictionaries[locale][loc_key] = template_str

## 批量灌入语言词典（键/值强制字符串化）
func load_locale_dict(locale: String, dict: Dictionary) -> void:
	if not _locale_dictionaries.has(locale):
		_locale_dictionaries[locale] = {}
	for k in dict.keys():
		_locale_dictionaries[locale][str(k)] = str(dict[k])

## 全局名称键登记（跨域唯一性 + 英文唯一 fallback 必达）：
## - 同 key **不同域** → NAME_KEY_COLLISION，不覆盖原所有者；
## - 同 key **同域幂等重登记**（配置热重载/多实例 reload）→ 仅刷新词典值，不重复入清单；
## - en_US 词典必写（英文 = 机器可读唯一底座）；zh_CN 可缺省（缺失时显示层回退英文）。
func register_name_key(key: String, domain: String, en_name: String, zh_name: String = "") -> Dictionary:
	if _name_key_owners.has(key):
		if str(_name_key_owners[key]) == domain:
			# 同域幂等重登记：刷新双语词典值，清单不重复增长
			register_translation("en_US", key, en_name)
			if zh_name != "":
				register_translation("zh_CN", key, zh_name)
			return {"success": true, "key": key, "domain": domain, "idempotent": true}
		return {"success": false, "code": "NAME_KEY_COLLISION", "key": key, "owner": _name_key_owners[key]}
	_name_key_owners[key] = domain
	registered_name_keys.append(key)
	register_translation("en_US", key, en_name)
	if zh_name != "":
		register_translation("zh_CN", key, zh_name)
	return {"success": true, "key": key, "domain": domain}

## 名称键域所有者查询（audit/遥测只读）
func get_name_key_owner(key: String) -> String:
	return str(_name_key_owners.get(key, ""))
