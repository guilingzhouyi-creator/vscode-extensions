# 前后端契约审查：UI 缺失审计报告

**审计范围**：`backend/domains/**` (46 域) ↔ `frontend/views/**` (17 视图) 双向核对  
**审计日期**：2026-09-05  
**审计角度**：从后端能力面反推应有 UI，识别三类缺口：完全缺失 / 部分覆盖 / 未接线

---

## 一、结论摘要

**46 个后端域**（含 4 个 INFRA 后台服务）中，**45 个属于用户面域**：

| 覆盖状态 | 数量 | 占比 | 含义 |
|---|---|---|---|
| **FULL**（完全覆盖） | 22 | 48.9% | 有独立视图或明确的 Tab/子界面覆盖 |
| **PARTIAL**（部分覆盖） | 19 | 42.2% | 骨架覆盖基础能力，后端深层能力（FSM/DAG/pipeline）无 UI |
| **MISSING**（完全缺失） | 4 | 8.9% | 有后端实现但零 UI 入口 |
| INFRA | 4 | — | 无需 UI 的后台服务 |

**结论**：前端 17 视图并非"17 项能力"，而是**46 项能力的骨架投射**。表面上 FULL 覆盖 22 项（48.9%），但因所有视图均声明"骨架阶段、零接线、Mock 数据驱动"，**这 22 项 FULL 只是 UI 骨架的完全覆盖，不代表后端能力的实际接入**。真实"接线完成度"是 0（延续前次审计 P1 结论）。

---

## 二、四类缺口的具体清单

### 2.1 完全缺失（MISSING）— 4 个域

这 4 个域有完整后端实现但零 UI 入口，是**最紧迫的补齐项**。

| 域 | 后端规模 | 用户面能力 | 建议入口 |
|---|---|---|---|
| **`world_gateway`** | 7 文件 / 11 静态方法 | 场景传送门、跨大陆传送、传送条件校验 | 应扩 `world_map` Tab 或新建 `travel_view` |
| **`spatial_movement`** | 4 文件 / 3 静态方法 | 闪现/瞬移/空间跳跃的冷却、CD、轨迹 | 应扩 `combat_view` 或 `main_hud` 快捷动作 |
| **`lifecycle_physiology`** | 3 文件 / 11 静态方法 | 角色生命周期（生老病死）、生理状态、衰老曲线 | 应扩 `character_progression` 生命体质指标 |
| **`item_statistics`** | 2 文件 / 8 静态方法 | 账号物品库统计、收藏图鉴、稀有度分布 | 应新建 `collection_view` 或扩 `inventory` |

**⚠ 反向异常**：前端有 `world_map` 视图（6 Tab、七大洲地图、城镇/行军/主权/领地/寻路），但后端**不存在** `world_map` 域。这是从"UI 侧看"的孤儿——地图数据可能在 `world_state`、`world_navigation`、`sovereignty_realm` 三域分散持有，但没有聚合域。若后续 Phase 需要新增地图能力，需先决定是否建立 `world_map` 聚合域。

### 2.2 部分覆盖（PARTIAL）— 19 个域

这些域有 UI 骨架，但**后端能力面被截断**。按"截断程度"排序（后端规模 ÷ 前端暴露度）：

