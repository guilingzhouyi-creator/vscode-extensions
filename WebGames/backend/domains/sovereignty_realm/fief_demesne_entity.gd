# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/sovereignty_realm/fief_demesne_entity.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: NationRealmAggregate | 下游: GameConfig | 配置: config/domains/sovereignty.json
# 职责说明: 领地封邑实体模型，记录所属城镇、领主与地方税率设置。
# 退出语义与设计依据: 业务领域第一性原理与单文件单类映射契约
## FiefDemesneEntity：领地封邑实体模型，记录所属城镇、领主与地方税率设置。
class_name FiefDemesneEntity
extends RefCounted

var fief_id: String = ""
var assigned_town_id: String = ""
var lord_entity_id: String = ""
var lord_tax_rate: float = GameConfig.get_float(
	"domains.sovereignty",
	"fief_defaults/lord_tax_rate",
	0.10
)
var title_rank: int = GameConfig.get_int(
	"domains.sovereignty",
	"fief_defaults/title_rank",
	2
)
