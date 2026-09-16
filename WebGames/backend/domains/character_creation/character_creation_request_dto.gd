# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/character_creation_request_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 创角请求入参契约。角色名为游戏内展示名唯一源头（character_name == display_name，严禁并行第二套名称体系）；请求体严禁携带战斗属性字段 （stats/attributes 一律由安全守卫丢弃并告警，属性后端权威派生）。 关联细则: Phase 48 阶段1 §1.2（创角请求契约）
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name CharacterCreationRequestDTO
extends RefCounted

# ==============================================================================
# 一、字段（请求参数契约）
# ==============================================================================

var account_id: String = ""              # 账号 ID（创角归属账号）
var slot_id: String = ""                 # 目标档位 ID（绑定目标，slot 维度唯一）
var world_id: String = ""                # 目标世界 ID
var character_name: String = ""          # 角色展示名唯一源头（display_name）
var selected_race_id: String = "HUMAN"   # 目标种族（经 races_catalog 配置校验）
var selected_gender: String = "MALE"     # 目标性别（经种族 allowed_genders 校验）
var extra_custom_fields: Dictionary = {} # 扩展自定义字段（战斗属性键会被防伪守卫丢弃）

# ==============================================================================
# 二、序列化与反序列化
# ==============================================================================

## 序列化创角请求为字典（extra_custom_fields 深拷贝防外部突变）
func to_dto() -> Dictionary:
	return {
		"account_id": account_id,
		"slot_id": slot_id,
		"world_id": world_id,
		"character_name": character_name,
		"selected_race_id": selected_race_id,
		"selected_gender": selected_gender,
		"extra_custom_fields": extra_custom_fields.duplicate(true)
	}

## 从字典反序列化创角请求（缺省字段安全回退默认值，空字典返回空请求）。
## 契约：输入 d 不做键集校验，缺失字段按各自默认值补齐（旧档兼容）。
static func from_dto(d: Dictionary) -> CharacterCreationRequestDTO:
	var req := CharacterCreationRequestDTO.new()
	if d.is_empty():
		return req
	req.account_id = str(d.get("account_id", ""))
	req.slot_id = str(d.get("slot_id", ""))
	req.world_id = str(d.get("world_id", ""))
	req.character_name = str(d.get("character_name", ""))
	req.selected_race_id = str(d.get("selected_race_id", "HUMAN"))
	req.selected_gender = str(d.get("selected_gender", "MALE"))
	req.extra_custom_fields = (d.get("extra_custom_fields", {}) as Dictionary).duplicate(true)
	return req
