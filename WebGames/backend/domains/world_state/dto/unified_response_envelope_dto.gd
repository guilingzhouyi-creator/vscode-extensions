# ==============================================================================
# 模块归属: 跨端通信层 (Protocol · 通用服务端响应信封)
# 文件路径: res://backend/domains/world_state/dto/unified_response_envelope_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: UnifiedProtocolDispatcher, EscMenuBackendService | 下游: 前端视图, 伴侣总线
# 职责说明: 规范服务端向客户端统一返回的业务结果信封，携带成功标识、错误代码、业务数据与因果突变
# 退出语义与设计依据: 纯数据模型无退出码；设计依据: 卡拉尔服务端统一响应信封规范与零堆分配对象池契约 (Inv-UNIFIED-ENVELOPE-1, Inv-ZERO-HEAP-POOL-3)
# ==============================================================================

## UnifiedResponseEnvelopeDTO：服务端统一响应信封 DTO，封装业务结果、状态码与错误信息
class_name UnifiedResponseEnvelopeDTO
extends PoolableDtoBase

var request_id: String = ""              # 关联的原始请求 ID
var success: bool = false                # 执行是否成功
var error_code: String = ""              # 错误码 (无错误为空)
var error_message: String = ""           # Localized display message key or diagnostic text
var data: Dictionary = {}                # 业务返回实体数据
var causal_delta: Dictionary = {}        # 操作引发的因果突变 (供 HUD 增量刷新与伴侣总线记录)
var server_timestamp_ms: int = 0         # 服务端响应落盘时间戳

## 重置内部数据状态，供对象池无堆分配复用
func reset_state() -> void:
	super.reset_state()
	request_id = ""
	success = false
	error_code = ""
	error_message = ""
	data.clear()
	causal_delta.clear()
	server_timestamp_ms = 0

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	return {
		"request_id": request_id,
		"success": success,
		"error_code": error_code,
		"error_message": error_message,
		"data": data.duplicate(true),
		"causal_delta": causal_delta.duplicate(true),
		"server_timestamp_ms": server_timestamp_ms
	}

## 从输入字典反序列化还原传输对象
static func from_dto(serialized_payload: Dictionary) -> UnifiedResponseEnvelopeDTO:
	var response := UnifiedResponseEnvelopeDTO.new()
	response.request_id = str(serialized_payload.get("request_id", ""))
	response.success = bool(serialized_payload.get("success", false))
	response.error_code = str(serialized_payload.get("error_code", ""))
	response.error_message = str(serialized_payload.get("error_message", ""))
	var raw_data: Variant = serialized_payload.get("data", {})
	response.data = (raw_data as Dictionary).duplicate(true) if raw_data is Dictionary else {}
	var raw_causal_delta: Variant = serialized_payload.get("causal_delta", {})
	response.causal_delta = (raw_causal_delta as Dictionary).duplicate(true) if raw_causal_delta is Dictionary else {}
	response.server_timestamp_ms = int(serialized_payload.get("server_timestamp_ms", 0))
	return response
