# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/item_namespace_registry/magic_tier_snapshot.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/item_namespace_registry.json | 信号: EventBus 领域广播
# 职责说明: 魔法体系统一基线数据契约——施法形态（4）、魔法资质（4 档，魔适者为 修炼门槛）、**阶位梯度（连续 1~11 阶，纯强度/规模/技术层级梯度， 无能力分级前缀）、能力分级（异能/英雄/神圣/真神 + 超位，独立平行维度）**、 施法者战斗实力称号（13 级，前三档魔术师 = 非魔法范畴） + Phase 26 用户纠正（双维度平行体系：阶位梯度 × 能力分级）
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name MagicTierSnapshot
extends RefCounted

# ==============================================================================
# 一、施法形态 / 魔法资质 / 阶位梯度 / 能力分级 / 阶位档次 / 实力称号枚举
# ==============================================================================

# 1. 施法形态（复用既有 MagicForm 语义，英文枚举唯一规范；枚举值 1 起与配置键对齐）
enum MagicForm {
	PRIMORDIAL = 1,  # 始源魔法（魔素直接驱动 · 无咏唱直驱）
	INCANTATION,     # 咒术魔法（魔素按咒词顺序转化 · 有咏唱规范驱动）
	INTEGRATED,      # 集成魔法（咒术聚合驱动 / 条件触发聚合驱动）
	SUPERTIER,       # 超位魔法（超越位阶上限 · 类始源极效魔法）
}

# 2. 魔法资质（复用既有 ManaAptitude 四档；魔适者为修炼魔法必要门槛；枚举值 1 起与配置键对齐）
enum ManaAptitude {
	MANA_ADAPTOR = 1,  # 魔适者（基础微控，修炼门槛 · 每百人至少一人）
	WORD_SPEAKER,      # 言灵者（共振增幅 · 每万人至少一人）
	AWAKENED,          # 觉醒者（回路自适应 · 每百万人至少一人）
	HEAVEN_RULER,      # 天权者（位阶压制 · 稀有度未指定）
}

# 3. 阶位梯度（Phase 26 去嵌套化：连续 1~11 阶纯梯度，无能力分级前缀；
#    量化魔法强度/规模/技术层级；枚举值 = 阶位号，严格递增）
enum MagicRank {
	RANK_1 = 1, RANK_2, RANK_3, RANK_4, RANK_5,
	RANK_6, RANK_7, RANK_8, RANK_9, RANK_10, RANK_11,
}

# 3b. 能力分级（Phase 26 独立平行维度：描述施法主体/存在总体能力层次与身份范畴；
#    不直接决定具体魔法的阶位；SUPERTIER 为超位高级位阶）
enum AbilityTier {
	ESP = 1,      # 异能
	HEROIC,       # 英雄
	DIVINE,       # 神圣
	GOD,          # 真神
	SUPERTIER,    # 超位（真神之上/超越位阶上限的特殊存在）
}

# 3c. 阶位档次（Phase 27 第三平行维度：按阶位确定性区间分段——低阶 1~3 / 中阶 4~6 /
#     高阶 7~9 / 超位 10~11 统称；互斥全覆盖，禁嵌套命名（低阶一阶禁止））
enum MagicRankBand {
	LOW = 1,        # 低阶魔法（1~3 阶）
	MID,            # 中阶魔法（4~6 阶）
	HIGH,           # 高阶魔法（7~9 阶）
	SUPERTIER,      # 超位魔法（10~11 阶统称）
}

# 4. 施法者战斗实力称号（独立维度，13 级单调；前三档为魔术师 = 非魔法范畴；枚举值 1 起与配置键对齐）
enum ProfessionRank {
	THIRD_RATE_TRICKSTER = 1,  # 三流魔术师（魔术 ≠ 魔法）
	SECOND_RATE_TRICKSTER,     # 二流魔术师（魔术 ≠ 魔法）
	QUASI_MAGIC_USER,          # 准魔法使/师
	NOVICE_MAGE,               # 初级魔士
	INTERMEDIATE_MAGE,         # 中级魔士
	SENIOR_MAGE,               # 高级魔士
	PLATINUM_MAGE,             # 铂金魔士
	GOLD_MAGE,                 # 黄金魔士
	STELLAR_MAGE,              # 星辉魔士
	LEGION_MAGISTRATE,         # 军魔导士
	ROYAL_MAGISTRATE,          # 王魔导士
	HOLY_ARCHMAGE,             # 圣魔导师（对齐既有 ARCHMAGE 职业）
	PRIMORDIAL_ARCHDEMON,      # 始源魔神（对齐 MagicForm.PRIMORDIAL）
}

