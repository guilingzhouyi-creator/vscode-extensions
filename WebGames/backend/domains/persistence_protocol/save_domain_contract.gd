# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/save_domain_contract.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: infrastructure.persistence.json | 信号: EventBus 领域广播
# 职责说明: 封装单数据域持久化配置元数据、序列化/反序列化契约与运行时反射分发。 由 config/infrastructure/domains.json 的 save 段驱动（Inv-SV-1/2/11）。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name SaveDomainContract extends RefCounted

var domain_id: String = ""
var enabled: bool = false
var domain_version: int = 1
var serializer_class_name: String = ""
var strategy: String = "full" # "full" 全量保存 | "dirty" 脏标记增量保存
var hot_reload_allow: bool = false
var requires_rebuild: bool = false

var _provider_instance: Variant = null
var _consumer_callable: Variant = null

## 从 domains.json 的 save 配置段构建契约对象
static func from_config(p_domain_id: String, cfg: Dictionary) -> RefCounted:
	var contract := SaveDomainContract.new()
	contract.domain_id = p_domain_id
	contract.enabled = bool(cfg.get("enabled", false))
	contract.domain_version = int(cfg.get("domain_version", 1))
	contract.serializer_class_name = String(cfg.get("serializer", ""))
	contract.strategy = String(cfg.get("strategy", "full"))
	var hr_cfg: Dictionary = cfg.get("hot_reload", {})
	contract.hot_reload_allow = bool(hr_cfg.get("allow", false))
	contract.requires_rebuild = bool(hr_cfg.get("requires_rebuild", false))
	return contract

## 注册运行时数据提供者（实现 serialize() -> Dictionary 的聚合对象或字典）
func register_provider(instance: Variant) -> void:
	_provider_instance = instance

## 注销数据提供者
func unregister_provider() -> void:
	_provider_instance = null

## 判定是否已注册有效提供者
func is_provider_registered() -> bool:
	return _provider_instance != null

## 获取已注册的数据提供者聚合对象
func get_provider_aggregate() -> Variant:
	return _provider_instance

## 注册反序列化接收者（Callable）
func register_consumer(consumer: Callable) -> void:
	_consumer_callable = consumer

## 注销反序列化接收者
func unregister_consumer() -> void:
	_consumer_callable = null

## 判定是否已注册有效接收者
func is_consumer_registered() -> bool:
	return _consumer_callable is Callable

## 获取已注册的反序列化 Callable
func get_consumer_callable() -> Variant:
	return _consumer_callable

## 调度提供者执行序列化，确保输出纯值类型字典（Inv-SV-5）
func serialize_provider() -> Dictionary:
	if _provider_instance == null:
		return {}
	if _provider_instance is Dictionary:
		return (_provider_instance as Dictionary).duplicate(true)
	if _provider_instance.has_method("serialize"):
		var res: Variant = _provider_instance.serialize()
		if res is Dictionary:
			return res as Dictionary
	return {}
