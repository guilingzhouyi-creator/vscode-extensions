# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/localization_i18n/localization_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/localization_i18n.json | 信号: EventBus 领域广播
# 职责说明: 执行多语言文本查找、多层级安全回退链与参数化占位符动态插值
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name LocalizationSolver
extends RefCounted

## 未登记名称键告警计数（遥测/审计只读查询，禁写业务判断分支）
static var missing_name_keys: int = 0

static func translate(
	catalog: LocalizationRegistryCatalog,
	loc_key: String,
	params: Dictionary = {},
	locale_override: String = ""
) -> String:
	if catalog == null:
		return "[%s]" % loc_key

	var target_loc = locale_override if locale_override != "" else catalog.current_locale
	var dict: Dictionary = catalog._locale_dictionaries.get(target_loc, {})

	var raw_template := ""
	if dict.has(loc_key):
		raw_template = str(dict[loc_key])
	else:
		# 回退至备用语言 (fallback_locale)
		var fb_dict: Dictionary = catalog._locale_dictionaries.get(catalog.fallback_locale, {})
		if fb_dict.has(loc_key):
			raw_template = str(fb_dict[loc_key])
		else:
			# 最终兜底返回原始 key
			return "[%s]" % loc_key

	# 动态参数插值 {param_name}
	var formatted_text = raw_template
	for k in params.keys():
		var token = "{" + str(k) + "}"
		formatted_text = formatted_text.replace(token, str(params[k]))

	return formatted_text

## 统一名称解析（全局名称注册表出口）：locale 查表 → fallback_locale 回退 →
## 英文兜底(en_US) → 未登记返回 [key] 原样并告警计数 +1（不抛 Fatal）。
## 名称键本体一律英文（机器可读唯一底座），显示文本不得作为逻辑判断依据。
static func resolve_name_key(
	catalog: LocalizationRegistryCatalog,
	key: String,
	locale_override: String = ""
) -> String:
	if catalog == null or key.is_empty():
		missing_name_keys += 1
		return "[%s]" % key
	var resolved := translate(catalog, key, {}, locale_override)
	if resolved == "[%s]" % key:
		missing_name_keys += 1
	return resolved
