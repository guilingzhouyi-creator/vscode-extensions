# 卡拉尔世界引擎 · 配置分层规范 (Config Layering Convention)

本目录是引擎全量配置的唯一事实来源（Single Source of Truth）。业务代码**零硬编码**，
所有数值 / 文案 / 标识 / 分类均由 `backend/infrastructure/game_config.gd` 从本目录加载。

## 一、目录分层（与代码架构一一对应）

```
config/  # 统一小写目录（已归一，历史大写 Configs/ 已移除，GameConfig 仅扫描 res://config/）
├── infrastructure/          # 基础设施层   -> 表名 infrastructure.<name>（13 张）
│   ├── admin.json               # GM 权限盐/口令与沙盒默认/审计阈值
│   ├── clock.json               # 三级世界时钟历法常数
│   ├── contract_completeness_baseline.json  # 契约完整性审查基线
│   ├── contracts.json           # 前后端契约注册表（契约完整性门禁依据）
│   ├── domains.json             # 领域清单唯一事实来源（架构护栏依据，见第七节）
│   ├── errors_catalog.json      # 全域错误码目录（含 message_key 映射）
│   ├── event_bus_config.json    # EventBusCore 信道定义与空间分发参数
│   ├── event_categories.json    # 全域事件分类：name + 颜色（前端渲染按此取色，含 gacha/system）
│   ├── lifecycle.json           # 领域生命周期元数据
│   ├── log.json                 # 日志级别 / 输出格式
│   ├── persistence.json         # 存档目录/扩展名/版本/协议契约/错误文案
│   ├── release_policy.json      # 灰度发布策略与版本编排契约
│   └── version_manifest.json    # 版本清单（灰度挂载双保险激活门禁依据）
├── domains/                 # 领域层（52 张平衡表，覆盖 47 领域）-> 表名 domains.<name>
│   ├── 基础域：currency/combat/inventory/monster/lifecycle/npc/quest/sovereignty/world/lattice/deterministic/trading
│   ├── 演进扩展域：equipment/gacha/workshop/elite/world_boss/potential/character_creation/account/attribute/
│   │   quality_tiers/magic_rules/magic_tiers/item_attributes/item_statistics/starter_loadout/economy/chat_command
│   ├── 第二轮演进域：bulletin_board_maintenance/cdkey_voucher/commission_quest/event_driven_audio/event_extractor/
│   │   event_probability/feature_toggle_canary/game_settings/ground_loot/hardware_input/identity_disguise/
│   │   item_namespace_registry/localization_i18n/mail_system/matter_disposal/narrative_orchestration/
│   │   notification_red_dot/organization_guild/spatial_merchant/spatial_movement/telemetry_account_lifecycle/
│   │   world_gateway/world_state
├── frontend/                # 表现层（UI 文案/演示数据/17系统视图配置） -> 表名 frontend.<name>（2 张）
│   ├── ui.json
│   └── views.json
├── items/                   # 物品定义层（物品原型模板，装配入口自动发现） -> 表名 items.<name>
│   └── core.json                # 全量物品原型（canonical_id/统一英文名 english_name/i18n loc 键/基础属性），数字 ID 缺省自动递增
└── narratives/              # 文案层（49 张，含基础设施与领域各域） -> 表名 narratives.<name>
    ├── infrastructure 对应：admin/clock/persistence/errors/events
    ├── frontend 对应：frontend
    ├── 领域 42 张全量映射：account/bulletin_board_maintenance/cdkey_voucher/character_creation/chat_command/
    │   combat/commission_quest/currency/deterministic/elite/equipment/event_driven_audio/feature_toggle_canary/
    │   gacha/game_settings/ground_loot/hardware_input/identity_disguise/inventory/item_namespace_registry/
    │   lattice/lifecycle/localization_i18n/mail_system/matter_disposal/monster/narrative_orchestration/
    │   notification_red_dot/npc/organization_guild/potential/quest/sovereignty/spatial_merchant/
    │   spatial_movement/telemetry_account_lifecycle/trading/workshop/world/world_boss/world_gateway/world_state
    └── 序章/目录类：prologue_dag_catalog/prologue_i18n
```

**领域总数: 47**（唯一事实来源 `infrastructure/domains.json`，由 TC-ARCH-05 校验与本文档同步）。
表数与领域数不相等是**合法**的：少数领域复用基础设施表或别名表（如 `physics_thermodynamics`
复用 `domains.combat`、`admin_sandbox` 复用 `infrastructure.admin`），映射关系一律以清单为准。

**表名规则**：`<层目录>.<文件名>`，例如 `config/domains/combat.json` → 表名
`domains.combat`；`config/frontend/ui.json` → 表名 `frontend.ui`。
`GameConfig` 递归扫描目录自动生成表名，新增文件无需注册代码。

## 二、键路径规范