# ==============================================================================
# 二、核心属性字段
# ==============================================================================

# 5. 核心属性与字段定义
var canonical_id: String = ""
var magic_form: MagicForm = MagicForm.INCANTATION
var magic_rank: MagicRank = MagicRank.RANK_1
var ability_tier: AbilityTier = AbilityTier.ESP   # 能力分级（独立平行维度）
# Phase 33：弱映射候选集合——与 ability_tier 标量分离（候选可有空/多项，顺序稳定排序；禁止隐式类型转换）
var ability_tier_candidates: Array = []
var rank_band: MagicRankBand = MagicRankBand.LOW   # 阶位档次（第三平行维度）
var mana_aptitude: ManaAptitude = ManaAptitude.MANA_ADAPTOR
var profession_rank: ProfessionRank = ProfessionRank.NOVICE_MAGE
var strength_weight: float = 1.0       # 位阶强度基线权重（配置驱动）
var phase_loss_min: float = 0.0        # 形态相变能损下限（配置驱动）
var phase_loss_max: float = 0.0        # 形态相变能损上限（配置驱动）
var backfire_threshold: int = 1        # 资质反噬阈值（配置驱动）

# ==============================================================================
# 三、映射与不变量校验
# ==============================================================================

## 阶位单调映射：MagicRank -> 1~11（唯一事实源，严格递增，禁跨级倒置）。
## Phase 33：非法值返回 0（显式未登记哨兵——不静默伪装为一阶；仅展示层允许配置化安全兜底）
static func rank_to_level(rank: MagicRank) -> int:
	var v: int = int(rank)
	return v if v >= 1 and v <= 11 else 0

## 高阶位阶判定（RANK_10 / RANK_11，即能力分级真神区间 9~11 的高端）
static func is_god_rank(rank: MagicRank) -> bool:
	return rank == MagicRank.RANK_10 or rank == MagicRank.RANK_11

## 从属不变量：高阶位阶（RANK_10/RANK_11）必须配对超位形态（MagicForm.SUPERTIER）
static func is_god_form_pair_valid(rank: MagicRank, form: MagicForm) -> bool:
	if not is_god_rank(rank):
		return true
	return form == MagicForm.SUPERTIER

## 魔术/魔法边界：实力称号是否属于魔法范畴（前三档魔术师 = 非魔法）
static func is_magic_domain(profession_rank: ProfessionRank) -> bool:
	return profession_rank > ProfessionRank.SECOND_RATE_TRICKSTER

# ==============================================================================
# 四、DTO 数据交换契约
# ==============================================================================

## 序列化为字典（各枚举转整型，前端消费契约）
func to_dto() -> Dictionary:
	return {
		"canonical_id": canonical_id,
		"magic_form": int(magic_form),
		"magic_rank": int(magic_rank),
		"ability_tier": int(ability_tier),
		"rank_band": int(rank_band),
		"mana_aptitude": int(mana_aptitude),
		"profession_rank": int(profession_rank),
		"strength_weight": strength_weight,
		"phase_loss_min": phase_loss_min,
		"phase_loss_max": phase_loss_max,
		"backfire_threshold": backfire_threshold,
	}

## 从字典反序列化还原（缺省字段回退默认枚举与权重）
static func from_dto(data: Dictionary) -> MagicTierSnapshot:
	var snap := MagicTierSnapshot.new()
	snap.canonical_id = str(data.get("canonical_id", ""))
	snap.magic_form = int(data.get("magic_form", MagicForm.INCANTATION))
	snap.magic_rank = int(data.get("magic_rank", MagicRank.RANK_1))
	snap.ability_tier = int(data.get("ability_tier", AbilityTier.ESP))
	snap.rank_band = int(data.get("rank_band", MagicRankBand.LOW))
	snap.mana_aptitude = int(data.get("mana_aptitude", ManaAptitude.MANA_ADAPTOR))
	snap.profession_rank = int(data.get("profession_rank", ProfessionRank.NOVICE_MAGE))
	snap.strength_weight = float(data.get("strength_weight", 1.0))
	snap.phase_loss_min = float(data.get("phase_loss_min", 0.0))
	snap.phase_loss_max = float(data.get("phase_loss_max", 0.0))
	snap.backfire_threshold = int(data.get("backfire_threshold", 1))
	return snap
