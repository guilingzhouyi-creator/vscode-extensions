# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/localization_i18n/dto/localization_i18n_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/localization_i18n.json | 信号: EventBus 领域广播
# 职责说明: 承载全域多语言国际化运行状态快照与跨域只读查询结构
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## LocalizationI18nDTO：Value Object DTO / Data Transport Model
class_name LocalizationI18nDTO
extends RefCounted

var current_locale: String = "zh_CN"
var fallback_locale: String = "en_US"
var supported_locales: Array = ["zh_CN", "en_US", "ja_JP", "zh_TW"]
var loaded_locales: Array = []
var total_keys_count: int = 0
var missing_name_keys_count: int = 0
var is_cjk: bool = true

## 导出为标准传输字典
func to_dto() -> Dictionary:
    return {
        "current_locale": current_locale,
        "fallback_locale": fallback_locale,
        "supported_locales": supported_locales.duplicate(),
        "loaded_locales": loaded_locales.duplicate(),
        "total_keys_count": total_keys_count,
        "missing_name_keys_count": missing_name_keys_count,
        "is_cjk": is_cjk
    }

## 从字典数据重建 DTO 对象
static func from_dto(dto_payload: Dictionary) -> LocalizationI18nDTO:
    var localization_snapshot := LocalizationI18nDTO.new()
    localization_snapshot.current_locale = String(dto_payload.get("current_locale", "zh_CN"))
    localization_snapshot.fallback_locale = String(dto_payload.get("fallback_locale", "en_US"))
    localization_snapshot.supported_locales = Array(dto_payload.get("supported_locales", ["zh_CN", "en_US", "ja_JP", "zh_TW"]))
    localization_snapshot.loaded_locales = Array(dto_payload.get("loaded_locales", []))
    localization_snapshot.total_keys_count = int(dto_payload.get("total_keys_count", 0))
    localization_snapshot.missing_name_keys_count = int(dto_payload.get("missing_name_keys_count", 0))
    localization_snapshot.is_cjk = bool(dto_payload.get("is_cjk", true))
    return localization_snapshot
