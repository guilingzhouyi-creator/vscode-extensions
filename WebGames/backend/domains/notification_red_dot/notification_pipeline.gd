# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/notification_red_dot/notification_pipeline.gd
# 架构定位: Business Pipeline / Transaction Safe Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/notification_red_dot.json | 信号: EventBus 领域广播
# 职责说明: 派发 Toast / 二次确认弹窗 / 全服跑马灯 / 系统托盘通知 DTO 流
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name NotificationPipeline
extends RefCounted

## 通知推流：入队并返回队尾信息（notice_id/类型/队列深度）
static func push_notification(
	notification_queue: Array,
	notice: RedDotTreeNode.NotificationDTO
) -> Dictionary:
	notification_queue.append(notice)
	return {
		"pushed": true,
		"notice_id": notice.notice_id,
		"type": notice.type,
		"queue_size": notification_queue.size()
	}
