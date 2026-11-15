# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/narrative_orchestration/mod_package_archive_reader.gd
# 架构定位: Domain Component / Binary .kmod Archive Loader & Hasher
# 依赖与触发: 上游: ModPackageDiscoverySolver | 下游: ErrorReporter, TemplateFormatter | 配置: config/domains/narrative_orchestration/core.json | 信号: 无
# 职责说明: 读取并解析 .kmod ZIP 归档包内的清单、DAG 图元、i18n 多语言键与 destinies/routing 配置，
#           计算确定性 SHA-256 内容摘要，并提供递归 i18n 键展平工具。
# 退出语义与设计依据: 业务领域第一性原理与二进制沙盒隔离读取契约
# ==============================================================================

## ModPackageArchiveReader：.kmod 归档包解析、SHA-256 摘要计算与 i18n 展平器
class_name ModPackageArchiveReader
extends RefCounted

const LOG_CHANNEL: String = "mod_narrative"
const MANIFEST_FILENAME: String = "pack.json"
const ALT_MANIFEST_FILENAME: String = "manifest.json"


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


static func _read_kmod_json_dict(reader: ZIPReader, entry_path: String) -> Dictionary:
    var raw: Variant = JSON.parse_string(reader.read_file(entry_path).get_string_from_utf8())
    return (raw as Dictionary) if (raw is Dictionary) else {}


## 将语言文件名主干标准化为引擎语言标签（如 zh-CN -> zh_CN）
static func normalize_locale_code(raw_locale: String) -> String:
    var clean := raw_locale.strip_edges().replace("-", "_")
    if clean.is_empty():
        return "zh_CN"
    return clean


## 将单个语言 JSON 字典按 locale 分桶合并至 custom_i18n_by_locale 与兼容扁平 custom_i18n
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
    var raw_rules: Variant = routing_data.get("custom_routing_rules", routing_data.get("routing_rules", []))
    if raw_rules is Array:
        var existing_custom: Array = package_payload.get("custom_routing_rules", [])
        existing_custom.append_array(raw_rules as Array)
        package_payload["custom_routing_rules"] = existing_custom


static func _apply_kmod_entry(
    reader: ZIPReader,
    entry_path: String,
    package_payload: Dictionary,
    dag_graphs: Dictionary,
    custom_i18n: Dictionary,
    i18n_by_locale: Dictionary
) -> void:
    if entry_path.begins_with("dag_graphs/") and entry_path.ends_with(".json"):
        var graph_data := _read_kmod_json_dict(reader, entry_path)
        if graph_data.is_empty():
            return
        var stem := entry_path.get_file().get_basename()
        var dag_id := str(graph_data.get("dag_id", graph_data.get("graph_id", stem)))
        dag_graphs[dag_id] = graph_data
    elif entry_path.begins_with("i18n/") and entry_path.ends_with(".json"):
        var locale_data := _read_kmod_json_dict(reader, entry_path)
        var locale_stem := entry_path.get_file().get_basename()
        merge_i18n_payload_for_locale(locale_data, locale_stem, custom_i18n, i18n_by_locale)
    elif entry_path == "destinies.json":
        var destinies_data := _read_kmod_json_dict(reader, entry_path)
        for config_key in [
            "ui_capabilities", "custom_races", "creation_rule_overrides",
            "custom_origins", "custom_traits", "paired_presets",
            "custom_starter_kits", "custom_routing_rules", "prologue_routing_rules"
        ]:
            if destinies_data.has(config_key):
                package_payload[config_key] = destinies_data[config_key]
    elif entry_path == "routing_rules.json":
        var routing_data := _read_kmod_json_dict(reader, entry_path)
        _merge_routing_payload(routing_data, package_payload)


## 从 .kmod 归档包完整读取并组装 MOD 数据字典
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
    var files := reader.get_files()
    var manifest_payload: Dictionary = {}
    if reader.file_exists(MANIFEST_FILENAME):
        manifest_payload = _read_kmod_json_dict(reader, MANIFEST_FILENAME)
    elif reader.file_exists(ALT_MANIFEST_FILENAME):
        manifest_payload = _read_kmod_json_dict(reader, ALT_MANIFEST_FILENAME)
    if manifest_payload.is_empty():
        reader.close()
        return {}
    var package_payload: Dictionary = manifest_payload.duplicate(true)
    var dag_graphs: Dictionary = package_payload.get("dag_graphs", {})
    var custom_i18n: Dictionary = package_payload.get("custom_i18n", {})
    var i18n_by_locale: Dictionary = package_payload.get("custom_i18n_by_locale", {})
    for entry_path in files:
        _apply_kmod_entry(reader, entry_path, package_payload, dag_graphs, custom_i18n, i18n_by_locale)
    reader.close()
    package_payload["dag_graphs"] = dag_graphs
    package_payload["custom_i18n"] = custom_i18n
    package_payload["custom_i18n_by_locale"] = i18n_by_locale
    package_payload["root_path"] = kmod_path
    return package_payload


## 计算 .kmod 归档包内容确定性 SHA-256 摘要（跳过根清单与编辑器伴生文件避免自引用环）
static func compute_kmod_sha256(kmod_path: String, sha_hasher: HashingContext) -> String:
    var reader := ZIPReader.new()
    if reader.open(kmod_path) != OK:
        return ""
    var archive_paths: Array[String] = []
    for raw_entry in reader.get_files():
        var archive_entry := String(raw_entry)
        if archive_entry == MANIFEST_FILENAME or archive_entry == ALT_MANIFEST_FILENAME or archive_entry.ends_with("/") or archive_entry.ends_with(".uid") or archive_entry.ends_with(".import"):
            continue
        archive_paths.append(archive_entry)
    archive_paths.sort()
    for relative_file in archive_paths:
        sha_hasher.update(relative_file.to_utf8_buffer())
        sha_hasher.update(reader.read_file(relative_file))
    reader.close()
    return sha_hasher.finish().hex_encode()
