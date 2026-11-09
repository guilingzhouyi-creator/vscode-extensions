# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 38 多语言国际化单元测试
# 文件路径: res://tests/unit/domains/test_localization_i18n.gd
# 职责说明: 验证动态插值、多层级回退、热重载管线、统一名称解析、MOD词典隔离与状态DTO
# ==============================================================================
class_name TestLocalizationI18nDomain
extends RefCounted

const LocalizationRegistryCatalog = preload("res://backend/domains/localization_i18n/localization_registry_catalog.gd")
const LocalizationSolver = preload("res://backend/domains/localization_i18n/localization_solver.gd")
const I18nHotReloadPipeline = preload("res://backend/domains/localization_i18n/i18n_hot_reload_pipeline.gd")
const LocalizationI18nService = preload("res://backend/domains/localization_i18n/localization_i18n_service.gd")
const LocalizationI18nDTO = preload("res://backend/domains/localization_i18n/dto/localization_i18n_dto.gd")

static func run_all_tests() -> Dictionary:
    var results: Array[Dictionary] = []
    var domain_name = "Domain 38: 全域多语言国际化与动态插值引擎"

    results.append(_test_dynamic_parameter_interpolation())
    results.append(_test_multi_tier_fallback_hierarchy())
    results.append(_test_hot_switch_language_locale())
    results.append(_test_name_key_resolution_and_counter())
    results.append(_test_lazy_load_batch_and_empty_params_shortcircuit())
    results.append(_test_mod_i18n_isolation_and_unload_purging())
    results.append(_test_hot_switch_and_event_bus_broadcast())
    results.append(_test_probe_cjk_and_dto_export())

    var passed_cnt := 0
    for r in results:
        if r.get("passed", false):
            passed_cnt += 1

    return {
        "domain": domain_name,
        "passed_count": passed_cnt,
        "total_count": results.size(),
        "all_passed": (passed_cnt == results.size()),
        "results": results
    }

static func _test_dynamic_parameter_interpolation() -> Dictionary:
    var catalog := LocalizationRegistryCatalog.new()
    catalog.current_locale = "zh_CN"
    catalog.register_translation("zh_CN", "combat.hit", "{attacker} 使用 {weapon} 击中了 {target}，造成 {dmg} 点物理伤害")

    var params := {
        "attacker": "亚瑟",
        "weapon": "秘银长剑",
        "target": "哥布林督军",
        "dmg": 128
    }
    var res: String = LocalizationSolver.translate(catalog, "combat.hit", params)
    var expected = "亚瑟 使用 秘银长剑 击中了 哥布林督军，造成 128 点物理伤害"

    var passed: bool = (res == expected)
    return {
        "test": "TC-I18N-01: 动态参数占位符精准字符串插值与格式化",
        "passed": passed
    }

static func _test_multi_tier_fallback_hierarchy() -> Dictionary:
    var catalog := LocalizationRegistryCatalog.new()
    catalog.current_locale = "ja_JP"
    catalog.fallback_locale = "en_US"

    # ja_JP 缺词条，但在 en_US 存在
    catalog.register_translation("en_US", "item.potion.name", "Health Potion")
    var res_fallback: String = LocalizationSolver.translate(catalog, "item.potion.name")

    # 两个语言都缺失 -> 最终兜底返回原始 key
    var res_missing: String = LocalizationSolver.translate(catalog, "item.unknown_key.name")

    var passed: bool = (res_fallback == "Health Potion") and (res_missing == "[item.unknown_key.name]")
    return {
        "test": "TC-I18N-02: 多层级语言包回退与缺失词条安全兜底",
        "passed": passed
    }

static func _test_hot_switch_language_locale() -> Dictionary:
    var catalog := LocalizationRegistryCatalog.new()
    catalog.register_translation("zh_CN", "ui.start_game", "进入世界")
    catalog.register_translation("en_US", "ui.start_game", "Enter World")

    catalog.current_locale = "zh_CN"
    var t_zh: String = LocalizationSolver.translate(catalog, "ui.start_game")

    I18nHotReloadPipeline.switch_language(catalog, "en_US")
    var t_en: String = LocalizationSolver.translate(catalog, "ui.start_game")

    var passed: bool = (t_zh == "进入世界") and (t_en == "Enter World")
    return {
        "test": "TC-I18N-03: 语言环境即时热重载与无缝动态响应",
        "passed": passed
    }

static func _test_name_key_resolution_and_counter() -> Dictionary:
    LocalizationSolver.reset_missing_keys_count()
    var catalog := LocalizationRegistryCatalog.new()
    catalog.current_locale = "zh_CN"
    catalog.fallback_locale = "en_US"

    catalog.register_name_key("magic.rank.rank_11", "magic", "Tier 11", "十一阶")
    catalog.register_name_key("magic.title.fmt", "magic", "Rank {tier} Archmage", "第{tier}阶大魔导师")

    var resolved_zh: String = LocalizationSolver.resolve_name_key(catalog, "magic.rank.rank_11", "zh_CN")
    var resolved_en: String = LocalizationSolver.resolve_name_key(catalog, "magic.rank.rank_11", "en_US")
    var resolved_fmt: String = LocalizationSolver.resolve_name_key(catalog, "magic.title.fmt", "zh_CN", {"tier": 11})

    var missing_res: String = LocalizationSolver.resolve_name_key(catalog, "item.non_existent_sword.name", "zh_CN")
    var missing_cnt: int = LocalizationSolver.get_missing_keys_count()

    var passed: bool = (
        resolved_zh == "十一阶"
        and resolved_en == "Tier 11"
        and resolved_fmt == "第11阶大魔导师"
        and missing_res == "[item.non_existent_sword.name]"
        and missing_cnt == 1
    )
    return {
        "test": "TC-I18N-04: 统一名称解析、动态参数与未登记告警计数治理",
        "passed": passed
    }

