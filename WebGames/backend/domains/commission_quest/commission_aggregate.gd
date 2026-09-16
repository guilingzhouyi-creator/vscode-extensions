# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/commission_quest/commission_aggregate.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/commission_quest.json | 信号: EventBus 领域广播
# 职责说明: 委托悬赏实体，定义冒险者 7 级资质阶位门槛、质押赏金、履约保证金与组织抽成
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name CommissionAggregate
extends RefCounted

enum CommissionTier {
	WOOD = 1,       # 木牌 (见习)
	IRON = 2,       # 铁牌 (初阶)
	BRONZE = 3,     # 铜牌 (中阶)
	SILVER = 4,     # 银牌 (高阶)
	GOLD = 5,       # 金牌 (大师)
	MYTHRIL = 6,    # 秘银 (英雄)
	ADAMANTITE = 7  # 秘钻 (传说天灾级)
}

enum CommissionStatus {
	POSTED_AVAILABLE,    # 挂板可接取
	ACCEPTED_IN_PROGRESS,# 已接取进行中
	COMPLETED_PENDING,   # 目标达成待结算
	SETTLED_SUCCESS,     # 已验收结算完毕
	FAILED_DEFAULTED     # 超时/放弃/违约已失效
}

var commission_id: String = ""                   # 委托全局唯一 ID
var issuing_org_id: String = ""                  # 发行承办组织 ID (如 "ORG_ADVENTURER_GUILD_CENTRAL")
var publisher_account_id: String = ""            # 雇主 ID (NPC 或玩家)
var title_key: String = ""                       # 委托标题
var required_tier: CommissionTier = CommissionTier.WOOD

# 经济与赏金
var reward_gold: int = GameConfig.get_int("domains.commission_quest", "defaults/reward_gold", 100)
var reward_mana_crystals: int = GameConfig.get_int("domains.commission_quest", "defaults/reward_mana_crystals", 0)
var org_tax_rate: float = GameConfig.get_float("domains.commission_quest", "defaults/org_tax_rate", 0.05)                   # 组织抽成比例 (默认 5%)
var security_deposit_required: int = GameConfig.get_int("domains.commission_quest", "defaults/security_deposit_required", 10)          # 接取人需押付的履约保证金

# 状态与时效
var status: CommissionStatus = CommissionStatus.POSTED_AVAILABLE
var assignee_account_id: String = ""             # 承接者账户 ID
var accept_timestamp_utc: int = 0
var deadline_timestamp_utc: int = 0

## 委托聚合构造（ID/标题/阶位门槛/赏金）
func _init(p_id: String = "", p_title: String = "", p_tier: CommissionTier = CommissionTier.WOOD, p_reward: int = 100) -> void:
	commission_id = p_id
	title_key = p_title
	required_tier = p_tier
	reward_gold = p_reward
