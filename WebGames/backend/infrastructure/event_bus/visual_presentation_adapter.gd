# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · EventBus)
# 文件路径: res://backend/infrastructure/event_bus/visual_presentation_adapter.gd
# 架构定位: Event Broker / Decoupling Foundation
# 跨域依赖: 上游: 全域 47 业务域服务、GM追缴、网络层 | 下游: EventChannel, EventSubscriberToken | 配置: config/infrastructure/event_bus.json | 信号: 全域领域事件中心分发
# 职责说明: 事件总线表现适配门面：桥接领域业务逻辑与表现层接口，提供空间裁剪计算与提示合并分发。
# 设计依据: Phase 20 事件总线解耦规范 / Phase 77 前后端通信隔离契约
# ==============================================================================

class_name IVisualPresentationAdapter
extends RefCounted

## 实体生成表现回调
func on_entity_spawned(_entity_id: String, _initial_pos: Vector3) -> void:
	pass

## 实体位移表现回调
func on_entity_moved(_entity_id: String, _new_pos: Vector3, _facing_rad: float) -> void:
	pass

## 语义视觉线索触发回调
func on_visual_cue(_entity_id: String, _cue: VisualCueDTO) -> void:
	pass

## 空间范围爆发表现回调
func on_spatial_burst(_origin: Vector3, _radius: float, _cue: VisualCueDTO) -> void:
	pass

## 实体销毁表现回调
func on_entity_despawned(_entity_id: String) -> void:
	pass
