# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/character_prologue_context.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 每个角色创建完成后独立建立序章执行上下文（非世界序章）：角色身份 唯一源头 + 运行时分配（起始地点/开局任务/新手套件）+ 单向阶段流转 + 占位符运行时缓存。严禁硬编码固定世界地点、坐标、NPC 或单一场景。 关联细则: Phase 49 阶段1（角色序章上下文实体与生命周期模型）
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name CharacterPrologueContext
extends RefCounted

# ==============================================================================
# 一、角色身份（唯一源头）
# ==============================================================================

var account_id: String = ""      # 归属账号 ID
var character_id: String = ""    # 角色唯一 ID（序章上下文主键）
var character_name: String = ""  # 角色展示名（文案占位符来源）
var race_id: String = "HUMAN"    # 种族 ID（影响 DAG 图谱与套件映射）
var gender: String = "OTHER"     # 性别

# ==============================================================================
# 二、运行时动态上下文（配置与创建参数确定，严禁代码硬编码）
# ==============================================================================

var assigned_start_location_id: String = ""   # 起始地点 ID（开场事件流注入）
var assigned_opening_quest_id: String = ""    # 开局主线引导 ID
var assigned_starter_kit_id: String = ""      # 新手套件 ID（未指派按种族兜底映射）

# ==============================================================================
# 三、序章单向阶段流转
# ==============================================================================

var current_stage: int = 0   # 当前序章阶段（1~4 单向递增）
var step_index: int = 0      # 阶段内步骤索引
var is_active: bool = false  # 活跃标记（推进中）
var is_completed: bool = false # 完结标记（终态）
var created_timestamp_utc: int = 0 # 上下文创建时间戳（Unix UTC 秒）

# ==============================================================================
# 四、占位符运行时缓存
# ==============================================================================

var runtime_placeholders: Dictionary = {} # 占位符键 → 动态解析实值（序章全程消费）

# ==============================================================================
# 五、序列化与反序列化
# ==============================================================================

## 序列化序章执行上下文为字典（runtime_placeholders 深拷贝防外部突变）
func to_dto() -> Dictionary:
	return {
		"account_id": account_id,
		"character_id": character_id,
		"character_name": character_name,
		"race_id": race_id,
		"gender": gender,
		"assigned_start_location_id": assigned_start_location_id,
		"assigned_opening_quest_id": assigned_opening_quest_id,
		"assigned_starter_kit_id": assigned_starter_kit_id,
		"current_stage": current_stage,
		"step_index": step_index,
		"is_active": is_active,
		"is_completed": is_completed,
		"created_timestamp_utc": created_timestamp_utc,
		"runtime_placeholders": runtime_placeholders.duplicate(true)
	}

## 从字典反序列化序章执行上下文（缺省字段回退默认值，占位符深拷贝）。
## 契约：空字典返回全新空上下文；未知键安全忽略（旧档兼容）。
static func from_dto(d: Dictionary) -> CharacterPrologueContext:
	var ctx := CharacterPrologueContext.new()
	if d.is_empty():
		return ctx
	ctx.account_id = str(d.get("account_id", ""))
	ctx.character_id = str(d.get("character_id", ""))
	ctx.character_name = str(d.get("character_name", ""))
	ctx.race_id = str(d.get("race_id", "HUMAN"))
	ctx.gender = str(d.get("gender", "OTHER"))
	ctx.assigned_start_location_id = str(d.get("assigned_start_location_id", ""))
	ctx.assigned_opening_quest_id = str(d.get("assigned_opening_quest_id", ""))
	ctx.assigned_starter_kit_id = str(d.get("assigned_starter_kit_id", ""))
	ctx.current_stage = int(d.get("current_stage", 0))
	ctx.step_index = int(d.get("step_index", 0))
	ctx.is_active = bool(d.get("is_active", false))
	ctx.is_completed = bool(d.get("is_completed", false))
	ctx.created_timestamp_utc = int(d.get("created_timestamp_utc", 0))
	ctx.runtime_placeholders = (d.get("runtime_placeholders", {}) as Dictionary).duplicate(true)
	return ctx
