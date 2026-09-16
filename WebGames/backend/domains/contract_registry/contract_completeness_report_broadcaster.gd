# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/contract_registry/contract_completeness_report_broadcaster.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/contract_registry.json | 信号: EventBus 领域广播
# 职责说明: 经 EventBus 唯一官方入口广播契约完整性快照报告与破坏性变更告警
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name ContractCompletenessReportBroadcaster
extends RefCounted


## 广播契约完整性扫描报告
static func broadcast_completeness_report(report: Variant) -> void:
	if EventBusCore.get_instance() == null:
		return

	var payload: Dictionary = {}
	if report is Dictionary:
		payload = report
	elif report != null and report.has_method("to_dto"):
		payload = report.to_dto()

	EventBusCore.get_instance().emit_domain_event("contract_registry.completeness_report", payload)


## 广播契约层待处理破坏性变更告警
static func alert_breaking_change_pending(contracts: Array) -> void:
	if EventBusCore.get_instance() == null:
		return

	var clean_contracts: Array = []
	for c in contracts:
		if c is Dictionary:
			clean_contracts.append(c)
		elif c != null and c.has_method("to_dto"):
			clean_contracts.append(c.to_dto())

	EventBusCore.get_instance().emit_domain_event("contract_registry.breaking_change_pending", {
		"contracts": clean_contracts,
		"count": clean_contracts.size(),
		"timestamp": Time.get_datetime_string_from_system()
	})
