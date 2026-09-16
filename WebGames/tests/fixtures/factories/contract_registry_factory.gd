# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 契约注册表测试数据工厂
# 文件路径: res://tests/fixtures/factories/contract_registry_factory.gd
# 职责: 构造合法契约实例与 5 类损坏契约场景，支撑注入式单测与门禁阻断验证
# ==============================================================================
class_name ContractRegistryFactory
extends RefCounted

const EntryClass = preload("res://backend/domains/contract_registry/contract_registry_entry.gd")


## 构造合法 DTO 契约
static func create_valid_dto_entry(id: String = "CT-TEST-DTO-01") -> Resource:
	var entry = EntryClass.new()
	entry.contract_id = id
	entry.contract_version = 1
	entry.domain_name = "character_creation"
	entry.view_name = "account_entry"
	entry.endpoint_kind = EntryClass.EndpointKind.DTO
	entry.source_path = "CharacterCreationService.character_baseline"
	entry.target_path = "account_entry_view.creation_panel.baseline_label"
	entry.field_mapping = [
		{"backend_field": "level", "view_field": "level_label.text", "transform_kind": "identity"},
		{"backend_field": "attributes.hp", "view_field": "hp_bar.max_value", "transform_kind": "cast", "transform_config": {"to": "int", "clamp_min": 1}}
	]
	entry.created_at = "2026-09-05"
	entry.last_reviewed_at = "2026-09-05"
	return entry


## 构造合法 EVENT 契约
static func create_valid_event_entry(id: String = "CT-TEST-EVT-01") -> Resource:
	var entry = EntryClass.new()
	entry.contract_id = id
	entry.contract_version = 1
	entry.domain_name = "character_creation"
	entry.view_name = "account_entry"
	entry.endpoint_kind = EntryClass.EndpointKind.EVENT
	entry.event_name = "character.creation.completed"
	entry.signal_name = "_on_character_created"
	entry.event_filter = {"actor_type": "player"}
	entry.created_at = "2026-09-05"
	entry.last_reviewed_at = "2026-09-05"
	return entry


## 构造合法 COMMAND 契约
static func create_valid_command_entry(id: String = "CT-TEST-CMD-01") -> Resource:
	var entry = EntryClass.new()
	entry.contract_id = id
	entry.contract_version = 1
	entry.domain_name = "character_creation"
	entry.view_name = "account_entry"
	entry.endpoint_kind = EntryClass.EndpointKind.COMMAND
	entry.service_path = "CharacterCreationService"
	entry.method_name = "create_character"
	entry.params_schema = [
		{"name": "character_name", "type": "string", "required": true},
		{"name": "race_id", "type": "int", "required": true}
	]
	entry.response_dto = "CharacterCreationResultDTO"
	entry.created_at = "2026-09-05"
	entry.last_reviewed_at = "2026-09-05"
	return entry


## 构造 5 类损坏配置场景
static func create_corrupted_config(corruption_kind: String) -> Dictionary:
	var base_data = {
		"$schema_version": 1,
		"infra_domains": ["world_state"],
		"entries": [
			create_valid_dto_entry("CT-VALID-01").to_dto()
		]
	}

	match corruption_kind:
		"duplicate_id":
			base_data["entries"].append(create_valid_dto_entry("CT-VALID-01").to_dto())
		"unknown_domain":
			var bad_entry = create_valid_dto_entry("CT-BAD-01").to_dto()
			bad_entry["domain_name"] = ""
			base_data["entries"].append(bad_entry)
		"version_mismatch":
			base_data["$schema_version"] = 999
		"missing_field":
			var bad_entry = create_valid_dto_entry("CT-BAD-02").to_dto()
			bad_entry.erase("view_name")
			base_data["entries"].append(bad_entry)
		"infra_violation":
			var bad_entry = create_valid_dto_entry("CT-BAD-03").to_dto()
			bad_entry["domain_name"] = "not_an_infra_domain"
			bad_entry["infra_exempt"] = true
			base_data["entries"].append(bad_entry)

	return base_data
