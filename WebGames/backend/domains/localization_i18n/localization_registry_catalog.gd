# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/localization_i18n/localization_registry_catalog.gd
# 架构定位: Domain Registry / Specification Catalog
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/localization_i18n.json | 信号: EventBus 领域广播
# 职责说明: 注册多语言词条字典、多层级回退策略、MOD 词典双向隔离与当前语言环境管理
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## LocalizationRegistryCatalog：Domain Registry / Specification Catalog
class_name LocalizationRegistryCatalog
extends RefCounted

const EMPTY_DICT: Dictionary = {}

## 全局共享词库实例（懒加载）：启动即灌入 config/i18n 双词典（英文基准词典 + 中文展示层）
static var _shared: LocalizationRegistryCatalog = null

## 获取共享的通用单例或数据引用
static func get_shared() -> LocalizationRegistryCatalog:
    if _shared == null:
        _shared = LocalizationRegistryCatalog.new()
    _shared.ensure_dictionaries_loaded()
    return _shared

## 重置共享词库实例（测试/热重载隔离）
static func reset_shared() -> void:
    _shared = null

var current_locale: String = GameConfig.get_string("domains.localization_i18n", "defaults/current_locale", "zh_CN")
var fallback_locale: String = GameConfig.get_string("domains.localization_i18n", "defaults/fallback_locale", "en_US")
var supported_locales: Array = GameConfig.get_array("domains.localization_i18n", "defaults/supported_locales", ["zh_CN", "en_US", "ja_JP", "zh_TW"])
var cjk_locales: Array = GameConfig.get_array("domains.localization_i18n", "defaults/cjk_locales", ["zh_CN", "ja_JP", "zh_TW"])

# locale -> (loc_key -> template_string)
# 例如: "zh_CN" -> {"item.iron_sword.name": "铁铸长剑", "combat.hit": "{attacker} 击中了 {target}，造成 {dmg} 点物理伤害"}
var _locale_dictionaries: Dictionary = {}

# 全局名称键注册表（统一名称注册表）：
# _name_key_owners: key -> domain（跨域唯一，冲突检测）；registered_name_keys: 已登记键清单（audit 只读）
var _name_key_owners: Dictionary = {}
var registered_name_keys: Array = []

# MOD 词条所有权与原模板快照隔离（用于 MOD 卸载与联机模式 Vanilla 净化）
# mod_id -> { locale -> [loc_keys] }
var _mod_translations: Dictionary = {}
# mod_id -> { locale -> { loc_key -> original_template } }
var _mod_original_templates: Dictionary = {}

## 确保双语词库已装载（消除异步启动时词库为空的隐患）
func ensure_dictionaries_loaded() -> void:
    var english_dictionary: Dictionary = _locale_dictionaries.get("en_US", {})
    var chinese_dictionary: Dictionary = _locale_dictionaries.get("zh_CN", {})
    if english_dictionary.is_empty():
        load_locale_dict("en_US", GameConfig.get_dict("i18n.en_US", "", {}))
    if chinese_dictionary.is_empty():
        load_locale_dict("zh_CN", GameConfig.get_dict("i18n.zh_CN", "", {}))

## 检查指定语言环境是否受支持
func is_locale_supported(locale: String) -> bool:
    var clean_locale := locale.strip_edges()
    if clean_locale.is_empty():
        return false
    return supported_locales.has(clean_locale)

## 检查指定语言环境是否属于 CJK（中日韩）语系
func is_cjk_locale(locale: String = "") -> bool:
    var target: String = locale if not locale.is_empty() else current_locale
    if cjk_locales.has(target):
        return true
    var lower := target.to_lower()
    return lower.begins_with("zh") or lower.begins_with("ja") or lower.begins_with("ko")

## 获取当前已载入有效词典的语言代码清单
func get_loaded_locales() -> Array:
    var locales: Array = []
    for locale_code in _locale_dictionaries:
        locales.append(str(locale_code))
    return locales

## 获取指定语言的只读词典副本
func get_dict(locale: String) -> Dictionary:
    var locale_dictionary: Dictionary = _locale_dictionaries.get(locale, {})
    return locale_dictionary.duplicate()

## 登记单条翻译模板（locale → loc_key → template）
func register_translation(locale: String, localization_key: String, template_text: String) -> void:
    if not _locale_dictionaries.has(locale):
        _locale_dictionaries[locale] = {}
    _locale_dictionaries[locale][localization_key] = template_text

## 批量灌入语言词典（键/值强制字符串化，循环零额外堆分配）
func load_locale_dict(locale: String, source_dictionary: Dictionary) -> void:
    if not _locale_dictionaries.has(locale):
        _locale_dictionaries[locale] = {}
    for localization_key in source_dictionary:
        _locale_dictionaries[locale][str(localization_key)] = str(source_dictionary[localization_key])

