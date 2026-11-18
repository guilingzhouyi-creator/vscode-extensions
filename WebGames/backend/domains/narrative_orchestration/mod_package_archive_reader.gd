# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/mod_package_archive_reader.gd
# 架构定位: Domain Component / Binary .kmod Archive Loader & Hasher
# 依赖与触发: 上游: ModPackageDiscoverySolver, Tier3ContentRecordParser, WorldModArchiveOpsHelper | 下游: BinaryConfigReader, ErrorReporter, TemplateFormatter
# 职责说明: 读取并解析 .kmod 二进制归档包（manifest.kdat + mod_data.kdat + 流式媒体），拒绝明文 .json 注入；
#           提供目录源数据归一化、确定性 SHA-256 摘要计算与递归 i18n 键展平工具。
# 退出语义与设计依据: 业务领域第一性原理与纯二进制 .kmod/.kdat 沙盒隔离读取契约
# ==============================================================================

## ModPackageArchiveReader：.kmod 二进制归档包解析、SHA-256 摘要计算与 i18n 展平器
class_name ModPackageArchiveReader
extends RefCounted

const LOG_CHANNEL: String = "mod_narrative"
const KMOD_MANIFEST_FILENAME: String = "manifest.kdat"
const KMOD_DATA_FILENAME: String = "mod_data.kdat"


## 递归展平 i18n 嵌套字典为点分键与斜杠键
static func flatten_i18n_dict(source_dictionary: Dictionary, prefix: String, target: Dictionary) -> void:
    for entry_key in source_dictionary.keys():
        var full_key := (prefix + "." + str(entry_key)) if not prefix.is_empty() else str(entry_key)
        var raw_entry: Variant = source_dictionary[entry_key]
        if raw_entry is Dictionary:
            flatten_i18n_dict(raw_entry as Dictionary, full_key, target)
        else:
            var flattened_text := str(raw_entry)
            target[full_key] = flattened_text
            target[full_key.replace(".", "/")] = flattened_text
            target[full_key.replace("/", ".")] = flattened_text


## 将语言文件名主干标准化为引擎语言标签（如 zh-CN -> zh_CN）
static func normalize_locale_code(raw_locale: String) -> String:
    var clean := raw_locale.strip_edges().replace("-", "_")
    if clean.is_empty():
        return "zh_CN"
    return clean


## 将单个语言字典按 locale 分桶合并至 custom_i18n_by_locale 与兼容扁平 custom_i18n
static func merge_i18n_payload_for_locale(
    locale_data: Dictionary,
    raw_locale_stem: String,
    custom_i18n: Dictionary,
    i18n_by_locale: Dictionary,
    preferred_locale: String = "zh_CN"
) -> void:
    if locale_data.is_empty():
        return
    var locale_code := normalize_locale_code(raw_locale_stem)
    if not i18n_by_locale.has(locale_code):
        i18n_by_locale[locale_code] = {}
    var bucket: Dictionary = i18n_by_locale[locale_code]
    flatten_i18n_dict(locale_data, "", bucket)
    var should_overwrite_flat := custom_i18n.is_empty() or locale_code == normalize_locale_code(preferred_locale)
    if should_overwrite_flat:
        flatten_i18n_dict(locale_data, "", custom_i18n)
    else:
        for flat_key in bucket.keys():
            if not custom_i18n.has(flat_key):
                custom_i18n[flat_key] = bucket[flat_key]


static func _merge_routing_payload(routing_data: Dictionary, package_payload: Dictionary) -> void:
    if routing_data.get("prologue_routing_rules") is Array:
        var existing_prologue: Array = package_payload.get("prologue_routing_rules", [])
        existing_prologue.append_array(routing_data["prologue_routing_rules"] as Array)
        package_payload["prologue_routing_rules"] = existing_prologue


