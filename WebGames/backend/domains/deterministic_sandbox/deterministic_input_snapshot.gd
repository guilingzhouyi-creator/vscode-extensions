# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/deterministic_sandbox/deterministic_input_snapshot.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/deterministic.json | 信号: EventBus 领域广播
# 职责说明: 确定性输入动作快照与回放校验上下文（tick 对齐、固定种子、 状态指纹比对）；默认动作/种子/校验状态由 config/deterministic.json 驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
## DeterministicInputSnapshot：Domain Logic Component
class_name DeterministicInputSnapshot
extends RefCounted

var tick: int = 0 # 逻辑帧号（回放对齐与输入连续性审计锚点）
var action_command: String = GameConfig.get_string(
	"domains.deterministic",
	"snapshot_defaults/action_command",
	"SLASH"
)
var target_id: String = "" # 目标实体 ID（空串表示无目标/自施放）
var rng_seed: int = GameConfig.get_int(
	"domains.deterministic",
	"snapshot_defaults/rng_seed",
	12345
)
var client_timestamp: int = 0 # 客户端本机时间戳（仅审计参考，不入指纹）
var input_payload: Dictionary = {} # 附加载荷（扩展字段透传，不入指纹）

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
