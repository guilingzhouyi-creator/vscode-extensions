# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/localization_i18n/localization_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/localization_i18n.json | 信号: EventBus 领域广播
# 职责说明: 执行多语言文本查找、多层级安全回退链与参数化占位符动态插值 (循环零堆分配)
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## LocalizationSolver：Headless Discrete Solver / Numerical Calculator
class_name LocalizationSolver
extends RefCounted

## 未登记名称键告警计数（遥测/审计只读查询，禁写业务判断分支）
static var missing_name_keys: int = 0

## 重置未登记名称键计数器（用于测试套件重置与遥测周期统计）
static func reset_missing_keys_count() -> void:
    missing_name_keys = 0

## 获取未登记名称键统计总数
static func get_missing_keys_count() -> int:
    return missing_name_keys

## 根据语言包与键路径检索多语言本地化翻译文本（循环零堆分配插值）
static func translate(
    catalog: LocalizationRegistryCatalog,
    localization_key: String,
    parameter_map: Dictionary = {},
    locale_override: String = ""
) -> String:
    if localization_key.is_empty():
        return ""
    if catalog == null:
        return "[%s]" % localization_key

    var target_locale: String = locale_override if not locale_override.is_empty() else catalog.current_locale
    var locale_dictionary: Dictionary = catalog._locale_dictionaries.get(target_locale, {})

    var raw_template: String = ""
    if locale_dictionary.has(localization_key):
        raw_template = str(locale_dictionary[localization_key])
    else:
        # 回退至备用语言 (fallback_locale)
        var fallback_dictionary: Dictionary = catalog._locale_dictionaries.get(catalog.fallback_locale, {})
        if fallback_dictionary.has(localization_key):
            raw_template = str(fallback_dictionary[localization_key])
        else:
            # 最终安全回退返回原始 key
            return "[%s]" % localization_key

    # 空参数短路返回，消除无谓字符串拷贝
    if parameter_map.is_empty():
        return raw_template

    # 动态参数插值 {param_name}（直接键遍历，零临时数组分配）
    var formatted_text: String = raw_template
    for parameter_key in parameter_map:
        var token: String = "{" + str(parameter_key) + "}"
        if formatted_text.contains(token):
            formatted_text = formatted_text.replace(token, str(parameter_map[parameter_key]))

    return formatted_text

## 检查指定词条键是否存在于目标语言或回退语言包中
static func has_translation(
    catalog: LocalizationRegistryCatalog,
    localization_key: String,
    locale_override: String = ""
) -> bool:
    if catalog == null or localization_key.is_empty():
        return false

    var target_locale: String = locale_override if not locale_override.is_empty() else catalog.current_locale
    var locale_dictionary: Dictionary = catalog._locale_dictionaries.get(target_locale, {})
    if locale_dictionary.has(localization_key):
        return true

    var fallback_dictionary: Dictionary = catalog._locale_dictionaries.get(catalog.fallback_locale, {})
    return fallback_dictionary.has(localization_key)

## 批量检索多语言词条（返回 key -> formatted_text 映射表）
static func translate_batch(
    catalog: LocalizationRegistryCatalog,
    localization_keys: Array,
    parameter_map: Dictionary = {},
    locale_override: String = ""
) -> Dictionary:
    var translated_map: Dictionary = {}
    if catalog == null:
        for localization_key in localization_keys:
            var key_text := String(localization_key)
            translated_map[key_text] = "[%s]" % key_text
        return translated_map

    for localization_key in localization_keys:
        var key_text := String(localization_key)
        translated_map[key_text] = translate(catalog, key_text, parameter_map, locale_override)
    return translated_map

## 统一名称解析（全局名称注册表出口）：locale 查表 → fallback_locale 回退 →
## 英文回退(en_US) → 未登记返回 [key] 原样并告警计数 +1（不抛 Fatal）。
## 名称键本体一律英文（机器可读唯一键源），显示文本不得作为逻辑判断依据。
static func resolve_name_key(
    catalog: LocalizationRegistryCatalog,
    key: String,
    locale_override: String = "",
    parameter_map: Dictionary = {}
) -> String:
    if catalog == null or key.is_empty():
        missing_name_keys += 1
        return "[%s]" % key
    var resolved: String = translate(catalog, key, parameter_map, locale_override)
    if resolved == "[%s]" % key:
        missing_name_keys += 1
    return resolved