## 将源目录中的单个结构化配置条目归一化并合入 mod_data 目标载荷字典（供编译打包复用）
static func merge_source_entry(entry_path: String, entry_data: Dictionary, package_payload: Dictionary) -> void:
    var normalized_path := entry_path.replace("\\", "/")
    if normalized_path.begins_with("dag_graphs/") and normalized_path.ends_with(".json"):
        var dag_graphs: Dictionary = package_payload.get("dag_graphs", {}) as Dictionary
        var stem := normalized_path.get_file().get_basename()
        var dag_id := str(entry_data.get("dag_id", stem))
        dag_graphs[dag_id] = entry_data.duplicate(true)
        package_payload["dag_graphs"] = dag_graphs
    elif normalized_path.begins_with("i18n/") and normalized_path.ends_with(".json"):
        var custom_i18n: Dictionary = package_payload.get("custom_i18n", {}) as Dictionary
        var i18n_by_locale: Dictionary = package_payload.get("custom_i18n_by_locale", {}) as Dictionary
        var locale_stem := normalized_path.get_file().get_basename()
        merge_i18n_payload_for_locale(entry_data, locale_stem, custom_i18n, i18n_by_locale)
        package_payload["custom_i18n"] = custom_i18n
        package_payload["custom_i18n_by_locale"] = i18n_by_locale
    elif normalized_path == "destinies.json":
        for config_key in [
            "ui_capabilities", "custom_races", "creation_rule_overrides",
            "custom_origins", "custom_traits", "paired_presets",
            "custom_starter_kits", "custom_routing_rules", "prologue_routing_rules"
        ]:
            if entry_data.has(config_key):
                package_payload[config_key] = entry_data[config_key]
    elif normalized_path == "routing_rules.json":
        _merge_routing_payload(entry_data, package_payload)
    elif normalized_path == "assets/manifest.json":
        package_payload["assets_manifest"] = entry_data.duplicate(true)
    elif normalized_path.begins_with("cutscenes/") and normalized_path.ends_with(".json"):
        _merge_kmod_cutscene_entry(normalized_path, entry_data, package_payload)
    elif (normalized_path.begins_with("content/") and normalized_path.ends_with(".json")) or normalized_path in ["items.json", "skills.json", "game_rules.json", "world.json", "races_catalog.json"]:
        _append_kmod_content_record(normalized_path, entry_data, package_payload)


static func _register_kmod_cutscene_item(array_map: Dictionary, cutscene_item: Variant) -> void:
    if not (cutscene_item is Dictionary):
        return
    var cutscene_id := String((cutscene_item as Dictionary).get("cutscene_id", "")).strip_edges()
    if not cutscene_id.is_empty():
        array_map[cutscene_id] = (cutscene_item as Dictionary).duplicate(true)


static func _merge_kmod_cutscene_entry(
    entry_path: String,
    cutscene_data: Dictionary,
    package_payload: Dictionary
) -> void:
    if cutscene_data.get("cutscenes") is Dictionary:
        var existing_cs: Dictionary = package_payload.get("cutscene_registry", {})
        existing_cs.merge((cutscene_data["cutscenes"] as Dictionary).duplicate(true), true)
        package_payload["cutscene_registry"] = existing_cs
    elif cutscene_data.get("cutscenes") is Array:
        var array_map: Dictionary = package_payload.get("cutscene_registry", {})
        for cutscene_item in (cutscene_data["cutscenes"] as Array):
            _register_kmod_cutscene_item(array_map, cutscene_item)
        package_payload["cutscene_registry"] = array_map
    if cutscene_data.get("hooks") is Array:
        var existing_hooks: Array = package_payload.get("cutscene_hooks", [])
        existing_hooks.append_array((cutscene_data["hooks"] as Array).duplicate(true))
        package_payload["cutscene_hooks"] = existing_hooks
    var records: Array = package_payload.get("content_records", [])
    records.append({
        "category": "cutscenes",
        "domain": "cutscenes",
        "relative_path": entry_path,
        "payload": cutscene_data.duplicate(true)
    })
    package_payload["content_records"] = records


static func _append_kmod_content_record(
    entry_path: String,
    content_data: Dictionary,
    package_payload: Dictionary
) -> void:
    var domain := Tier3ContentRecordParser.classify_relative_content_path(entry_path)
    if domain.is_empty():
        return
    var records: Array = package_payload.get("content_records", [])
    records.append({
        "category": domain,
        "domain": domain,
        "relative_path": entry_path,
        "payload": content_data.duplicate(true)
    })
    package_payload["content_records"] = records


static func _has_forbidden_json_entry(reader: ZIPReader, kmod_path: String) -> bool:
    for entry_name in reader.get_files():
        if String(entry_name).to_lower().ends_with(".json"):
            ErrorReporter.emit_error(
                LOG_CHANNEL,
                "CONFIG_VALIDATION_FAILED",
                TemplateFormatter.format(".kmod archive contains forbidden plaintext JSON entry '{entry}': {path}", {"entry": entry_name, "path": kmod_path}),
                {"file_path": kmod_path, "entry": entry_name}
            )
            return true
    return false


