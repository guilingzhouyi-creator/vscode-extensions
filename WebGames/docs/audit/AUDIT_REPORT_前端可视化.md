# WebGames 前端可视化代码审计报告

**审计日期**：2026-09-04
**审计范围**：`frontend/**`（44 个源文件，21,301 行，867 KB）
**审计口径**：代码↔契约对齐、架构完整性、i18n 落地、与短期施工区宣称的对齐度
**方法论**：Python 全量扫描 + 逐文件抽样（`view_router` / `main_dashboard` / `ui_intermediary` / `placeholder_filler` / `visual_adapter` / `theme_manager` / `ui_binding_registry` / `ui_text_resolver` / `skeleton_mock.json` / 3 个视图抽样）

---

## 一句话结论

**前端处于"高保真骨架"阶段**：17 个视图、24 个 class_name、21,301 行 GDScript、1271 次 i18n 注入调用、零 `return {"passed": true}` 桩 —— 视觉与文案层完备，但**零后端接线**，所有视图以 Mock 数据驱动，事件总线完全断开。这与短期施工区"Phase 51-56 合同堆、Phase 46 域错位"的结论互为镜像：**后端在跑细则与桩代码，前端在跑视觉与 Mock**。

---

## 规模与结构

| 项 | 数值 |
|---|---|
| 目录数 | 5 个一级（`i18n/`, `mocks/`, `navigation/`, `theme/`, `views/`）+ 17 个视图子目录 |
| 总文件数 | 44（25 `.gd` + 18 `.tscn` + 1 `.json`） |
| 总代码行 | 21,301 |
| 总字节 | 867 KB |
| class_name 定义 | 24（含 `ViewRouter` / `ThemeManager` / 5 个 i18n 组件 / 17 个视图） |
| 骨架占位桩（`pass # 骨架阶段`） | 8 处 |
| `return {"passed": true}` 桩 | **0 处**（与短期施工区 Phase 46 阶段的 12 处占位形成鲜明对比） |

### 视图规模分布（`.gd` 行数）

| 视图 | 行数 | UII 调用 | 占位桩 |
|---|---|---|---|
| guild_social | 965 | 101 | 1 |
| character_progression | 917 | 77 | 0 |
| economy_trade | 810 | 78 | 1 |
| monster_ecology | 761 | 79 | 0 |
| crafting_workshop | 727 | 87 | 1 |
| world_map | 688 | 84 | 0 |
| main_hud | 672 | 56 | 0 |
| gacha_wish | 633 | 44 | 0 |
| misc_edge | 631 | 100 | 1 |
| system_save | 612 | 89 | 1 |
| grimoire_authoring | 589 | 91 | 0 |
| quest_causality | 580 | 78 | 0 |
| notification_bulletin | 558 | 72 | 1 |
| account_entry | 542 | 73 | 0 |
| combat_view | 511 | 55 | 0 |
| mail_system | 505 | 56 | 0 |
| settings_center | 466 | 51 | 2 |
| **main_dashboard** | **270** | **0** | 0 |

---

## 架构分层

### i18n 栈（5 层）

```
UITextResolver  ──→ PlaceholderFiller  ──→ VisualAdapter  ──→ UIIntermediary.resolve()  ──→ UI 节点
     │                                                    │
     └── LocalizationSolver (backend/domains/localization_i18n)
                                                     └── UIBindingRegistry（绑定刷新）
```

- `UITextResolver` 通过 `load()` + `get_static_method("translate")` 反射式访问后端 catalog
- `PlaceholderFiller` 基于参数名关键字（`amount`/`gold`/`rate`）推断格式化策略
- `VisualAdapter` 用 `char_count × font_size × 0.6` 估算文本宽度，逐级降字号或截断
- `UIIntermediary.resolve()` 是 5 步编排总入口：翻译 → 填充 → 注入 → 适配 → 绑定
- `UIBindingRegistry` 维护节点↔key 映射，语言切换时批量刷新

### 路由与主题

