# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/version_governance/version_manifest_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/version_governance.json | 信号: EventBus 领域广播
# 职责说明: 统一版本元数据模型，涵盖版本号、版本码、兼容性、补丁类型与 SHA-256 签名
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name VersionManifestDTO
extends RefCounted

## 补丁发布类型枚举
enum PatchType {
	FULL_RELEASE = 0,       # 完整全量版本 (Base Pack)
	INCREMENTAL_PCK = 1,    # 增量 PCK 补丁包 (动态叠加挂载)
	CONFIG_HOTFIX = 2,      # 纯配置/数值热修复 (GameConfig 增量 diff 刷新)
	EMERGENCY_ROLLBACK = 3  # 紧急回滚指令包 (强制版本重置)
}

## 发布环级枚举 (Release Ring)
enum ReleaseRing {
	INTERNAL = 0, # 开发/内测专享
	ALPHA = 1,    # 先锋体验
	BETA = 2,     # 灰度公测
	STABLE = 3    # 全量稳定
}

var version_string: String = "1.0.0"          # 语义化版本号 (SemVer: Major.Minor.Patch)
var version_code: int = 10000                 # 递增整型版本码 (用于快速比对: 1.8.2 -> 10802)
var min_supported_version: String = "1.0.0"   # 最低强制兼容版本 (低于该版本触发强更阻断)
var patch_type: int = PatchType.FULL_RELEASE  # 补丁类型
var release_ring: int = ReleaseRing.STABLE    # 目标所属发布环
var payload_sha256: String = ""               # 补丁包文件 SHA-256 签名 (64位十六进制哈希)
var payload_size_bytes: int = 0               # 补丁包字节大小
var download_url: String = ""                 # 数据面资源获取 URI (HTTP/CDN 或 本地相对路径)
var pck_mount_priority: int = 100             # PCK 挂载叠加优先级 (越大越后挂载，覆盖底层)
var changelog_loc_key: String = ""            # 国际化更新公告词条键
var published_at_unix: int = 0                # 发布时间戳 (UTC 秒)

## 验证清单自身完整性
func is_valid() -> bool:
	return not version_string.is_empty() and version_code > 0 and (
		patch_type == PatchType.CONFIG_HOTFIX or not payload_sha256.is_empty()
	)
