# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/event_driven_audio/spatial_audio_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/event_driven_audio.json | 信号: EventBus 领域广播
# 职责说明: 空间几何欧氏距离线性衰减、左右声道立体声声相 Pan 计算与防爆音截断 （超出可听半径禁播）；可听半径由命令 DTO 携带（config 驱动）。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name SpatialAudioSolver
extends RefCounted

# ==============================================================================
# 一、空间声学求值
# ==============================================================================

## 空间声学求值：线性距离衰减 + 左右声相 Pan + 超半径禁播（防爆音截断）
## 契约：非空间音直接可播（volume = volume_scale * master_volume，pan = 0）；
##       dist >= max_audible_distance → play=false（禁播）；否则 eff_vol > 0.001 才可播。
## 性能：常量级求值，无循环与瞬态分配。
static func evaluate_spatial_audio(
	cmd: AudioDispatchCommandDTO,
	listener_pos: Vector2,
	master_volume: float
) -> Dictionary:
	if not cmd.is_spatial:
		return {
			"play": true,
			"effective_volume": cmd.volume_scale * master_volume,
			"pan": 0.0,
			"pitch": cmd.pitch_scale
		}

	var dist = listener_pos.distance_to(cmd.source_pos)
	if dist >= cmd.max_audible_distance:
		return {
			"play": false,
			"effective_volume": 0.0,
			"pan": 0.0,
			"pitch": cmd.pitch_scale
		}

	# 线性几何声学距离衰减：1.0（贴脸）→ 0.0（可听半径边缘）
	var dist_factor = clampf(1.0 - (dist / cmd.max_audible_distance), 0.0, 1.0)
	var eff_vol = cmd.volume_scale * dist_factor * master_volume

	# 左右声道水平声相 (Pan: -1.0 左, +1.0 右)
	var delta_x = cmd.source_pos.x - listener_pos.x
	var pan = clampf(delta_x / cmd.max_audible_distance, -1.0, 1.0)

	return {
		"play": eff_vol > 0.001,
		"effective_volume": eff_vol,
		"pan": pan,
		"pitch": cmd.pitch_scale
	}

# ==============================================================================
# 二、EventBus 2.0 空间声学分发接入 (Phase 72 示范)
# ==============================================================================

## 空间声学事件广播：经 EventBusCore 对象池与空间哈希网格派发
static func dispatch_spatial_audio_event(source_pos: Vector3, audio_cmd: RefCounted, max_dist: float) -> void:
	var bus := EventBusCore.get_instance()
	var packet := bus.borrow_packet(EventChannelDefinition.SPATIAL_AUDIO_PLAY, EventCategoryMask.SPATIAL_AUDIO)
	packet.payload_dto = audio_cmd
	bus.dispatch_spatial(packet, source_pos, max_dist)
	bus.recycle_packet(packet)