| 优先级 | 域 | 后端规模 | 前端已覆盖 | 截断部分 |
|---|---|---|---|---|
| 🔴 | `character_creation` | 16 文件 / 43 静态方法 | account_entry 的创角表单 | 10 层 FSM / 属性初始化 / 传承基因 / 开场事件流 / 起始装备分发 |
| 🔴 | `physics_thermodynamics` | 9 文件 / 22 静态方法 | combat_view 战斗演出 | 热力学 solver / 回合协调器 / timeline replay / 战术验证器 |
| 🔴 | `magic_system` | 12 文件 / 48 静态方法 | combat_view 魔法效果 | 规则注册表 / 多施法 / 封印 solver / 条件-触发器编辑 |
| 🔴 | `inventory` | 13 文件 / 28 静态方法 | character_progression 背包网格 | 仓库 / 多槽位穿戴 / 属性评估 / 品质晋升 / 多职业引擎 |
| 🟠 | `persistence_protocol` | 4 文件 / 1 静态方法 | system_save 存档插槽 | 对账 solver / 广播器 / schema 版本 UI |
| 🟠 | `narrative_orchestration` | 11 文件 / 16 静态方法 | quest_causality DAG Tab | 概率 solver / 编年器 pipeline / DAG 执行引擎 |
| 🟠 | `spatial_merchant` | 3 文件 / 2 静态方法 | economy_trade 商铺货架 | 议价 FSM / 商人状态切换 |
| 🟠 | `trading_logistics` | 3 文件 / 0 静态方法 | economy_trade 运费预估 | 运输跟踪 / 关税计算 / 延迟模拟 |
| 🟠 | `potential_growth` | 4 文件 / 2 静态方法 | character_progression 属性加点 | Respec pipeline / 动态属性调整 / 定向 solver |
| 🟠 | `deterministic_sandbox` | 3 文件 / 3 静态方法 | system_save 回放快照 | 权威状态机 / GM 调试面板 |
| 🟠 | `equipment_loadout` | 3 文件 / 7 静态方法 | character_progression 装备槽位 | Modifier 评估 / 装备 FSM / 属性叠加 |
| 🟠 | `commission_quest` | 3 文件 / 1 静态方法 | quest_causality 悬赏委托 | 委托结算 solver / 合同 FSM |
| 🟠 | `organization_guild` | 3 文件 / 3 静态方法 | guild_social 公会管理 | 治理 solver / 科技树 FSM |
| 🟠 | `npc_simulation` | 3 文件 / 1 静态方法 | guild_social NPC 对话 | NPC AI solver / 行为状态机 |
| 🟠 | `sovereignty_realm` | 3 文件 / 1 静态方法 | world_map 领地 Tab | 领地争夺 FSM / 主权规则 |
| 🟠 | `cdkey_voucher` | 5 文件 / 1 静态方法 | system_save CDK 兑换 | 兑换流程编排 / 资格规则引擎 / 派发 pipeline |
| 🟡 | `admin_sandbox` | 5 文件 / 3 静态方法 | system_save GM 作弊面板 | GM 命令索引 / 沙盒权限审计 / 回滚服务 |
| 🟡 | `matter_disposal` | 3 文件 / 1 静态方法 | crafting_workshop 分解返还 | 销毁设施 DTO / 物质销毁 pipeline |
| 🟡 | `account` | 7 文件 / 15 静态方法 | account_entry 登录/选服 | 账户安全 / 注销 / 绑卡 / 会话管理 / 权益服务 |
| 🟡 | `bulletin_board_maintenance` | 3 文件 / 2 静态方法 | notification_bulletin 跑马灯 | 公告板 CRUD / 推送管道调度 |

### 2.3 未接线（WIRING）— 全部 17 视图

这是前次审计 P1 的直接延续：**所有 17 个视图均声明"骨架阶段、零接线"**：

- EventBus 订阅：0 处（除 `main_dashboard.gd` 例外 4 处）
- 后端 API 调用：0 处
- Mock 数据驱动：100%

这意味着即便 UI 骨架存在，"能力可见"和"能力可用"之间隔着整个接线层。

### 2.4 INFRA 无 UI — 4 个域

`world_state`、`feature_toggle_canary`、`telemetry_account_lifecycle`、`event_extractor` 属于后台服务/数据管道，不需 UI，但**运维/GM 场景可能需要只读仪表板**（Phase 56 防御性加固的一部分）。

---

## 三、17 视图 vs 46 域映射矩阵

| 视图 | 主域 | 覆盖的域数量 | 备注 |
|---|---|---|---|
| `account_entry` | account + character_creation | 2 | 骨架承担创角 FSM，实际仅表单 Mock |
| `main_hud` | chat_command + event_driven_audio | 2 | 主 HUD 也承担聊天命令补全 |
| `character_progression` | character_progression + inventory + equipment_loadout + potential_growth | 4 | 最重负载视图（8 Tab） |
| `combat_view` | physics_thermodynamics + magic_system | 2 | 战斗演出为主，规则编辑缺失 |
| `economy_trade` | currency_economy + spatial_merchant + trading_logistics | 3 | 商人/物流 FSM 截断 |
| `gacha_wish` | gacha_wish | 1 | 单一视图，覆盖完整 |
| `quest_causality` | quest_causality + narrative_orchestration + commission_quest | 3 | 叙事 DAG 编排器截断 |
| `mail_system` | mail_system | 1 | 单一视图，覆盖完整 |
| `guild_social` | organization_guild + npc_simulation + chat_command | 3 | 治理/科技树/NPC AI 截断 |
| `world_map` | world_map + world_navigation + sovereignty_realm | 3 | 领地 FSM/主权规则截断 |
| `monster_ecology` | monster_ecology + world_boss | 2 | 兽潮雷达/BOSS 战功榜完整 |
| `crafting_workshop` | workshop_forge + matter_disposal | 2 | 销毁设施截断 |
| `grimoire_authoring` | lattice_skill_book | 1 | AST 编辑/反编译完整 |
| `notification_bulletin` | notification_red_dot + bulletin_board_maintenance | 2 | 公告 CRUD 截断 |
| `settings_center` | game_settings + hardware_input + localization_i18n + event_driven_audio | 4 | 覆盖完整 |
| `system_save` | persistence_protocol + deterministic_sandbox + admin_sandbox + cdkey_voucher | 4 | GM 面板/CDK 覆盖但后台能力截断 |
| `misc_edge` | identity_disguise + elite_mutation + ground_loot + item_namespace_registry | 4 | 4 个边缘域统一在杂项视图 |