static func _test_lazy_load_batch_and_empty_params_shortcircuit() -> Dictionary:
    var catalog := LocalizationRegistryCatalog.new()
    catalog.current_locale = "zh_CN"
    catalog.register_translation("zh_CN", "menu.btn_save", "保存游戏")
    catalog.register_translation("zh_CN", "menu.btn_load", "加载存档")

    var single_res: String = LocalizationSolver.translate(catalog, "menu.btn_save")
    var empty_key_res: String = LocalizationSolver.translate(catalog, "")

    var batch_map: Dictionary = LocalizationSolver.translate_batch(
        catalog, ["menu.btn_save", "menu.btn_load", "menu.btn_quit"]
    )

    var passed: bool = (
        single_res == "保存游戏"
        and empty_key_res.is_empty()
        and str(batch_map.get("menu.btn_save", "")) == "保存游戏"
        and str(batch_map.get("menu.btn_load", "")) == "加载存档"
        and str(batch_map.get("menu.btn_quit", "")) == "[menu.btn_quit]"
    )
    return {
        "test": "TC-I18N-05: 字典惰性重载、批量解析与空参零分配短路",
        "passed": passed
    }

static func _test_mod_i18n_isolation_and_unload_purging() -> Dictionary:
    var catalog := LocalizationRegistryCatalog.new()
    catalog.current_locale = "zh_CN"
    catalog.register_translation("zh_CN", "narrative.prologue.intro", "瓦尔兰大陆的微光原生开局")

    var mod_pack := {
        "narrative.prologue.intro": "异界降临！单机命途定制开局",
        "mod.destiny.talent.void_walker": "虚空行者"
    }
    var merge_res: Dictionary = catalog.merge_mod_translations("MOD_DESTINY_PACK_01", "zh_CN", mod_pack, true)
    var mod_intro: String = LocalizationSolver.translate(catalog, "narrative.prologue.intro")
    var mod_talent: String = LocalizationSolver.translate(catalog, "mod.destiny.talent.void_walker")

    var cleaned_keys_count: int = catalog.unload_mod_translations("MOD_DESTINY_PACK_01")
    var purged_intro: String = LocalizationSolver.translate(catalog, "narrative.prologue.intro")
    var purged_talent: String = LocalizationSolver.translate(catalog, "mod.destiny.talent.void_walker")

    var passed: bool = (
        bool(merge_res.get("success", false))
        and mod_intro == "异界降临！单机命途定制开局"
        and mod_talent == "虚空行者"
        and cleaned_keys_count == 2
        and purged_intro == "瓦尔兰大陆的微光原生开局"
        and purged_talent == "[mod.destiny.talent.void_walker]"
    )
    return {
        "test": "TC-I18N-06: MOD 自定义多语言加载、所有权隔离与卸载净化",
        "passed": passed
    }

static func _test_hot_switch_and_event_bus_broadcast() -> Dictionary:
    var catalog := LocalizationRegistryCatalog.new()
    catalog.register_translation("zh_CN", "sys.status", "运行中")
    catalog.register_translation("en_US", "sys.status", "Running")

    var switch_res: Dictionary = I18nHotReloadPipeline.switch_language(catalog, "en_US")
    var switch_ok: bool = bool(switch_res.get("success", false))
    var cur_loc_ok: bool = (catalog.current_locale == "en_US")

    var fail_res: Dictionary = I18nHotReloadPipeline.switch_language(catalog, "")
    var fail_ok: bool = not bool(fail_res.get("success", false))

    var null_cat_res: Dictionary = I18nHotReloadPipeline.switch_language(null, "zh_CN")
    var null_cat_ok: bool = not bool(null_cat_res.get("success", false))

    var passed: bool = switch_ok and cur_loc_ok and fail_ok and null_cat_ok
    return {
        "test": "TC-I18N-07: 语言热切换与 EventBus 领域事件广播闭环",
        "passed": passed
    }

static func _test_probe_cjk_and_dto_export() -> Dictionary:
    var catalog := LocalizationRegistryCatalog.new()
    catalog.current_locale = "zh_CN"
    catalog.fallback_locale = "en_US"
    catalog.register_translation("zh_CN", "item.herb", "草药")

    var has_herb: bool = LocalizationSolver.has_translation(catalog, "item.herb")
    var has_ghost: bool = LocalizationSolver.has_translation(catalog, "item.ghost_item")

    var is_zh_cjk: bool = catalog.is_cjk_locale("zh_CN")
    var is_ja_cjk: bool = catalog.is_cjk_locale("ja_JP")
    var is_en_cjk: bool = catalog.is_cjk_locale("en_US")

    var service := LocalizationI18nService.new(catalog)
    var state_dto: LocalizationI18nDTO = service.get_state()
    var dto_valid: bool = (state_dto != null and state_dto.current_locale == "zh_CN" and state_dto.is_cjk)

    var dto_dict: Dictionary = state_dto.to_dto()
    var rebuilt_dto: LocalizationI18nDTO = LocalizationI18nDTO.from_dto(dto_dict)
    var rebuild_ok: bool = (rebuilt_dto != null and rebuilt_dto.current_locale == "zh_CN")

    var passed: bool = (
        has_herb
        and not has_ghost
        and is_zh_cjk
        and is_ja_cjk
        and not is_en_cjk
        and dto_valid
        and rebuild_ok
    )
    return {
        "test": "TC-I18N-08: 键存在性探测、CJK 检测与状态 DTO 快照导出",
        "passed": passed
    }
