# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/prologue_event_packet_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 单个序章步骤的结构化事件包：角色归属 + 阶段步进 + 渲染后文案 + 可用动作 + 预留结构化突变载荷（CharacterCreated/EquipmentGranted/ LocationAssigned/DialogueReady），事件与状态解耦（不指示前端页面）。 关联细则: Phase 49 阶段1（事件包契约）
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name PrologueEventPacketDTO
extends RefCounted

# ==============================================================================
# 一、字段（序章事件包契约）
# ==============================================================================

var account_id: String = ""       # 归属账号 ID
var character_id: String = ""     # 角色唯一 ID
var character_name: String = ""   # 角色展示名
var current_stage: int = 0        # 当前序章阶段（1~4）
var step_index: int = 0           # 阶段内步骤索引
var narrative_text: String = ""   # 渲染后文案（后端 i18n 表 + 占位符解析产物）
var available_actions: Array[String] = [] # 本步可用动作枚举
var reserved_payload: Dictionary = {}     # 预留结构化突变载荷（前端可消费）

# ==============================================================================
# 二、序列化与反序列化
# ==============================================================================

## 序列化序章事件包为字典（available_actions 数组与 reserved_payload 深拷贝）
func to_dto() -> Dictionary:
	return {
		"account_id": account_id,
		"character_id": character_id,
		"character_name": character_name,
		"current_stage": current_stage,
		"step_index": step_index,
		"narrative_text": narrative_text,
		"available_actions": available_actions.duplicate(),
		"reserved_payload": reserved_payload.duplicate(true)
	}

## 从字典反序列化序章事件包（available_actions 逐元素转型，防类型化数组赋值错误）。
## 契约：空字典返回空包；available_actions 逐元素 str() 转换（禁整表 duplicate 赋类型化数组）。
static func from_dto(d: Dictionary) -> PrologueEventPacketDTO:
	var packet := PrologueEventPacketDTO.new()
	if d.is_empty():
		return packet
	packet.account_id = str(d.get("account_id", ""))
	packet.character_id = str(d.get("character_id", ""))
	packet.character_name = str(d.get("character_name", ""))
	packet.current_stage = int(d.get("current_stage", 0))
	packet.step_index = int(d.get("step_index", 0))
	packet.narrative_text = str(d.get("narrative_text", ""))
	packet.available_actions.clear()
	for a in (d.get("available_actions", []) as Array):
		packet.available_actions.append(str(a))
	packet.reserved_payload = (d.get("reserved_payload", {}) as Dictionary).duplicate(true)
	return packet
