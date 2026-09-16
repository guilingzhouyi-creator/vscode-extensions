# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/notification_red_dot/red_dot_tree_node.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/notification_red_dot.json | 信号: EventBus 领域广播
# 职责说明: 维护有向无环红点树状拓扑、直接计数与聚合计数，封装四级通知 DTO
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name RedDotTreeNode
extends RefCounted

var node_path: String = ""                  # 如 "menu.mail.unread"
var parent_path: String = ""                # 如 "menu.mail"
var direct_count: int = 0                   # 本身直接计数
var total_aggregated_count: int = 0         # 包含全部子节点的聚合计数
var children_paths: Array = []

## 红点树节点构造（路径/父路径/直计数/聚合计数/子路径）
func _init(
	p_path: String = "",
	p_parent: String = "",
	p_count: int = 0,
	p_children: Array = []
) -> void:
	node_path = p_path
	parent_path = p_parent
	direct_count = p_count
	total_aggregated_count = p_count
	children_paths = p_children

class NotificationDTO extends RefCounted:
	const DEFAULT_AUTO_DISMISS_SECONDS: float = 3.0

	enum NoticeType { TOAST, MODAL_DIALOG, BANNER_MARQUEE, SYSTEM_TRAY }
	var notice_id: String = ""
	var type: NoticeType = NoticeType.TOAST
	var title_loc_key: String = ""
	var content_loc_key: String = ""
	var params: Dictionary = {}
	var auto_dismiss_seconds: float = GameConfig.get_float("domains.notification_red_dot", "defaults/auto_dismiss_seconds", DEFAULT_AUTO_DISMISS_SECONDS)
	var actions_payload: Array = []         # [{"label": "confirm", "action": "DO_BUY"}]

	## 通知 DTO 构造（ID/类型/标题键/内容键/参数/自动关闭秒数）
	func _init(
		p_id: String = "",
		p_type: NoticeType = NoticeType.TOAST,
		p_title: String = "",
		p_content: String = "",
		p_params: Dictionary = {},
		p_dismiss: float = DEFAULT_AUTO_DISMISS_SECONDS
	) -> void:
		notice_id = p_id
		type = p_type
		title_loc_key = p_title
		content_loc_key = p_content
		params = p_params
		auto_dismiss_seconds = p_dismiss
