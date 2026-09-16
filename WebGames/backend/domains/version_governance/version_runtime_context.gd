# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/version_governance/version_runtime_context.gd
# 架构定位: Value Object DTO / Data Transport Model
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/version_governance.json | 信号: EventBus 领域广播
# 职责说明: 封装指定游戏版本所持有的全部运行时依赖，实现多版本内存沙盒物理隔离
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name VersionedRuntimeContext
extends RefCounted

const ActivationTokenDTO = preload("res://backend/domains/version_governance/activation_token_dto.gd")

var version_string: String = "1.0.0"
var version_code: int = 10000
var activation_token: ActivationTokenDTO = null

# 本版本独立的依赖容器
var catalog: ItemRegistryCatalog = null
var magic_registry: MagicTierRegistry = null
var magic_rules: MagicRuleRegistry = null
var quality_registry: QualityTierRegistry = null
var config_snapshot: Dictionary = {}

var is_active: bool = false

func _init(v_str: String = "1.0.0", v_code: int = 10000, token: ActivationTokenDTO = null) -> void:
	version_string = v_str
	version_code = v_code
	activation_token = token

## 装配当前版本独立的内部依赖环境
func assemble_context() -> bool:
	if is_active:
		return true
	# 构建本版本对应的物品目录与注册表
	catalog = ItemLoaderPipeline.build_catalog_from_config()
	magic_registry = MagicTierRegistry.new()
	magic_registry.reload_configuration()
	magic_rules = MagicRuleRegistry.new()
	magic_rules.reload_configuration()
	quality_registry = QualityTierRegistry.new()
	quality_registry.reload_configuration()
	is_active = true
	return true

## 安全释放上下文
func dispose() -> void:
	catalog = null
	magic_registry = null
	magic_rules = null
	quality_registry = null
	is_active = false
