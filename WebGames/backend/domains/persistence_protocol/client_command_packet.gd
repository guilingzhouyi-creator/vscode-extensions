# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/client_command_packet.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: PersistenceAndReconciliationSolver | 下游: GameConfig | 配置: config/infrastructure/persistence.json
# 职责说明: 客户端指令数据包实体，封装命令序号、类型、时间戳与载荷。
# 退出语义与设计依据: 业务领域第一性原理与单文件单类映射契约
## ClientCommandPacket：客户端指令数据包实体，封装命令序号、类型、时间戳与载荷。
class_name ClientCommandPacket
extends RefCounted

var command_id: String = ""
var sequence_number: int = 0
var command_type: String = GameConfig.get_string(
	"infrastructure.persistence",
	"command_defaults/command_type",
	"EXECUTE_COMBAT_ACTION"
)
var payload: Dictionary = {}
var client_timestamp: int = 0