- `ViewRouter`：17 个视图硬编码注册，`push_view`/`replace_view`/`pop_view` 三层栈
- `ThemeManager`：运行时从 `config/infrastructure/event_categories.json` 生成 Godot `Theme` 资源

### 数据源

- `frontend/mocks/skeleton_mock.json`（3.3 KB）：5 域快照（account/character/combat/economy/world_map）
- `config/frontend/ui.json`（2.7 KB）+ `config/frontend/views.json`（17.2 KB）：默认值 + 兜底文案
- `config/i18n/zh_CN.json`（103.5 KB）+ `en_US.json`（105.2 KB）：主文案库

---

## 核心发现

### P1 — 前端"视觉层完备，接线层完全为零"

- 17 个视图 1271 次 `UIIntermediary` 调用
- 0 次 `EventBus` 订阅（对比：`main_dashboard.gd` 有 4 处 EventBus 连接）
- 0 次后端 API/DTO 消费
- 每个视图顶部注释均标注 `骨架阶段：零接线、不接 EventBus`
- `ViewRouter` 注释明确写 `骨架阶段：只做 push/pop/replace，不接后端`

**与短期施工区审计的对照**：短期施工区结论是"Phase 51-56 是合同堆，161 个 TC-ID 声明，仅 4 个落地"。前端是"视觉层是合同堆的对称体——1271 次文案注入全部落地，但业务层 0 落地"。**两边都在"骨架"，只是骨架的形状不同**。

### P2 — 8 处 `pass # 骨架阶段` 桩函数

| 文件 | 位置 | 语义 |
|---|---|---|
| `guild_social_view.gd` | L939 | Tab 切换空操作 |
| `economy_trade_view.gd` | L785 | Tab 切换空操作 |
| `crafting_workshop_view.gd` | L707 | Tab 切换空操作 |
| `settings_center_view.gd` | L459 | Tab 切换空操作（此文件有 2 处） |
| `combat_view` 等 | 多处 | 场景占位 |

`pass` 桩在点击 Tab 时**静默失败**，用户点 Tab 无反馈。这不是"骨架阶段"的合理占位，是**交互路径断裂**。

### P3 — 20 个 i18n Key 缺失 + 147 个 Key 未被引用

**缺失的 20 个**（全部在 `zh_CN.json` 中找不到）：

- 前缀型（12 个）：`ui.fe01.char_create.origin_`、`ui.fe01.server_select.server_`、`ui.fe02.skill.`、`ui.fe03.rarity.`、`ui.fe13.rarity.`、`ui.fe15.graphics.quality_` …
  - **根因**：这些是**拼接键**（`"ui.fe02.skill." + id`），运行时动态生成，静态扫描误报
- 完整键（8 个）：`ui.fe11.beast_tide.reward.magic_crystal_30`、`ui.fe13.mock.ast.`、`ui.fe13.mock.cover.` …
  - **根因**：mock 数据专用键，未进入主文案表

**未被引用的 147 个**：文案表冗余，需清理或标记为 reserved。

**建议**：
1. 引入键拼接白名单机制（把 12 个前缀型键登记在 `i18n_prefix_keys` 数组）
2. 静态检查工具需区分"拼接键"与"完整键"
3. 清理 147 个冗余键，或对 mock 键单独建表

### P4 — `UITextResolver` 通过反射访问后端

```gdscript
var script = load("res://backend/domains/localization_i18n/localization_registry_catalog.gd")
var cat = script.get_static_method("get_shared").call()
```

**问题**：
- 完全绕过 GDScript 类型系统，运行期才报错
- 强耦合后端具体文件路径（重构必崩）
- 无接口/契约，两端可各自漂移

**建议**：定义 `LocalizationCatalog` 接口基类，前后端都依赖接口，而不是 `load()` 反射。

### P5 — `VisualAdapter` 文本宽度估算精度问题

```gdscript
var estimated_width := char_count * current_size * 0.6
```

**问题**：
- CJK 字符宽度接近 `font_size × 1.0`，拉丁字符约 `0.5-0.6`
- 混合文本（如"金币: 500"）估宽偏差可达 30-50%
- 无缓存，每次 `adapt_view` 都遍历全节点树

