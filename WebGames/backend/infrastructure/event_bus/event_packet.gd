# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · EventBus)
# 文件路径: res://backend/infrastructure/event_bus/event_packet.gd
# 架构定位: Event Broker / Decoupling Foundation
# 跨域依赖: 上游: 全域 47 业务域服务、GM追缴、网络层 | 下游: EventChannel, EventSubscriberToken | 配置: config/infrastructure/event_bus.json | 信号: 全域领域事件中心分发
# 职责说明: 紧凑型强类型事件数据载体。原生承载 2D/3D 空间标头、多态业务载荷与池化生命周期 （遵循 ADV-POOL-001 规范，零循环内堆分配），彻底告别裸 Dictionary 历史包袱。
# 设计依据: Phase 20 事件总线解耦规范 / Phase 77 前后端通信隔离契约
# ==============================================================================

class_name EventPacket
extends RefCounted

# ---- 一、核心元数据头 (定长标量) ----
var event_id: int = 0              # 全局单调递增逻辑事件序号
var channel_id: int = 0            # EventChannelDefinition 整型信道常量
var category_mask: int = 0         # EventCategoryMask 位掩码
var timestamp_tick: int = 0
var source_entity_id: String = ""

# ---- 二、2D/3D 空间几何标头 ----
var is_spatial: bool = false
var world_position: Vector3 = Vector3.ZERO
var effect_radius: float = 0.0

# ---- 三、多态载荷（双通道：强类型 DTO 优先，轻量载荷兜底，二选一） ----
var payload_dto: RefCounted = null # 强类型业务 DTO（如 VisualCueDTO / 领域 DTO）
var payload_data: Variant = null   # 轻量载荷（Dictionary/Array），与 payload_dto 互斥使用

# ---- 四、叙事/日志契约（可选，承接 P71 文案通道；渲染接线归 P74） ----
var narrative_key: String = ""     # 对应 narratives.<域> 模板键
var narrative_args: Array = []

# ---- 五、池化生命周期状态 (ADV-POOL-001) ----
var is_borrowed: bool = false

## 状态复位（入池复用前必须调用）
func reset_state() -> void:
	event_id = 0
	channel_id = 0
	category_mask = 0
	timestamp_tick = 0
	source_entity_id = ""
	is_spatial = false
	world_position = Vector3.ZERO
	effect_radius = 0.0
	payload_dto = null
	payload_data = null
	narrative_key = ""
	narrative_args.clear()
	is_borrowed = false

## 设置 3D 空间几何标头
func set_spatial_header(pos: Vector3, radius: float) -> EventPacket:
	is_spatial = true
	world_position = pos
	effect_radius = maxf(0.0, radius)
	return self

## 设置 2D/2.5D 平面几何标头（无缝降维映射到 3D 无头坐标系）
func set_spatial_header_2d(pos_2d: Vector2, radius: float, is_isometric_xz: bool = false) -> EventPacket:
	is_spatial = true
	effect_radius = maxf(0.0, radius)
	world_position = Vector3(pos_2d.x, 0.0, pos_2d.y) if is_isometric_xz else Vector3(pos_2d.x, pos_2d.y, 0.0)
	return self
