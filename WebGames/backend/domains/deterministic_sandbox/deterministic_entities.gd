# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/deterministic_sandbox/deterministic_entities.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/deterministic.json | 信号: EventBus 领域广播
# 职责说明: 确定性输入动作快照与回放校验上下文（tick 对齐、固定种子、 状态指纹比对）；默认动作/种子/校验状态由 config/deterministic.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name DeterministicInputSnapshot extends RefCounted

# ==============================================================================
# 一、确定性输入动作快照
# ==============================================================================

## 逻辑帧号（回放对齐与输入连续性审计锚点）
var tick: int = 0
## 动作命令（PhysicalVerbRegistry 已登记键，默认 SLASH）
var action_command: String = GameConfig.get_string("domains.deterministic", "snapshot_defaults/action_command", "SLASH")
## 目标实体 ID（空串表示无目标/自施放）
var target_id: String = ""
## 定点伪随机种子（同种子同序列，回放可复现）
var rng_seed: int = GameConfig.get_int("domains.deterministic", "snapshot_defaults/rng_seed", 12345)
## 客户端本机时间戳（毫秒，仅审计/对账参考，不入指纹）
var client_timestamp: int = 0
## 附加载荷（扩展字段透传，不入指纹）
var input_payload: Dictionary = {}

## 序列化确定性输入快照为字典
func serialize() -> Dictionary:
	return {
		"tick": tick,
		"action_command": action_command,
		"target_id": target_id,
		"rng_seed": rng_seed,
		"client_timestamp": client_timestamp,
		"input_payload": input_payload
	}

# ==============================================================================
# 二、回放校验上下文（会话级）
# ==============================================================================

class ReplayValidationContext extends RefCounted:
	## 回放会话 ID（一次回放一个会话）
	var session_id: String = ""
	## 回放初始状态快照（能量守恒断言基准）
	var initial_state: Dictionary = {}
	## 本会话全部确定性输入快照（按 tick 递增）
	var input_snapshots: Array = []
	## 逐 tick 记录的状态哈希（与 DeterministicReplayEngine 指纹比对）
	var recorded_state_hashes: Array = []
	## 校验结果状态：PENDING / VERIFIED / CHEAT_DETECTED（config/deterministic.json 驱动）
	var validation_status: String = GameConfig.get_string("domains.deterministic", "replay_defaults/validation_status", "PENDING") # PENDING / VERIFIED / CHEAT_DETECTED