**建议**：使用 `ThemeDB.fallback_font.get_string_size()` 实测宽度，替换估算公式。

### P6 — `PlaceholderFiller` 格式化策略靠字符串匹配

```gdscript
if key_lower.find("amount") >= 0 or key_lower.find("gold") >= 0 or key_lower.find("copper") >= 0:
    return _format_thousands(int(value))
```

**问题**：
- `gold_rate` 会被误判为金额（因为含 `gold`）
- `copper_price_per_kg` 会被误判为千分位（因为含 `copper`）
- 参数命名不规范时行为不可预测

**建议**：引入类型注解或格式提示（如 `{amount:thousands}`），而不是靠参数名反推。

### P7 — `UIBindingRegistry` 存储裸 `Node` 引用

```gdscript
_bindings.append({
    "node": node,       # 裸 Node 引用
    "key": key,
    "params": params,
    "type": _detect_node_type(node)
})
```

**问题**：
- 视图销毁时若不主动调用 `unbind_view`，残留节点引用会导致 `is_instance_valid` 检查失败
- `_refresh_binding` 里用 `is_instance_valid` 兜底，但**遍历时 erase 会有并发问题**
- `main_dashboard.gd` 完全没走这个流程（0 次 `UIIntermediary` 调用），完全依赖 `_ready()` 一次性注入

**建议**：改为 `RID` + 缓存 ID 映射，或改用弱引用表。

### P8 — `main_dashboard.gd` 完全绕过 i18n 编排层

- `main_dashboard.gd` 直接调 `GameConfig.get_string("frontend.ui", "banner_title", ...)`
- 直接调 `EventBus.get_instance().xxx.connect(_on_xxx)`
- 0 次 `UIIntermediary` / `PlaceholderFiller` / `UITextResolver`

**问题**：
- 与 `UIIntermediary` 编排层意图不符（该文件是仪表盘，非业务视图）
- 是**架构例外**还是**违规**？没有注释说明边界

**建议**：在文件顶部加 `## 例外声明：本视图为系统仪表盘，走 GameConfig 直连，不纳入 UIIntermediary 管辖`。

### P9 — `skeleton_mock.json` 只覆盖 5 域，17 视图共用

- Mock 域：`account`、`character`、`combat`、`economy`、`world_map`
- 但视图有 17 个：guild_social、crafting_workshop、grimoire_authoring、quest_causality、mail_system、system_save、gacha_wish、notification_bulletin、settings_center、misc_edge、monster_ecology、main_hud、mail_system、quest_causality、system_save … 全部靠**硬编码默认值**驱动

**问题**：Mock 覆盖率 5/17 = 29%，其余视图靠 `GameConfig.get_string` 兜底字符串。

**建议**：把 17 视图的默认数据也纳入 Mock JSON，或明确声明"其余视图无 Mock，兜底走 `frontend.views` 配置表"。

### P10 — ViewRouter 硬编码 17 视图

```gdscript
var _view_registry: Dictionary = {
    "account_entry": "res://frontend/views/account_entry/account_entry_view.tscn",
    "main_hud": "res://frontend/views/main_hud/main_hud_view.tscn",
    ...
}
```

**问题**：
- 新增视图必须改这份注册表
- 无路径模式约定，路径拼错只会在运行时 `load()` 失败

**建议**：改为扫描 `res://frontend/views/*/*_view.tscn` 自动注册，或改用配置文件。

---

## 与短期施工区审计的镜像对照

| 维度 | 短期施工区（Phase 45-56） | 前端可视化 |
|---|---|---|
| 主形态 | 12 期 × 4 阶段 = 48 份 md 细则 | 17 视图 × (`.gd` + `.tscn`) = 34 个组件 |
| 声明-落地缺口 | 161 TC-ID 声明，4 个落地（0.25%） | 1271 UII 调用落地，0 次后端接线 |
| 桩代码 | Phase 46 阶段 4 有 12 处 `return {"passed": true}` | 8 处 `pass # 骨架阶段` |
| 域错位 | Phase 46：`item_attributes` 声明 vs `inventory` 实现 | 无域错位（17 视图与 17 目录对齐） |
| 契约漂移 | Phase 45 声明 6 TC，实际有 7 TC（M8 未回写） | 20 个 i18n Key 缺失（8 个真缺失） |
| 完成度分布 | A(3) / B+(2) / C(1) / D(6) | 17/17 视图均达"骨架级完备"，但业务闭环 0 |

