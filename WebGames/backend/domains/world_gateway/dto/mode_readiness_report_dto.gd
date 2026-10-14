# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/dto/mode_readiness_report_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: ModeReadinessProbe, WorldGatewayFSM | 下游: 无 | 配置: config/domains/world_gateway/core.json | 信号: 无
# 职责说明: 承载单机与联机运行模式环境探针的探测报告与网络/存储能力诊断结果。
# 退出语义与设计依据: 业务域第一性原理 / 模式就绪探测与防越权隔离拓扑规范
# ==============================================================================

## ModeReadinessReportDTO：Value Object DTO / Data Transport Model
class_name ModeReadinessReportDTO
extends RefCounted

var mode: int = 0
var is_ready: bool = false
var status_code: String = ""
var message: String = ""
var latency_ms: int = 0
var capabilities: Array = []

func _init(
	p_mode: int = 0,
	p_is_ready: bool = false,
	p_status_code: String = "",
	p_message: String = "",
	p_latency_ms: int = 0,
	p_capabilities: Array = []
) -> void:
	mode = p_mode
	is_ready = p_is_ready
	status_code = p_status_code
	message = p_message
	latency_ms = p_latency_ms
	capabilities = p_capabilities.duplicate()

## 对象状态复位（支持对象池复用，ADV-PRF-002）
func reset_state() -> void:
	mode = 0
	is_ready = false
	status_code = ""
	message = ""
	latency_ms = 0
	capabilities.clear()

## 序列化为字典传输对象
func to_dto() -> Dictionary:
	return {
		"mode": mode,
		"is_ready": is_ready,
		"status_code": status_code,
		"message": message,
		"latency_ms": latency_ms,
		"capabilities": capabilities.duplicate()
	}

## 从字典还原构建 DTO 实例
static func from_dto(d: Dictionary) -> ModeReadinessReportDTO:
	if d.is_empty():
		return ModeReadinessReportDTO.new()
	var dto := ModeReadinessReportDTO.new()
	dto.mode = int(d.get("mode", 0))
	dto.is_ready = bool(d.get("is_ready", false))
	dto.status_code = String(d.get("status_code", ""))
	dto.message = String(d.get("message", ""))
	dto.latency_ms = int(d.get("latency_ms", 0))
	var raw_caps: Variant = d.get("capabilities", [])
	if raw_caps is Array:
		dto.capabilities = (raw_caps as Array).duplicate()
	else:
		dto.capabilities = []
	return dto
