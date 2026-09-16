# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/version_governance/gray_policy_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/version_governance.json | 信号: EventBus 领域广播
# 职责说明: 承载服务端下发或配置表定义的灰度分群拓扑，支持用户 ID、渠道、地域、发布环等多维正交判定
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name GrayPolicyDTO
extends RefCounted

var policy_id: String = ""                    # 策略唯一 ID (如 "POL_20260908_V180_BETA")
var target_version: String = "1.8.0"          # 目标升级版本
var target_version_code: int = 10800          # 目标版本整型码
var rollout_percentage: int = 0               # 灰度放量百分比 [0, 100]
var allowed_rings: Array[int] = []            # 允许的发布环 (ReleaseRing)
var target_channels: Array[String] = []       # 允许的渠道 (如 ["official", "steam", "test"])
var target_regions: Array[String] = []        # 允许的地域标识 (如 ["CN_EAST", "GLOBAL"])
var target_device_tiers: Array[String] = []   # 允许的设备等级 (如 ["LOW", "MID", "HIGH"])
var explicit_user_whitelist: Array[String] = [] # 强行白名单用户 ID (100% 命中)
var explicit_user_blacklist: Array[String] = [] # 强行黑名单用户 ID (100% 拒绝)
var is_active: bool = true                    # 策略启用状态 (支持秒级关闭)
var rollback_version: String = ""             # 熔断时的应急回退基线版本

## 检查是否命中强制白名单
func is_explicitly_whitelisted(user_id: String) -> bool:
	return explicit_user_whitelist.has(user_id)

## 检查是否命中强制黑名单
func is_explicitly_blacklisted(user_id: String) -> bool:
	return explicit_user_blacklist.has(user_id)