---

## 四、跨审计视角：镜像问题的三层解

回到前次审计的核心洞察——**前后端是同一问题的镜像**：

| 层次 | 后端症状 | 前端症状 | 共同根因 |
|---|---|---|---|
| **架构决策层** | Phase 51-56 声明 161 个 TC-ID 但仅 4 个落地（"合同堆"） | Phase 47-49 提到前端但无 TC-ID（"视觉堆"） | 路线图与执行脱钩 |
| **契约表达层** | DTO/FSM/Aggregate 完备但零 API 暴露 | 1,271 次 UII 调用完备但零后端接线 | 缺少"契约接口"定义 |
| **执行验证层** | 0 个集成测试 | 0 次 EventBus 订阅 + 0 次 API 调用 | 缺少端到端测试层 |

**4 个 MISSING 域（world_gateway/spatial_movement/lifecycle_physiology/item_statistics）** 恰恰暴露了最深层问题：**这些域被路线图跳过了**。它们既不在后端 Phase 51-56 的 TC-ID 声明里，也不在前端 Phase 47-49 的 UI 声明里——**是双重盲区**。

---

## 五、修复优先级建议

### P0（阻塞型，必须立刻处理）
1. **补齐 4 个 MISSING 域**：world_gateway（场景传送）、spatial_movement（空间移动）、lifecycle_physiology（生命周期）、item_statistics（物品图鉴）——这是玩家高频操作，缺失会阻断核心循环
2. **建立前后端契约接口层**：定义 DTO 到 UI 数据的转换契约，杜绝"UI 骨架存在但接线层为零"

### P1（结构型，Phase 60 前完成）
3. **`character_creation` 的 10 层 FSM 接线**：当前 account_entry 仅 Mock 表单，是最严重的 PARTIAL 域（43 静态方法 vs 表单 UI）
4. **`magic_system` / `physics_thermodynamics` 的规则编辑 UI**：48 + 22 静态方法被截断，玩家无法查看/自定义魔法规则
5. **`inventory` / `equipment_loadout` 拆分为独立视图**：目前挤在 character_progression 里（8 Tab 已很挤），13 + 3 = 16 文件应该独立

### P2（工程型，Phase 65 前）
6. **`admin_sandbox` / `cdkey_voucher` 拆出后台管理视图**：GM 面板+CDK 兑换目前混在 system_save，运维场景需要独立入口
7. **`narrative_orchestration` 剧本查看器**：11 文件 16 静态方法，叙事 DAG 执行引擎当前完全无 UI，仅 quest_causality 展示 DAG 拓扑
8. **`bulletin_board_maintenance` 公告板 CRUD**：目前只展示跑马灯，运营需要能编辑

### P3（演进型）
9. **INFRA 域只读仪表板**：world_state / feature_toggle_canary / telemetry 至少提供 GM 可见的运行时仪表
10. **契约层自动化测试**：把 46 域 × 17 视图的映射关系纳入 CI，防止后续 Phase 新增域再度造成盲区

---

## 六、方法论自检

| 检查项 | 状态 | 说明 |
|---|---|---|
| 是否覆盖所有 46 个后端域 | ✅ | 46/46 已分类 |
| 是否读取了所有 17 个视图的职责声明 | ✅ | 通过文件头注释 + 节点结构双向核对 |
| 是否验证了视图内部 Tab 结构 | ✅ | 抽样核对 misc_edge / settings_center / character_progression 等 |
| 是否区分了 INFRA 与用户面 | ✅ | 4 个 INFRA 独立分类 |
| 是否与短期施工区审计结论一致 | ✅ | MISSING 域对应"路线图盲区" |
| 是否与前端可视化审计结论一致 | ✅ | PARTIAL 的 19 项对应"接线层缺失" |
| 是否量化了缺口规模 | ✅ | 后端文件数/静态方法数/前端暴露度四维对照 |

**未覆盖（诚实声明）**：
- 未验证后端 `.gd` 文件的运行时行为（未启动 Godot）
- 未验证 `.tscn` 场景树的节点结构与 `.gd` 的 `@onready` 一致性
- 未验证 46 域之间的**跨域依赖**（比如 world_gateway 依赖 world_state 的场景清单）
- MISSING 分类基于域语义推断，若某个域被设计为"纯数据管道不需 UI"，可能误分类

---

## 七、与前次审计的连贯性

- **前端可视化审计**：识别"1,271 UII 调用完备但零后端接线"（视觉堆）
- **本次审计**：识别"46 域中 4 项完全无 UI + 19 项 UI 覆盖截断"（能力盲区）
- **短期施工区审计**：识别"161 TC-ID 仅 4 个落地"（合同堆）

三份审计指向**同一个根因**：**架构决策、执行、验证三层脱钩**。修复必须从契约层切入（P0-2），否则会陷入"每次 Phase 新增能力都需重新审计"的死循环。
