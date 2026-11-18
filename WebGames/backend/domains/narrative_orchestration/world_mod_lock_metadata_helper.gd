# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/world_mod_lock_metadata_helper.gd
# 架构定位: Domain Helper / World MOD Lock Metadata Resolver
# 依赖与触发: 上游: WorldCharacterCreationOrchestrator, WorldModAffinityManager | 下游: ModPackageDiscoverySolver | 配置: config/domains/narrative_orchestration/core.json | 信号: 无直接广播
# 职责说明: 为单机世界 MOD 锁条目补全权威版本号、内容 SHA-256 摘要、优先级与官方归属元数据
# 退出语义与设计依据: 单一事实源解析锁条目，杜绝空摘要落盘并保持离线锁契约可审计
# ==============================================================================

## WorldModLockMetadataHelper：Domain Helper / World MOD Lock Metadata Resolver
class_name WorldModLockMetadataHelper
extends RefCounted


## 将字符串 ID、半残字典或清单 DTO 统一解析为含真实版本与 SHA-256 的世界锁字典数组
static func resolve_lock_pack_entries(
    raw_packs: Array,
    manifest_fallback: Dictionary = {},
    custom_roots: Array = []
) -> Array[Dictionary]:
    var resolved_entries: Array[Dictionary] = []
    if raw_packs.is_empty():
        return resolved_entries

    var installed_index := _index_installed_packs(custom_roots)
    var fallback_index := _index_manifest_fallback_packs(manifest_fallback)
    var pack_profiles: Dictionary = manifest_fallback.get("pack_profiles", {}) if manifest_fallback.get("pack_profiles") is Dictionary else {}
    var official_base_id := String(manifest_fallback.get("official_base_pack_id", "")).strip_edges()
    var seen_pack_ids: Dictionary = {}

    for pack_entry in raw_packs:
        var enriched_record := _resolve_single_lock_entry(
            pack_entry,
            installed_index,
            fallback_index,
            pack_profiles,
            official_base_id
        )
        var resolved_pack_id := String(enriched_record.get("pack_id", "")).strip_edges()
        if resolved_pack_id.is_empty() or seen_pack_ids.has(resolved_pack_id):
            continue
        seen_pack_ids[resolved_pack_id] = true
        resolved_entries.append(enriched_record)

    return resolved_entries


## 规范化单条 MOD 锁记录字典（保留已显式指定的版本与非空摘要）
static func serialize_pack_record(pack_entry: Variant) -> Dictionary:
    if pack_entry is Dictionary:
        var source_table := pack_entry as Dictionary
        return {
            "pack_id": String(source_table.get("pack_id", "")).strip_edges(),
            "version": String(source_table.get("version", "1.0.0")).strip_edges(),
            "content_sha256": String(source_table.get("content_sha256", "")).strip_edges().to_lower(),
            "priority": int(source_table.get("priority", 100)),
            "pack_profile": String(source_table.get("pack_profile", "")).strip_edges(),
            "is_official": bool(source_table.get("is_official", false)),
            "root_path": String(source_table.get("root_path", "")).strip_edges()
        }
    if pack_entry is String:
        return {
            "pack_id": String(pack_entry).strip_edges(),
            "version": "",
            "content_sha256": "",
            "priority": 100,
            "pack_profile": "",
            "is_official": false,
            "root_path": ""
        }
    if pack_entry != null and pack_entry.has_method("to_dto"):
        var converted_payload: Variant = pack_entry.to_dto()
        if converted_payload is Dictionary:
            return serialize_pack_record(converted_payload)
    if pack_entry != null and "pack_id" in pack_entry:
        return {
            "pack_id": String(pack_entry.pack_id).strip_edges(),
            "version": String(pack_entry.version).strip_edges() if "version" in pack_entry else "1.0.0",
            "content_sha256": String(pack_entry.content_sha256).strip_edges().to_lower() if "content_sha256" in pack_entry else "",
            "priority": int(pack_entry.priority) if "priority" in pack_entry else 100,
            "pack_profile": String(pack_entry.pack_profile).strip_edges() if "pack_profile" in pack_entry else "",
            "is_official": bool(pack_entry.is_official) if "is_official" in pack_entry else false,
            "root_path": String(pack_entry.root_path).strip_edges() if "root_path" in pack_entry else ""
        }
    return {}


