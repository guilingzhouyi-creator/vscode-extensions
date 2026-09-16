# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/localization_i18n/i18n_hot_reload_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/localization_i18n.json | 信号: EventBus 领域广播
# 职责说明: 响应全局语言切换事件、无缝热更新当前语言环境并触发界面刷新推流
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name I18nHotReloadPipeline
extends RefCounted

## 语言热切换：更新当前 locale 并返回新词典就绪状态
static func switch_language(
	catalog: LocalizationRegistryCatalog,
	new_locale: String
) -> Dictionary:
	var old_loc = catalog.current_locale
	catalog.current_locale = new_locale

	return {
		"success": true,
		"old_locale": old_loc,
		"new_locale": new_locale,
		"has_dictionary": catalog._locale_dictionaries.has(new_locale)
	}
