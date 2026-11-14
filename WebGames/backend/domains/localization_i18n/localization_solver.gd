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
    loc_key: String,
    params: Dictionary = {},
    locale_override: String = ""
) -> String:
    if loc_key.is_empty():
        return ""
    if catalog == null:
        return "[%s]" % loc_key

    var target_locale: String = locale_override if not locale_override.is_empty() else catalog.current_locale
    var locale_dict: Dictionary = catalog._locale_dictionaries.get(target_locale, {})

    var raw_template: String = ""
    if locale_dict.has(loc_key):
        raw_template = str(locale_dict[loc_key])
    else:
        # 回退至备用语言 (fallback_locale)
        var fallback_dict: Dictionary = catalog._locale_dictionaries.get(catalog.fallback_locale, {})
        if fallback_dict.has(loc_key):
            raw_template = str(fallback_dict[loc_key])
        else:
            # 最终安全回退返回原始 key
            return "[%s]" % loc_key

    # 空参数短路返回，消除无谓字符串拷贝
    if params.is_empty():
        return raw_template

    # 动态参数插值 {param_name}（直接键遍历，零临时数组分配）
    var formatted_text: String = raw_template
    for param_key in params:
        var token: String = "{" + str(param_key) + "}"
        if formatted_text.contains(token):
            formatted_text = formatted_text.replace(token, str(params[param_key]))

    return formatted_text

## 检查指定词条键是否存在于目标语言或回退语言包中
static func has_translation(
    catalog: LocalizationRegistryCatalog,
    loc_key: String,
    locale_override: String = ""
) -> bool:
    if catalog == null or loc_key.is_empty():
        return false

    var target_locale: String = locale_override if not locale_override.is_empty() else catalog.current_locale
    var locale_dict: Dictionary = catalog._locale_dictionaries.get(target_locale, {})
    if locale_dict.has(loc_key):
        return true

    var fallback_dict: Dictionary = catalog._locale_dictionaries.get(catalog.fallback_locale, {})
    return fallback_dict.has(loc_key)

## 批量检索多语言词条（返回 key -> formatted_text 映射表）
static func translate_batch(
    catalog: LocalizationRegistryCatalog,
    loc_keys: Array,
    params: Dictionary = {},
    locale_override: String = ""
) -> Dictionary:
    var result: Dictionary = {}
    if catalog == null:
        for loc_key in loc_keys:
            var key_str := String(loc_key)
            result[key_str] = "[%s]" % key_str
        return result

    for loc_key in loc_keys:
        var key_str := String(loc_key)
        result[key_str] = translate(catalog, key_str, params, locale_override)
    return result

## 统一名称解析（全局名称注册表出口）：locale 查表 → fallback_locale 回退 →
## 英文回退(en_US) → 未登记返回 [key] 原样并告警计数 +1（不抛 Fatal）。
## 名称键本体一律英文（机器可读唯一底座），显示文本不得作为逻辑判断依据。
static func resolve_name_key(
    catalog: LocalizationRegistryCatalog,
    key: String,
    locale_override: String = "",
    params: Dictionary = {}
) -> String:
    if catalog == null or key.is_empty():
        missing_name_keys += 1
        return "[%s]" % key
    var resolved: String = translate(catalog, key, params, locale_override)
    if resolved == "[%s]" % key:
        missing_name_keys += 1
    return resolved
