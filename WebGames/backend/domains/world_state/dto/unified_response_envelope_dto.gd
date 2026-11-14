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

const PoolableDtoBase = preload("res://backend/domains/persistence_protocol/poolable_dto_base.gd")

var request_id: String = ""              # 关联的原始请求 ID
var success: bool = false                # 执行是否成功
var is_success: bool:                    # 兼容别名属性 (对齐 Mod SDK 语义契约)
	get:
		return success
	set(value):
		success = value
var error_code: String = ""              # 错误码 (无错误为空)
var error_message: String = ""           # 本地化展示文案 Key 或调试信息
var data: Dictionary = {}                # 业务返回实体数据
var payload: Dictionary:                 # 兼容别名属性 (对齐 Mod SDK 载荷契约)
	get:
		return data
	set(value):
		data = value
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
		"is_success": success,
		"error_code": error_code,
		"error_message": error_message,
		"data": data.duplicate(true),
		"payload": data.duplicate(true),
		"causal_delta": causal_delta.duplicate(true),
		"server_timestamp_ms": server_timestamp_ms
	}

## 从输入字典反序列化还原传输对象
static func from_dto(serialized_payload: Dictionary) -> UnifiedResponseEnvelopeDTO:
	var response := UnifiedResponseEnvelopeDTO.new()
	response.request_id = str(serialized_payload.get("request_id", ""))
	if serialized_payload.has("is_success"):
		response.success = bool(serialized_payload.get("is_success", false))
	else:
		response.success = bool(serialized_payload.get("success", false))
	response.error_code = str(serialized_payload.get("error_code", ""))
	response.error_message = str(serialized_payload.get("error_message", ""))
	var raw_payload: Variant = serialized_payload.get("payload", serialized_payload.get("data", {}))
	response.data = (raw_payload as Dictionary).duplicate(true) if raw_payload is Dictionary else {}
	var raw_causal_delta: Variant = serialized_payload.get("causal_delta", {})
	response.causal_delta = (raw_causal_delta as Dictionary).duplicate(true) if raw_causal_delta is Dictionary else {}
	response.server_timestamp_ms = int(serialized_payload.get("server_timestamp_ms", 0))
	return response
