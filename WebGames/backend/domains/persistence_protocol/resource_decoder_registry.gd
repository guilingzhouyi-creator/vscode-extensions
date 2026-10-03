# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/resource_decoder_registry.gd
# 架构定位: Polymorphic Resource Decoder Registry Center
# 跨域依赖: 上游: AuxiliaryWorkerPool, StorageResourceCatalog | 下游: JSON, FileAccess
# 职责说明: 多态资源解码注册中心：管理针对 JSON 配置、纯文本、Godot 资源、网格与音频等
#           多类型资源在后台工作线程中的纯函数反序列化解码器，支持插件式注册与自适应分发。
# 设计依据: 双域储存架构多态解码规范
# ==============================================================================

class_name ResourceDecoderRegistry extends RefCounted

const StorageContractInterfaces = preload("res://backend/domains/persistence_protocol/storage_contract_interfaces.gd")
const ResourceIndexEntryDTO = preload("res://backend/domains/persistence_protocol/dto/resource_index_entry_dto.gd")

const EXT_JSON: String = ".json"
const CAT_CONFIG: String = "config"
const CAT_TEXT: String = "text"
const ERR_NONE: String = StorageContractInterfaces.ERR_NONE
const ERR_CORRUPT: String = StorageContractInterfaces.ERR_CORRUPT
const ERR_NO_DECODER: String = "ERR_NO_DECODER"

## 内置 JSON 资源解码器
class JSONResourceDecoder extends StorageContractInterfaces.ResourceDecoderContract:
	func can_decode(entry: RefCounted) -> bool:
		var e := entry as ResourceIndexEntryDTO
		if e == null:
			return false
		return e.category == CAT_CONFIG or e.physical_path.ends_with(EXT_JSON)

	func decode_payload(_raw_bytes: PackedByteArray, text: String, _entry: RefCounted) -> Dictionary:
		var json := JSON.new()
		if json.parse(text) != OK:
			return {"data": null, "error": ERR_CORRUPT}
		return {"data": json.get_data(), "error": ERR_NONE}

## 内置通用文本资源解码器
class TextResourceDecoder extends StorageContractInterfaces.ResourceDecoderContract:
	func can_decode(entry: RefCounted) -> bool:
		var e := entry as ResourceIndexEntryDTO
		if e == null:
			return false
		return e.category == CAT_TEXT or not e.physical_path.ends_with(EXT_JSON)

	func decode_payload(_raw_bytes: PackedByteArray, text: String, _entry: RefCounted) -> Dictionary:
		return {"data": text, "error": ERR_NONE}

static var _instance = null
var _decoders: Array = []
var _default_decoder: StorageContractInterfaces.ResourceDecoderContract = null

static func get_instance() -> RefCounted:
	if _instance == null:
		_instance = new()
	return _instance

func _init() -> void:
	_decoders = []
	_default_decoder = TextResourceDecoder.new()
	register_decoder(JSONResourceDecoder.new())
	register_decoder(_default_decoder)

## 注册自定义解码器（优先匹配前置注册的解码器）
func register_decoder(decoder: StorageContractInterfaces.ResourceDecoderContract) -> void:
	if decoder != null and not _decoders.has(decoder):
		_decoders.push_front(decoder)

## 获取适用的解码器
func get_decoder_for_entry(entry: ResourceIndexEntryDTO) -> StorageContractInterfaces.ResourceDecoderContract:
	if entry == null:
		return _default_decoder
	for d in _decoders:
		var dec := d as StorageContractInterfaces.ResourceDecoderContract
		if dec != null and dec.can_decode(entry):
			return dec
	return _default_decoder

## 直接解码载荷
func decode(raw_bytes: PackedByteArray, text: String, entry: ResourceIndexEntryDTO) -> Dictionary:
	var decoder := get_decoder_for_entry(entry)
	if decoder == null:
		return {"data": null, "error": ERR_NO_DECODER}
	return decoder.decode_payload(raw_bytes, text, entry)

## 测试重置
static func reset_for_tests() -> void:
	_instance = null
