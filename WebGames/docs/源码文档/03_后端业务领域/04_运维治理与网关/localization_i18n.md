# 多语言国际化、动态插值与 MOD 词典隔离 (`localization_i18n`)

> 对应源码：`backend/domains/localization_i18n/`（5 个 `.gd`，含 `dto/`）。负责多语种词条字典装载、多级安全回退链、零堆分配参数插值、MOD 词典热合并/卸载与全局语言热切换广播。

---

## 一、模块与类清单

| 文件路径 | 核心类 | 角色定位 | 公开接口与配置映射 |
| :--- | :--- | :--- | :--- |
| [localization_registry_catalog.gd](../../../../backend/domains/localization_i18n/localization_registry_catalog.gd) | `LocalizationRegistryCatalog` | 语言字典与名称键注册中心 | `ensure_dictionaries_loaded()`、`merge_mod_translations()`、`unload_mod_translations()`、`register_name_key()`；加载 `i18n.zh_CN`、`i18n.en_US` |
| [localization_solver.gd](../../../../backend/domains/localization_i18n/localization_solver.gd) | `LocalizationSolver` | 回退检索与参数插值求解器 | `translate()`、`has_translation()`、`translate_batch()`、`resolve_name_key()`（统计缺失键计数） |
| [localization_i18n_service.gd](../../../../backend/domains/localization_i18n/localization_i18n_service.gd) | `LocalizationI18nService` | 全域国际化门面服务 | `get_instance()`、`get_state()`、`translate()`、`switch_language()`、`merge_mod_translations()`、`unload_mod_translations()` |
| [i18n_hot_reload_pipeline.gd](../../../../backend/domains/localization_i18n/i18n_hot_reload_pipeline.gd) | `I18nHotReloadPipeline` | 语言切换热更新管线 | `switch_language()` 切换语言并向前端派发刷新事件 |
| [localization_i18n_dto.gd](../../../../backend/domains/localization_i18n/dto/localization_i18n_dto.gd) | `LocalizationI18nDTO` | i18n 状态只读快照 DTO | `to_dto()`、`from_dto()` |

---

## 二、关联配置与验证

- **配置映射**：`domains.localization_i18n.core`、`narratives.localization_i18n`、`i18n.zh_CN`、`i18n.en_US`。
- **测试入口**：[test_localization_i18n.gd](../../../../tests/unit/domains/test_localization_i18n.gd)。
