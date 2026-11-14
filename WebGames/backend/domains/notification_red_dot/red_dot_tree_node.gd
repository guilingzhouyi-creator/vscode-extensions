# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/notification_red_dot/red_dot_tree_node.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/notification_red_dot.json | 信号: EventBus 领域广播
# 职责说明: 维护有向无环红点树状拓扑、直接计数与聚合计数，封装四级通知 DTO
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## RedDotTreeNode：Domain Logic Component
class_name RedDotTreeNode
extends RefCounted

var node_path: String = ""                  # 如 "menu.mail.unread"
var parent_path: String = ""                # 如 "menu.mail"
var direct_count: int = 0                   # 本身直接计数
var total_aggregated_count: int = 0         # 包含全部子节点的聚合计数
var children_paths: Array = []

## 红点树节点构造（路径/父路径/直计数/聚合计数/子路径）
func _init(
	initial_node_path: String = "",
	initial_parent_path: String = "",
	initial_direct_count: int = 0,
	initial_children_paths: Array = []
) -> void:
	node_path = initial_node_path
	parent_path = initial_parent_path
	direct_count = initial_direct_count
	total_aggregated_count = initial_direct_count
	children_paths = initial_children_paths

## NotificationDTO：系统通知数据传输模型
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
		initial_notice_id: String = "",
		initial_type: NoticeType = NoticeType.TOAST,
		initial_title_key: String = "",
		initial_content_key: String = "",
		initial_parameter_map: Dictionary = {},
		initial_dismiss_seconds: float = DEFAULT_AUTO_DISMISS_SECONDS
	) -> void:
		notice_id = initial_notice_id
		type = initial_type
		title_loc_key = initial_title_key
		content_loc_key = initial_content_key
		params = initial_parameter_map
		auto_dismiss_seconds = initial_dismiss_seconds
