# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Copywriting Engine)
# 文件路径: res://backend/infrastructure/copywriting_resolver.gd
# 架构定位: High-Performance Pure Resolver
# 跨域依赖: 上游: 全域 47 业务域（物品、事件、通知、技能） | 下游: GameConfig | 配置: config/copywriting/*.json | 信号: 无
# 职责说明: 全域统一文案解析中枢（单一真源）：基于「域.条目.字段」结构化定位模板，执行 {param} 正则参数填充、条件分支裁决与缺失降级拦截。
# 设计依据: Phase 24 统一文案单一真源架构 / Phase 83 兼容层彻底退役
# ==============================================================================

class_name CopywritingResolver
extends RefCounted

# ==============================================================================
# 一、状态与正则
# ==============================================================================

## 未填充参数告警计数（遥测/审计只读，禁业务分支）
static var missing_params_count: int = 0

static var _param_regex: RegEx = RegEx.create_from_string(r"\{([a-z_][a-z0-9_]*)\}")

# ==============================================================================
# 二、统一文案解析入口
# ==============================================================================

## 统一文案解析：copy_key（<域>.<条目>.<字段>）→ 配置模板 → {param} 填充
## - conditions：params 状态匹配 when → 拼接 text 段；
## - outcome：结果分支（success/failure/partial…），缺省 base 兜底；
## - 纯模板：无条件/分支时直接填充（公告/概率文案）。
static func resolve(
	copy_key: String,
	params: Dictionary = {},
	outcome: String = "",
	locale_override: String = ""
) -> Dictionary:
	var parts := copy_key.split(".")
	if parts.size() < 3:
		return {"success": false, "code": "COPY_KEY_INVALID", "copy_key": copy_key}

	var domain := parts[0]
	var table_name := "copywriting." + domain
	var entry: Dictionary = GameConfig.get_dict(table_name, parts[1], {})
	if entry.is_empty():
		return {"success": false, "code": "COPY_ENTRY_MISSING", "copy_key": copy_key}

	var template := _select_template(entry, params, outcome)
	if template.is_empty():
		return {"success": false, "code": "COPY_TEMPLATE_MISSING", "copy_key": copy_key}

	var missing := _missing_params(template, params)
	if not missing.is_empty():
		missing_params_count += missing.size()
		return {"success": false, "code": "MISSING_PARAMS", "copy_key": copy_key, "missing": missing}

	# 文案键登记名称注册表（跨域唯一；同域幂等）
	LocalizationRegistryCatalog.get_shared().register_name_key(copy_key, domain, copy_key)
	return {"success": true, "copy_key": copy_key, "text": _fill(template, params)}

# ==============================================================================
# 三、内部实现（模板选择 / 状态匹配 / 填充）
# ==============================================================================

## 模板选择：outcome 结果分支（缺省 base）+ conditions 状态条件段拼接
static func _select_template(entry: Dictionary, params: Dictionary, outcome: String) -> String:
	var text := ""
	if not outcome.is_empty():
		text = str(entry.get(outcome, entry.get("base", "")))
	else:
		text = str(entry.get("base", str(entry.get("text", ""))))
	var conditions: Array = entry.get("conditions", [])
	for cond in conditions:
		if _state_match(cond.get("when", {}), params):
			text += str(cond.get("text", ""))
	return text

## 状态条件匹配（参数值比较：数值取下限语义，其余等值）
static func _state_match(when: Dictionary, params: Dictionary) -> bool:
	for key in when.keys():
		if not params.has(key):
			return false
		var want: Variant = when[key]
		var got: Variant = params[key]
		if want is float or want is int:
			if float(got) < float(want):
				return false
		elif str(got) != str(want):
			return false
	return true

## 占位符未填充扫描（一处实现，域解析器共用）
static func _missing_params(template: String, params: Dictionary) -> Array:
	var missing: Array = []
	for m in _param_regex.search_all(template):
		var name := m.get_string(1)
		if not params.has(name):
			missing.append(name)
	return missing

## 模板填充：将 {param} 占位符替换为参数字符串化值
static func _fill(template: String, params: Dictionary) -> String:
	var text := template
	for k in params.keys():
		text = text.replace("{" + str(k) + "}", str(params[k]))
	return text
