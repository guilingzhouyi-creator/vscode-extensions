# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/deterministic_sandbox/replay_validation_context.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: DeterministicReplayEngine, WorldGateway | 下游: GameConfig | 配置: config/domains/deterministic.json
# 职责说明: 确定性沙盒回放校验会话上下文（含初始状态快照、输入序列与状态指纹）。
# 退出语义与设计依据: 业务领域第一性原理与单文件单类映射契约
## ReplayValidationContext：确定性沙盒回放校验会话上下文（含初始状态快照、输入序列与状态指纹）。
class_name ReplayValidationContext
extends RefCounted

var session_id: String = "" # 回放会话 ID（一次回放一个会话）
var initial_state: Dictionary = {} # 回放初始状态快照（能量守恒断言基准）
var input_snapshots: Array = [] # 本会话全部确定性输入快照（按 tick 递增）
var recorded_state_hashes: Array = [] # 逐 tick 记录的状态哈希
var validation_status: String = GameConfig.get_string(
	"domains.deterministic",
	"replay_defaults/validation_status",
	"PENDING"
) # PENDING / VERIFIED / CHEAT_DETECTED