static func _index_installed_packs(custom_roots: Array) -> Dictionary:
    var installed_index: Dictionary = {}
    var scanned_manifests := ModPackageDiscoverySolver.scan_installed_packs(custom_roots)
    for manifest_entry in scanned_manifests:
        var normalized := serialize_pack_record(manifest_entry)
        var pack_id := String(normalized.get("pack_id", "")).strip_edges()
        if not pack_id.is_empty():
            installed_index[pack_id] = normalized
    return installed_index


static func _index_manifest_fallback_packs(manifest_fallback: Dictionary) -> Dictionary:
    var fallback_index: Dictionary = {}
    var applied_packs: Variant = manifest_fallback.get("applied_packs", [])
    if not (applied_packs is Array):
        return fallback_index
    for applied_entry in applied_packs as Array:
        var normalized := serialize_pack_record(applied_entry)
        var pack_id := String(normalized.get("pack_id", "")).strip_edges()
        if not pack_id.is_empty():
            fallback_index[pack_id] = normalized
    return fallback_index


static func _resolve_single_lock_entry(
    pack_entry: Variant,
    installed_index: Dictionary,
    fallback_index: Dictionary,
    pack_profiles: Dictionary,
    official_base_id: String
) -> Dictionary:
    var base_record := serialize_pack_record(pack_entry)
    var pack_id := String(base_record.get("pack_id", "")).strip_edges()
    if pack_id.is_empty():
        return {}

    var has_explicit_version := _has_explicit_field(pack_entry, "version")
    var has_explicit_priority := _has_explicit_field(pack_entry, "priority")
    var has_explicit_official := _has_explicit_field(pack_entry, "is_official")
    var installed_record: Dictionary = installed_index.get(pack_id, {})
    var fallback_record: Dictionary = fallback_index.get(pack_id, {})

    var resolved_version := String(base_record.get("version", "")).strip_edges() if has_explicit_version else ""
    if resolved_version.is_empty():
        resolved_version = _first_non_empty([
            String(installed_record.get("version", "")),
            String(fallback_record.get("version", "")),
            String(base_record.get("version", "")),
            "1.0.0"
        ])

    var resolved_root := _first_non_empty([
        String(base_record.get("root_path", "")),
        String(installed_record.get("root_path", "")),
        String(fallback_record.get("root_path", ""))
    ])
    var resolved_digest := _first_non_empty([
        String(base_record.get("content_sha256", "")),
        String(installed_record.get("content_sha256", "")),
        String(fallback_record.get("content_sha256", ""))
    ]).to_lower()
    if resolved_digest.is_empty() and not resolved_root.is_empty():
        resolved_digest = ModPackageDiscoverySolver.compute_package_content_sha256(resolved_root).strip_edges().to_lower()

    var resolved_profile := _first_non_empty([
        String(base_record.get("pack_profile", "")),
        String(installed_record.get("pack_profile", "")),
        String(fallback_record.get("pack_profile", "")),
        String(pack_profiles.get(pack_id, ""))
    ])

    var resolved_priority := int(base_record.get("priority", 100))
    if not has_explicit_priority:
        if installed_record.has("priority"):
            resolved_priority = int(installed_record.get("priority", 100))
        elif fallback_record.has("priority"):
            resolved_priority = int(fallback_record.get("priority", 100))

    var resolved_official := bool(base_record.get("is_official", false)) if has_explicit_official else false
    if not resolved_official:
        resolved_official = bool(installed_record.get("is_official", false)) or bool(fallback_record.get("is_official", false))
    if not resolved_official and ((not official_base_id.is_empty() and pack_id == official_base_id) or resolved_profile == "OFFICIAL_BASE"):
        resolved_official = true

    return {
        "pack_id": pack_id,
        "version": resolved_version,
        "content_sha256": resolved_digest,
        "priority": resolved_priority,
        "pack_profile": resolved_profile,
        "is_official": resolved_official
    }


static func _has_explicit_field(pack_entry: Variant, field_name: String) -> bool:
    if pack_entry is Dictionary:
        var source_table := pack_entry as Dictionary
        if not source_table.has(field_name):
            return false
        var raw_field: Variant = source_table.get(field_name)
        if raw_field is String:
            return not String(raw_field).strip_edges().is_empty()
        return true
    if pack_entry is Object and field_name in pack_entry:
        var object_field: Variant = (pack_entry as Object).get(field_name)
        if object_field is String:
            return not String(object_field).strip_edges().is_empty()
        return true
    return false


static func _first_non_empty(candidates: Array) -> String:
    for candidate_entry in candidates:
        var trimmed_text := String(candidate_entry).strip_edges()
        if not trimmed_text.is_empty():
            return trimmed_text
    return ""