**核心洞察**：短期施工区的"合同堆"是**后端细则先行、代码未施工**；前端的"合同堆"是**视觉骨架先行、业务未接线**。两者共同反映同一问题：**架构层与工程层脱节，细则/视觉与执行/数据互不阻塞**。

---

## 优点清单

1. **class_name 全覆盖**：24 个 class_name 定义齐全，无命名冲突
2. **i18n 编排完备**：5 层堆栈（Resolver/Filler/Adapter/Registry/Intermediary）职责边界清晰
3. **零占位桩**：0 处 `return {"passed": true}`，与 Phase 46 形成鲜明对比
4. **1271 次 UII 调用全部落地**：每个视图的文案注入路径完整
5. **Mock 独立成域**：`frontend/mocks/skeleton_mock.json` 与业务代码解耦
6. **视图 ↔ 目录 ↔ 注册 100% 对齐**：17 视图、17 目录、17 注册，零遗漏

---

## 建议（按优先级）

### P0（阻塞后续接线）

1. **给 `UITextResolver` 引入接口层**：定义 `LocalizationCatalog` 基类，替代 `load()` + `get_static_method()` 反射
2. **补全 8 个真缺失的 i18n Key**：`ui.fe13.mock.*` 系列 + `ui.fe11.beast_tide.reward.magic_crystal_30`
3. **消除 8 处 `pass # 骨架阶段` Tab 桩**：改成"当前 Tab 空数据 + 空态提示"，禁止静默失败

### P1（架构稳健性）

4. **`VisualAdapter` 用实测宽度替换估算**：`ThemeDB.fallback_font.get_string_size()` 替代 `char × size × 0.6`
5. **`PlaceholderFiller` 引入格式提示**：`{amount:thousands}` 语法替代参数名关键字匹配
6. **`UIBindingRegistry` 存储改弱引用**：避免裸 `Node` 引用导致 `is_instance_valid` 兜底路径频繁触发
7. **`main_dashboard.gd` 顶部加例外声明**：明确不纳入 `UIIntermediary` 管辖

### P2（工程效率）

8. **ViewRouter 改为扫描注册**：`res://frontend/views/*/*_view.tscn` 自动发现
9. **Mock JSON 扩展到 17 视图**：或明确声明"其余视图走 `frontend.views` 兜底"
10. **i18n 键拼接白名单机制**：登记 12 个前缀型拼接键，静态检查不再误报
11. **清理 147 个冗余 i18n 键**：或标记为 reserved，避免未来歧义

### P3（接线路径规划）

12. **明确"骨架→接线"迁移路径**：为每个视图定义"接线阶段"（数据源、事件订阅、错误处理），并在视图顶部注释里显式标注当前阶段

---

## 方法论自查

本次审计的边界与遗留问题：

- **未执行代码编译**：仅静态扫描 44 文件；未跑 `godot --headless --check-only`
- **未做动态运行验证**：所有视图的 UI 行为（点击、Tab 切换、事件响应）未实际验证
- **未做性能基准**：`VisualAdapter` 的 O(N) 遍历深度、`UIBindingRegistry.refresh_all()` 的时间成本未测
- **i18n Key 缺失判定保守**：20 个"缺失"中 12 个是拼接前缀，静态扫描误报，实际真缺失约 8 个
- **未审计 `.tscn` 节点树**：18 个 `.tscn` 文件的节点层次、`%` 唯一命名是否与实际 `@onready` 引用一致，未交叉验证

---

**报告生成**：2026-09-04
**审计范围**：`frontend/**`（44 文件 / 21,301 行）
**配套交付**：`AUDIT_REPORT_前端可视化.md`（本文件）+ `前端可视化_审计报告.html`（可视化版）
