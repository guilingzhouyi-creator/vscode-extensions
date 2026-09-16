# ==============================================================================
# 模块归属: 业务领域层 (Domains · 经济、交易与物流集群 (Economy & Trade))
# 文件路径: res://backend/domains/cdkey_voucher/cdkey_voucher_aggregate.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/cdkey_voucher.json | 信号: EventBus 领域广播
# 职责说明: 兑换码批次与凭证领域聚合根，定义通用广播码与一次性唯一码、时效与门槛
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name CDKeyVoucherAggregate
extends RefCounted

enum VoucherType {
	UNIVERSAL_PER_ACCOUNT, # 全服通用码 (每账户限领1次)
	UNIQUE_ONE_TIME        # 一次性唯一码 (全服仅限1次，核销即废)
}

var voucher_code: String = ""                    # 兑换码明文 (标准化大写如 "KALAR_WELCOME_2026")
var voucher_type: VoucherType = VoucherType.UNIVERSAL_PER_ACCOUNT
var batch_id: String = ""                        # 批次 ID (如 "BATCH_STEAM_LAUNCH_2026")
var localized_title: String = ""                 # 礼包展示标题 (如 "新手启航补给箱")

# 时效与可用性配置（默认值由 config/domains/cdkey_voucher.json 的 defaults.* 驱动）
var valid_from_utc: int = GameConfig.get_int("domains.cdkey_voucher", "defaults/valid_from_utc", 0)
var valid_to_utc: int = GameConfig.get_int("domains.cdkey_voucher", "defaults/valid_to_utc", 4102444800)
var max_global_redemptions: int = GameConfig.get_int("domains.cdkey_voucher", "defaults/max_global_redemptions", -1)
var current_global_redemptions: int = GameConfig.get_int("domains.cdkey_voucher", "defaults/current_global_redemptions", 0)
var required_character_level: int = GameConfig.get_int("domains.cdkey_voucher", "defaults/required_character_level", 1)
var is_active: bool = GameConfig.get_bool("domains.cdkey_voucher", "defaults/is_active", true)

# 兑换码级复合门槛规则（Phase 36 S2）：按 rule_id 覆盖全局 eligibility_rules；
# 空字典 = 无兑换码级规则（仅全局生效）
var eligibility_rules: Dictionary = {}

# 奖励载荷配置包 (Reward Payload DTO)
var reward_payload: Dictionary = {
	"mana_monocrystals": GameConfig.get_int("domains.cdkey_voucher", "reward_payload/mana_monocrystals", 0),
	"gold_coins": GameConfig.get_int("domains.cdkey_voucher", "reward_payload/gold_coins", 0),
	"silver_coins": GameConfig.get_int("domains.cdkey_voucher", "reward_payload/silver_coins", 0),
	"copper_coins": GameConfig.get_int("domains.cdkey_voucher", "reward_payload/copper_coins", 0),
	"item_templates": [],                        # [{"template_id": "POTION_HEALTH", "count": 5}]
	"grimoire_ast_keys": []
}

## CDK 凭证构造（兑换码标准化大写 + 类型/标题）
func _init(p_code: String = "", p_type: VoucherType = VoucherType.UNIVERSAL_PER_ACCOUNT, p_title: String = "") -> void:
	voucher_code = p_code.strip_edges().to_upper()
	voucher_type = p_type
	localized_title = p_title
