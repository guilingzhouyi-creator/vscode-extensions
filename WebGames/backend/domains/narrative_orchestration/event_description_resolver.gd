# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/event_description_resolver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/narrative_orchestration.json | 信号: EventBus 领域广播
# 职责说明: 根据实际事件/上下文/结果（result.outcome 分支）生成事件描述——**不承担 事件判定**（生成于事件执行之后，result 由事件层写入，只读消费）。 Phase 24：文本生成收敛至统一文案核心 CopywritingResolver（结果分支/条件段/ {param} 填充/未填充拦截/键登记一处实现）；本类保留 EVENT_DESC_MISSING 配置存在性检查（测试断言兼容）与零判定时序（result 只读合并）。
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name EventDescriptionResolver
extends RefCounted

## 事件描述解析：事件 + 上下文 + 结果 → 统一文案核心（结果分支模板）
## 时序：事件层执行/判定完成后调用（result.outcome 由事件层写入，描述层零判定）
static func resolve(
	event_id: String,
	context: Dictionary = {},
	result: Dictionary = {},
	locale_override: String = ""
) -> Dictionary:
	# 配置存在性检查（迁移至文案单一真源 copywriting.narrative；顶层键即 event_id）
	var entry: Dictionary = GameConfig.get_dict("copywriting.narrative", event_id, {})
	if entry.is_empty():
		return {"success": false, "code": "EVENT_DESC_MISSING", "event_id": event_id}

	# 参数注入：context + result 只读合并（outcome 为分支选择键，不入文本参数）
	var params := _build_params(context, result)

	# 文本生成：统一文案核心（Phase 24）——outcome 结果分支（缺省 base 兜底）+ 未填充
	# 拦截 + 描述键登记（跨域唯一）在共享核心一处实现。
	# 统一文案键三段式：<域 narrative>.<条目 事件ID>.<字段 desc>
	return CopywritingResolver.resolve(
		"narrative." + event_id + ".desc", params, str(result.get("outcome", "base")), locale_override)

## 参数注入：context（事件上下文）+ result（事件执行结果）只读合并（outcome 除外）
static func _build_params(context: Dictionary, result: Dictionary) -> Dictionary:
	var params: Dictionary = {}
	for k in context.keys():
		params[k] = context[k]
	for k in result.keys():
		if str(k) != "outcome":
			params[k] = result[k]
	return params
