# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/sovereignty_realm/knighthood_title.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/sovereignty.json | 信号: EventBus 领域广播
# 职责说明: 爵位头衔等级、封地领地自治实体与动态主权国家聚合根。 国家/封地默认值由 config/sovereignty.json 驱动。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
## KnighthoodTitle：Domain Logic Component
class_name KnighthoodTitle extends RefCounted

enum TitleRank {
	COMMONER, # 平民
	KNIGHT,   # 骑士
	BARON,    # 男爵 (领有城镇)
	COUNT,    # 伯爵 (领有多镇)
	DUKE,     # 公爵 (封疆大吏)
	MONARCH   # 国王/皇帝
}
