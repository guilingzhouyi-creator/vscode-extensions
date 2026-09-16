# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/sovereignty_realm/feoffment_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/sovereignty.json | 信号: EventBus 领域广播
# 职责说明: 经历声望 ⊗ 战功驱动的动态爵位评定与领地封赏。 爵位阈值与头衔名由 config/sovereignty.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name SovereigntyAndFeoffmentSolver extends RefCounted

## 经历声望 ⊗ 战功驱动的动态封爵求解器
static func evaluate_knighthood_promotion(reputation: float, battle_merits: float) -> int:
	var duke_rep := GameConfig.get_float("domains.sovereignty", "promotion_thresholds/duke/reputation", 5000.0)
	var duke_merits := GameConfig.get_float("domains.sovereignty", "promotion_thresholds/duke/battle_merits", 10000.0)
	var count_rep := GameConfig.get_float("domains.sovereignty", "promotion_thresholds/count/reputation", 1000.0)
	var count_merits := GameConfig.get_float("domains.sovereignty", "promotion_thresholds/count/battle_merits", 2500.0)
	var baron_rep := GameConfig.get_float("domains.sovereignty", "promotion_thresholds/baron/reputation", 200.0)
	var baron_merits := GameConfig.get_float("domains.sovereignty", "promotion_thresholds/baron/battle_merits", 500.0)
	var knight_rep := GameConfig.get_float("domains.sovereignty", "promotion_thresholds/knight/reputation", 50.0)
	var knight_merits := GameConfig.get_float("domains.sovereignty", "promotion_thresholds/knight/battle_merits", 100.0)

	if reputation >= duke_rep and battle_merits >= duke_merits:
		return KnighthoodTitle.TitleRank.DUKE
	elif reputation >= count_rep and battle_merits >= count_merits:
		return KnighthoodTitle.TitleRank.COUNT
	elif reputation >= baron_rep and battle_merits >= baron_merits:
		return KnighthoodTitle.TitleRank.BARON
	elif reputation >= knight_rep and battle_merits >= knight_merits:
		return KnighthoodTitle.TitleRank.KNIGHT
	else:
		return KnighthoodTitle.TitleRank.COMMONER

static func get_title_name(rank: int) -> String:
	match rank:
		KnighthoodTitle.TitleRank.MONARCH: return GameConfig.get_string("domains.sovereignty", "title_names/monarch", "帝王")
		KnighthoodTitle.TitleRank.DUKE: return GameConfig.get_string("domains.sovereignty", "title_names/duke", "公爵")
		KnighthoodTitle.TitleRank.COUNT: return GameConfig.get_string("domains.sovereignty", "title_names/count", "伯爵")
		KnighthoodTitle.TitleRank.BARON: return GameConfig.get_string("domains.sovereignty", "title_names/baron", "男爵")
		KnighthoodTitle.TitleRank.KNIGHT: return GameConfig.get_string("domains.sovereignty", "title_names/knight", "骑士")
		_: return GameConfig.get_string("domains.sovereignty", "title_names/commoner", "平民")
