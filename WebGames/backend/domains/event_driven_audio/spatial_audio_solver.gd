# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/event_driven_audio/spatial_audio_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/event_driven_audio.json | 信号: EventBus 领域广播
# 职责说明: 空间几何欧氏距离线性衰减、左右声道立体声声相 Pan 计算与防爆音截断 （超出可听半径禁播）；可听半径由命令 DTO 携带（config 驱动）。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## SpatialAudioSolver：Headless Discrete Solver / Numerical Calculator
class_name SpatialAudioSolver
extends RefCounted

# ==============================================================================
# 一、空间声学求值
# ==============================================================================

## 空间声学求值：线性距离衰减 + 左右声相 Pan + 超半径禁播（防爆音截断）
## 契约：非空间音直接可播（volume = volume_scale * master_volume，pan = 0）；
##       distance >= max_audible_distance → play=false（禁播）；否则 effective_volume > 0.001 才可播。
## 性能：常量级求值，无循环与瞬态分配。
static func evaluate_spatial_audio(
	command: AudioDispatchCommandDTO,
	listener_position: Vector2,
	master_volume: float
) -> Dictionary:
	if not command.is_spatial:
		return {
			"play": true,
			"effective_volume": command.volume_scale * master_volume,
			"pan": 0.0,
			"pitch": command.pitch_scale
		}

	var distance: float = listener_position.distance_to(command.source_pos)
	if distance >= command.max_audible_distance:
		return {
			"play": false,
			"effective_volume": 0.0,
			"pan": 0.0,
			"pitch": command.pitch_scale
		}

	# 线性几何声学距离衰减：1.0（贴脸）→ 0.0（可听半径边缘）
	var distance_factor := clampf(1.0 - (distance / command.max_audible_distance), 0.0, 1.0)
	var effective_volume: Variant = command.volume_scale * distance_factor * master_volume

	# 左右声道水平声相 (Pan: -1.0 左, +1.0 右)
	var delta_x: Variant = command.source_pos.x - listener_position.x
	var pan := clampf(delta_x / command.max_audible_distance, -1.0, 1.0)

	return {
		"play": effective_volume > 0.001,
		"effective_volume": effective_volume,
		"pan": pan,
		"pitch": command.pitch_scale
	}

# ==============================================================================
# 二、EventBus 2.0 空间声学分发接入 (示范)
# ==============================================================================

## 空间声学事件广播：经 EventBusCore 对象池与空间哈希网格派发
static func dispatch_spatial_audio_event(source_position: Vector3, audio_command: RefCounted, max_distance: float) -> void:
	var bus := EventBusCore.get_instance()
	var packet := bus.borrow_packet(EventChannelDefinition.SPATIAL_AUDIO_PLAY, EventCategoryMask.SPATIAL_AUDIO)
	packet.payload_dto = audio_command
	bus.dispatch_spatial(packet, source_position, max_distance)
	bus.recycle_packet(packet)