## 注入第三方 MOD 多语言词条（支持冲突覆盖与原模板快照备份，实现隔离管理）
func merge_mod_translations(
    mod_id: String,
    locale: String,
    translations: Dictionary,
    can_allow_override: bool = false
) -> Dictionary:
    if mod_id.is_empty() or translations.is_empty():
        return {"success": false, "mod_id": mod_id, "added_count": 0, "overridden_count": 0}

    if not _locale_dictionaries.has(locale):
        _locale_dictionaries[locale] = {}

    if not _mod_translations.has(mod_id):
        _mod_translations[mod_id] = {}
    if not _mod_translations[mod_id].has(locale):
        _mod_translations[mod_id][locale] = {}

    if not _mod_original_templates.has(mod_id):
        _mod_original_templates[mod_id] = {}
    if not _mod_original_templates[mod_id].has(locale):
        _mod_original_templates[mod_id][locale] = {}

    var added_count := 0
    var overridden_count := 0
    var mod_key_set: Dictionary = _mod_translations[mod_id][locale]

    for localization_key in translations:
        var key_text := str(localization_key)
        var template_text := str(translations[localization_key])

        if _locale_dictionaries[locale].has(key_text):
            if can_allow_override:
                _mod_original_templates[mod_id][locale][key_text] = _locale_dictionaries[locale][key_text]
                _locale_dictionaries[locale][key_text] = template_text
                overridden_count += 1
        else:
            _locale_dictionaries[locale][key_text] = template_text
            added_count += 1

        mod_key_set[key_text] = true

    return {
        "success": true,
        "mod_id": mod_id,
        "locale": locale,
        "added_count": added_count,
        "overridden_count": overridden_count
    }

func _restore_locale_mod_keys(locale: Variant, keys: Array, original_map: Dictionary) -> int:
    var restored_count := 0
    for localization_key in keys:
        var key_text := str(localization_key)
        if original_map.has(key_text):
            _locale_dictionaries[locale][key_text] = original_map[key_text]
        else:
            _locale_dictionaries[locale].erase(key_text)
        restored_count += 1
    return restored_count


## 干净卸载第三方 MOD 多语言词条（恢复原有 Vanilla 原生模板，彻底消除内存残留）
func unload_mod_translations(mod_id: String) -> int:
    if not _mod_translations.has(mod_id):
        return 0

    var cleaned_count := 0
    var mod_locales: Dictionary = _mod_translations[mod_id]
    var mod_originals: Dictionary = _mod_original_templates.get(mod_id, EMPTY_DICT)

    for locale in mod_locales:
        var keys_map: Dictionary = mod_locales[locale]
        var original_map: Dictionary = mod_originals.get(locale, EMPTY_DICT)
        cleaned_count += _restore_locale_mod_keys(locale, keys_map.keys(), original_map)

    _mod_translations.erase(mod_id)
    _mod_original_templates.erase(mod_id)
    return cleaned_count


## 卸载当前所有已注入 MOD 的多语言覆盖词条并完整还原基础语言词库
func unload_all_mod_translations() -> int:
    var cleaned_total := 0
    for mod_key in _mod_translations.keys():
        cleaned_total += unload_mod_translations(str(mod_key))
    return cleaned_total

## 全局名称键登记（跨域唯一性 + 英文唯一 fallback 必达）：
## - 同 key **不同域** → NAME_KEY_COLLISION，不覆盖原所有者；
## - 同 key **同域幂等重登记**（配置热重载/多实例 reload）→ 仅刷新词典值，不重复入清单；
## - en_US 词典必写（英文 = 机器可读唯一键源）；zh_CN 可缺省（缺失时显示层回退英文）。
func register_name_key(key: String, domain: String, english_name: String, chinese_name: String = "") -> Dictionary:
    if _name_key_owners.has(key):
        if str(_name_key_owners[key]) == domain:
            # 同域幂等重登记：刷新双语词典值，清单不重复增长
            register_translation("en_US", key, english_name)
            if chinese_name != "":
                register_translation("zh_CN", key, chinese_name)
            return {"success": true, "key": key, "domain": domain, "idempotent": true}
        return {"success": false, "code": "NAME_KEY_COLLISION", "key": key, "owner": _name_key_owners[key]}
    _name_key_owners[key] = domain
    registered_name_keys.append(key)
    register_translation("en_US", key, english_name)
    if chinese_name != "":
        register_translation("zh_CN", key, chinese_name)
    return {"success": true, "key": key, "domain": domain}

## 名称键域所有者查询（audit/遥测只读）
func get_name_key_owner(key: String) -> String:
    return str(_name_key_owners.get(key, ""))

## 获取当前已登记的全部名称键清单副本
func get_all_name_keys() -> Array:
    return registered_name_keys.duplicate()

## 获取已登记名称键数量
func get_name_keys_count() -> int:
    return registered_name_keys.size()

## 导出为多语言状态快照 DTO
func export_state_dto() -> LocalizationI18nDTO:
    var state_snapshot := LocalizationI18nDTO.new()
    state_snapshot.current_locale = current_locale
    state_snapshot.fallback_locale = fallback_locale
    state_snapshot.supported_locales = supported_locales.duplicate()
    state_snapshot.loaded_locales = get_loaded_locales()

    var total_keys := 0
    for locale_code in _locale_dictionaries:
        var locale_dictionary: Dictionary = _locale_dictionaries[locale_code]
        total_keys += locale_dictionary.size()

    state_snapshot.total_keys_count = total_keys
    state_snapshot.missing_name_keys_count = LocalizationSolver.missing_name_keys
    state_snapshot.is_cjk = is_cjk_locale()
    return state_snapshot