- 取值路径以 `/` 分隔多级键：`"participant_defaults/hp"`、`"rates/silver"`
- 支持数组下标：`"symbols/physical/0"`（cur 为 Array 时按数字索引）
- 键名统一**小写蛇形**（snake_case）；层前缀已含在表名中，**键路径内不得重复层名**
- 未命中或类型不符时返回代码内默认值（永不抛错），见「取值优先级」

## 二.5、文件格式规范（`audit_config.py` 强制）

- 编码 UTF-8 **无 BOM**；换行符 **LF**；文件以**末行换行符**结尾
- 序列化统一 **2 空格缩进**、`ensure_ascii=false`（中文直书，禁止 `\uXXXX` 转义）、键序保持登记时的稳定顺序
- 改表只改值与键，不做全文件重排序 diff；新增文件直接按本规范序列化即可通过门禁

## 三、取值规范（GameConfig 使用规则）

```gdscript
GameConfig.get_float("domains.combat", "participant_defaults/hp", 100.0)   # ✅ 类型化
GameConfig.get_int("infrastructure.clock", "hours_per_day", 24)
GameConfig.get_string("narratives.combat", "strike_hit", "")
GameConfig.get_dict("infrastructure.event_categories", "", {})             # 空路径 = 整表
GameConfig.msg("matter_disposal", "slag_ash_name")                          # 领域文案统一入口
```

- **必须使用类型化取值器**：`get_int / get_float / get_string / get_bool / get_dict / get_array`
- 禁止 `var x := GameConfig.get_value(...)`（返回值是 Variant，项目『警告即错误』会编译失败）
- 成员初始值可用静态调用：`var hp: float = GameConfig.get_float("domains.combat", "participant_defaults/hp", 100.0)`
- 领域内 `_msg(key)` 私有文案助手一律**一行委托** `GameConfig.msg("<域>", key)`
  （表固定 `narratives.<域>`、未命中回退键名本身；键名为运行期变量属动态键，不参与 TC-ARCH-06 静态键校验）
- 叙事文案统一经 `EventBusCore.emit_narrative_by_key("<域>/<模板键>", "<分类键>", [args])`
  渲染，模板存于 `config/narratives/<域>.json`（Phase 72 后旧 `EventBus` 已全域退役，调用点统一为 `EventBusCore`）

**取值优先级（可覆盖链）**：运行时赋值 > 配置文件 > 代码默认值（防御性回退）。

## 四、保留在代码内的常数（刻意不配置化）

- 纯物理 / 数学普适值：动能系数 0.5、百分比 ×100、`max(1.0)` 防零分母、`max(0.0,...)` 钳制
- 序列化 / 协议契约字典键（`hp`/`ap`/`verb`/`serialize()` 键等，测试与存档兼容依赖）
- 枚举类型定义（`MagicForm`/`TitleRank` 等）——类型常量，非业务数据

## 五、新增配置流程

1. 新建 `config/<层>/<name>.json`，顶层必须为 JSON 对象
2. 业务侧用类型化取值器读取（表名 = `<层>.<name>`，自动生效）
3. 若为必需表（引擎启动就依赖），追加到 `game_config.gd` 的 `_required_tables`
   ——**顺序铁律：先确认表文件已存在，再登记**，否则 TC-CFG-04 立即变红
4. 数值/文案改动**只改 JSON**，运行时 `GameConfig.reload_config()` 即热生效，无需重编译（不可命名 `reload()`——GDScript 内建遮蔽，见 game_config.gd）

## 六、校验与运维

- `GameConfig.describe()` 返回加载报告：`{ count, tables, missing_required }`
- 必需表缺失时启动输出 `push_warning`，防止配置漏删导致业务静默回退默认值
- JSON 解析失败会在加载时输出带文件路径与行号的警告

## 七、领域清单与架构护栏

`infrastructure/domains.json` 是**领域维度的唯一事实来源**，每条记录声明：

```json
{
  "id": "inventory",                              // 必须等于 backend/domains/ 目录名
  "config": "domains.inventory",                  // 业务数值表名（允许别名复用）
  "narrative": "narratives.inventory",            // 文案表名（允许别名复用）
  "test": "res://tests/unit/domains/test_inventory.gd",
  "test_symbol": "TestInventoryDomain",
  "phase": 1,
  "depends_on": []
}
```

基础设施层领域（如 `admin_sandbox` / `persistence_protocol`）复用 `infrastructure.*` 表
属合法设计，需标注 `"config_exempt": true` 与 `"exempt_reason"`。

`tests/unit/test_architecture_guard.gd` 依据本清单执行 6 项断言（TC-ARCH-01 ~ 06），
覆盖目录双向差集、配置表齐备、测试注册完整、零全局随机调用、文档计数同步、键级漂移防删键。
新增领域若漏建表、漏注册测试或未同步本文档的领域总数，该套件会立即变红。
