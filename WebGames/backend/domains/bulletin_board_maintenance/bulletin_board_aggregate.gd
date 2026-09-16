# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/bulletin_board_maintenance/bulletin_board_aggregate.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/bulletin_board_maintenance.json | 信号: EventBus 领域广播
# 职责说明: 维护公告卡片列表、维护倒计时模式与准入白名单状态
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name BulletinBoardAggregate
extends RefCounted

class BulletinCardDTO extends RefCounted:
	var card_id: String = ""
	var priority: int = GameConfig.get_int("domains.bulletin_board_maintenance", "defaults/priority", 100)                 # 权重 (数字越大越靠前)
	var title: String = ""
	var content_body: String = ""
	var banner_image_res: String = ""       # 图片资源路径或键
	var tag_label: String = "UPDATE"        # "UPDATE" / "EVENT" / "MAINTENANCE"
	var start_utc: int = 0
	var end_utc: int = 0

	## 公告卡片构造（ID/权重/标题/正文/标签）
	func _init(
		p_id: String = "",
		p_prio: int = 100,
		p_title: String = "",
		p_content: String = "",
		p_tag: String = "UPDATE"
	) -> void:
		card_id = p_id
		priority = p_prio
		title = p_title
		content_body = p_content
		tag_label = p_tag

var server_maintenance_mode: bool = false
var maintenance_end_timestamp_utc: int = 0
var maintenance_notice_msg: String = GameConfig.get_string("narratives.bulletin_board_maintenance", "maintenance_notice", "服务器正在进行例行维护，请稍后重试。")
var announcement_cards: Array = []

## 追加公告卡片并按权重降序重排
func add_card(card: BulletinCardDTO) -> void:
	announcement_cards.append(card)
	# 按权重降序排序
	announcement_cards.sort_custom(func(a: BulletinCardDTO, b: BulletinCardDTO):
		return a.priority > b.priority
	)
