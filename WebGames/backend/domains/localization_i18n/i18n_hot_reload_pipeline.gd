# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/localization_i18n/i18n_hot_reload_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/localization_i18n.json | 信号: EventBus 领域广播
# 职责说明: 响应全局语言切换事件、无缝热更新当前语言环境并触发界面刷新推流
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## I18nHotReloadPipeline：Business Pipeline / Transaction Safe Orchestrator
class_name I18nHotReloadPipeline
extends RefCounted

## 语言热切换：更新当前 locale 并返回新词典就绪状态，向 EventBus 广播领域事件
static func switch_language(
    catalog: LocalizationRegistryCatalog,
    new_locale: String
) -> Dictionary:
    if catalog == null:
        return {
            "success": false,
            "error_code": "ERR_CATALOG_NULL",
            "message": "词库实例为空，无法执行语言切换"
        }

    var clean_locale := new_locale.strip_edges()
    if clean_locale.is_empty():
        return {
            "success": false,
            "error_code": "ERR_EMPTY_LOCALE",
            "message": "目标语言代码不能为空"
        }

    var old_locale: String = catalog.current_locale
    catalog.current_locale = clean_locale

    var has_dictionary: bool = catalog._locale_dictionaries.has(clean_locale)
    var is_supported: bool = catalog.is_locale_supported(clean_locale)

    # 广播全域语言切换领域事件（遵循 ADV-EVT-004：携带 args 与 category_key）
    EventBusCore.get_instance().emit_domain_event("localization_i18n.updated", {
        "args": [clean_locale, old_locale],
        "category_key": "system",
        "summary": {
            "old_locale": old_locale,
            "new_locale": clean_locale,
            "has_dictionary": has_dictionary,
            "is_supported": is_supported
        }
    })

    return {
        "success": true,
        "old_locale": old_locale,
        "new_locale": clean_locale,
        "has_dictionary": has_dictionary,
        "is_supported": is_supported
    }