## 从 .kmod 归档安全读取并解码指定 .kdat 二进制段为 Dictionary（发现明文 JSON 即 fail-closed）
static func read_kmod_kdat_dict(kmod_path: String, entry_name: String) -> Dictionary:
    var reader := ZIPReader.new()
    if reader.open(kmod_path) != OK:
        ErrorReporter.emit_error(LOG_CHANNEL, "CONFIG_FILE_READ_FAIL", TemplateFormatter.format("Failed to open .kmod archive package: {path}", {"path": kmod_path}), {"file_path": kmod_path})
        return {}
    if _has_forbidden_json_entry(reader, kmod_path):
        reader.close()
        return {}
    if not reader.file_exists(entry_name):
        reader.close()
        ErrorReporter.emit_error(LOG_CHANNEL, "CONFIG_FILE_NOT_FOUND", TemplateFormatter.format(".kmod archive missing binary entry '{entry}': {path}", {"entry": entry_name, "path": kmod_path}), {"file_path": kmod_path, "entry": entry_name})
        return {}
    var raw_bytes := reader.read_file(entry_name)
    reader.close()
    var decoded: Variant = BinaryConfigReader.load_kdat_buffer(raw_bytes)
    if not (decoded is Dictionary):
        ErrorReporter.emit_error(LOG_CHANNEL, "CONFIG_ROOT_NOT_DICT", TemplateFormatter.format(".kmod binary section '{entry}' decode failed: {path}", {"entry": entry_name, "path": kmod_path}), {"file_path": kmod_path, "entry": entry_name})
        return {}
    return decoded as Dictionary


## 从 .kmod 二进制归档包完整读取并组装 MOD 数据字典（manifest.kdat + mod_data.kdat）
static func load_full_package_from_kmod(kmod_path: String) -> Dictionary:
    var reader := ZIPReader.new()
    if reader.open(kmod_path) != OK:
        ErrorReporter.emit_error(
            LOG_CHANNEL,
            "CONFIG_FILE_READ_FAIL",
            TemplateFormatter.format("Failed to open .kmod archive package: {path}", {"path": kmod_path}),
            {"file_path": kmod_path}
        )
        return {}
    if _has_forbidden_json_entry(reader, kmod_path):
        reader.close()
        return {}
    if not reader.file_exists(KMOD_MANIFEST_FILENAME) or not reader.file_exists(KMOD_DATA_FILENAME):
        reader.close()
        ErrorReporter.emit_error(
            LOG_CHANNEL,
            "CONFIG_FILE_NOT_FOUND",
            TemplateFormatter.format(".kmod archive missing manifest.kdat or mod_data.kdat: {path}", {"path": kmod_path}),
            {"file_path": kmod_path}
        )
        return {}
    var manifest_bytes := reader.read_file(KMOD_MANIFEST_FILENAME)
    var mod_data_bytes := reader.read_file(KMOD_DATA_FILENAME)
    reader.close()

    var manifest_variant: Variant = BinaryConfigReader.load_kdat_buffer(manifest_bytes)
    var mod_data_variant: Variant = BinaryConfigReader.load_kdat_buffer(mod_data_bytes)
    if not (manifest_variant is Dictionary) or not (mod_data_variant is Dictionary):
        ErrorReporter.emit_error(
            LOG_CHANNEL,
            "CONFIG_VALIDATION_FAILED",
            TemplateFormatter.format(".kmod .kdat payload decode failed: {path}", {"path": kmod_path}),
            {"file_path": kmod_path}
        )
        return {}

    var package_payload: Dictionary = (manifest_variant as Dictionary).duplicate(true)
    var decoded_mod_data := mod_data_variant as Dictionary
    for section_key in decoded_mod_data.keys():
        if section_key == "pack_metadata":
            continue
        package_payload[section_key] = decoded_mod_data[section_key]
    if not package_payload.has("dag_graphs"):
        package_payload["dag_graphs"] = {}
    if not package_payload.has("custom_i18n"):
        package_payload["custom_i18n"] = {}
    if not package_payload.has("custom_i18n_by_locale"):
        package_payload["custom_i18n_by_locale"] = {}
    package_payload["root_path"] = kmod_path
    return package_payload


## 计算 .kmod 归档包内容确定性 SHA-256 摘要（跳过 manifest.kdat 避免自引用环）
static func compute_kmod_sha256(kmod_path: String, sha_hasher: HashingContext) -> String:
    var reader := ZIPReader.new()
    if reader.open(kmod_path) != OK:
        return ""
    var archive_paths: Array[String] = []
    for raw_entry in reader.get_files():
        var archive_entry := String(raw_entry)
        if archive_entry == KMOD_MANIFEST_FILENAME or archive_entry.ends_with("/") or archive_entry.ends_with(".uid") or archive_entry.ends_with(".import"):
            continue
        archive_paths.append(archive_entry)
    archive_paths.sort()
    for relative_file in archive_paths:
        sha_hasher.update(relative_file.to_utf8_buffer())
        sha_hasher.update(reader.read_file(relative_file))
    reader.close()
    return sha_hasher.finish().hex_encode()
