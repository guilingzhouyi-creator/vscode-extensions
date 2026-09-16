# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · EventBus)
# 文件路径: res://backend/infrastructure/event_bus/headless_presentation_mock_adapter.gd
# 架构定位: Event Broker / Decoupling Foundation
# 跨域依赖: 上游: 全域 47 业务域服务、GM追缴、网络层 | 下游: EventChannel, EventSubscriberToken | 配置: config/infrastructure/event_bus.json | 信号: 全域领域事件中心分发
# 职责说明: 无头环境表现层打桩适配器：在单测与 CLI 模式下捕获并断言表现层派发的视觉事件，替代实际渲染树完成端到端自动化测试验证。
# 设计依据: Phase 20 事件总线解耦规范 / Phase 77 前后端通信隔离契约
# ==============================================================================

class_name HeadlessPresentationMockAdapter
extends IVisualPresentationAdapter

var spawned_entities: Dictionary = {}
var recorded_cues: Array[Dictionary] = []

func on_entity_spawned(entity_id: String, initial_pos: Vector3) -> void:
	spawned_entities[entity_id] = initial_pos

func on_entity_moved(entity_id: String, new_pos: Vector3, _facing_rad: float) -> void:
	if spawned_entities.has(entity_id):
		spawned_entities[entity_id] = new_pos

func on_visual_cue(entity_id: String, cue: VisualCueDTO) -> void:
	recorded_cues.append({
		"entity_id": entity_id,
		"token": cue.cue_token,
		"intensity": cue.intensity
	})

func on_spatial_burst(origin: Vector3, radius: float, cue: VisualCueDTO) -> void:
	recorded_cues.append({
		"origin": origin,
		"radius": radius,
		"token": cue.cue_token
	})

func on_entity_despawned(entity_id: String) -> void:
	spawned_entities.erase(entity_id)
