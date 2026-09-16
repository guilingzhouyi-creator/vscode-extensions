# 前端 UI 骨架建设路线图 (Frontend UI Skeleton Roadmap)

> \[!IMPORTANT]
> **【前端骨架施工总纲】**：本路线图统领前端 **17 卷 × 84 界面** 的可视化骨架搭建与鼠标点击交互测试。**严格不接线**——所有 UI 组件仅消费本地 Mock 快照数据、不连接 EventBusCore 事件总线、不调用后端求解器、不触发确定性 RNG。
>
> **三条铁律**：
>
> 1. **零接线纪律**：骨架阶段前端只渲染 Mock 快照 + 响应鼠标点击视觉反馈，不接入 EventBusCore 事件总线，不调用任何后端领域 API；
> 2. **配置驱动**：全部文案、配色、布局参数来自 `config/frontend/ui.json` 与 `config/infrastructure/event_categories.json`，代码内仅保留兜底默认值；
> 3. **鼠标可达**：每一个可交互组件必须可通过鼠标点击触发视觉状态变化（按下态 / 选中态 / 切换态），可独立走查验证。
>
> 本路线图严格基于《前端架构需求表索引》17 卷需求表制定；施工须经项目负责人批准后方可启动。

***

## 一、 骨架建设全景图 (Skeleton Panorama)

```
graph TD
    subgraph "地基层 P0: 底座与入口"
        P0_THEME[Theme 令牌层<br/>event_categories 配色 + 字号 + 间距]
        P0_ROUTER[ViewRouter 视图路由<br/>17 视图注册表 + 切换栈]
        P0_ACC[表1 账号入口<br/>启动页/登录/注册/选服/创角]
        P0_HUD[表2 主界面HUD<br/>顶栏/战报/操作栏/聊天]
        P0_SET[表15 设置中心<br/>音画/按键/语言]
    end

    subgraph "核心层 P1: 角色战斗经济"
        P1_CHAR[表3 角色养成<br/>面板/属性/技能树/装备/背包]
        P1_COMBAT[表4 战斗界面<br/>飘字/BOSS血条/结算]
        P1_ECO[表5 经济交易<br/>钱包/商店/物价图]
    end

    subgraph "世界层 P2: 地图任务社交"
        P2_MAP[表10 世界地图<br/>大地图/城镇/行军/主权]
        P2_QUEST[表7 任务因果<br/>列表/详情/DAG/悬赏]
        P2_MAIL[表8 邮件系统<br/>列表/详情/写邮件]
        P2_GUILD[表9 社交公会<br/>公会/频道/好友/NPC]
    end

    subgraph "深度层 P3: 成长与探索"
        P3_GACHA[表6 抽卡祈愿<br/>祈愿/结果/保底]
        P3_CRAFT[表12 制造工坊<br/>锻造/配方/分解/材料]
        P3_GRIM[表13 魔典著书<br/>书库/AST/著书/版税]
        P3_MON[表11 怪物生态<br/>图鉴/BOSS/兽潮]
    end

    subgraph "闭环层 P4: 通知与系统"
        P4_NOTE[表14 通知公告<br/>Toast/Modal/红点]
        P4_SAVE[表16 系统存档<br/>存档/回放/沙盒/CDK]
        P4_MISC[表17 边缘杂项<br/>伪装/突变/掉落/命名]
    end

    P0_THEME --> P0_ROUTER --> P0_ACC & P0_HUD & P0_SET
    P0_HUD --> P1_CHAR & P1_COMBAT & P1_ECO
    P0_HUD --> P2_MAP & P2_QUEST & P2_MAIL & P2_GUILD
    P1_CHAR --> P3_GACHA & P3_CRAFT & P3_GRIM & P3_MON
    P0_HUD --> P4_NOTE
    P0_ACC --> P4_SAVE
    P1_CHAR --> P4_MISC
```

***

## 二、 四期施工细则 (Phase Breakdown)

### P0 · 地基期：主题令牌 + 路由 + 入口三件套

**目标**：搭好可运行的 Godot UI 底座,17 个视图可通过路由切换到达,主题配色与配置表对齐。

| 交付物                                  | 规格                                    | 验收要点                                          |
| :----------------------------------- | :------------------------------------ | :-------------------------------------------- |
| `frontend/theme/kalar_theme.tres`    | Godot Theme 资源                        | 8 事件分类配色读 `event_categories.json`,字号/间距/圆角可配置 |
| `frontend/navigation/view_router.gd` | 视图路由注册表                               | 17 视图注册 + push/pop/replace 栈操作 + 转场动画桩        |
| 表1 账号入口 `.tscn + .gd`                | 6 界面场景树                               | 启动页→登录↔注册→选服→角色选择/创建,全链路可点击走通                 |
| 表2 主界面 HUD `.tscn + .gd`             | 7 子界面场景树                              | 顶栏状态/操作栏/战报终端/聊天框/小地图/任务追踪/主菜单                |
| 表15 设置中心 `.tscn + .gd`               | 6 子界面场景树                              | 音频/视频/按键/语言/功能开关/画质回滚                         |
| 基类改造                                 | 17 个 `.gd` 从 `RefCounted` → `Control` | 全部视图继承 Control,有 `_ready()`,可挂场景树             |

**界面数**: \~19 个(P0 三系统全量)

**测试策略**:启动项目,从启动页走到主菜单,再点开设置,验证全链路鼠标可点击、无报错。

***

### P1 · 核心期：角色 + 战斗 + 经济

**目标**:核心玩家循环三件套可视化,角色面板可切换 Tab、战斗界面可看到飘字/血条、经济面板可看到物价曲线。

| 交付物                   | 规格       | 验收要点                             |
| :-------------------- | :------- | :------------------------------- |
| 表3 角色养成 `.tscn + .gd` | 8 子界面场景树 | 总面板/属性详情/生命体质/技能树/装备栏/背包/称号/潜力加点 |
| 表4 战斗界面 `.tscn + .gd` | 5 子界面场景树 | 战斗主界面/伤害飘字/BOSS多部位血条/结算面板/部位破坏   |
| 表5 经济交易 `.tscn + .gd` | 7 子界面场景树 | 钱包/商店/拍卖/物流/物价曲线图/兑换/资源池         |

**界面数**: 20 个

**测试策略**:从主 HUD 点开角色面板/战斗/经济入口,验证 Tab 切换、按钮点击态、Mock 数据渲染。

***

### P2 · 世界期：地图 + 任务 + 邮件 + 社交

**目标**:世界探索四件套骨架落盘,大地图可缩放点击、任务列表可展开、邮件可翻阅、公会可浏览。

| 交付物                    | 规格       | 验收要点                         |
| :--------------------- | :------- | :--------------------------- |
| 表10 世界地图 `.tscn + .gd` | 6 子界面场景树 | 大地图/城镇/行军探索/主权建国/领地/寻路       |
| 表7 任务因果 `.tscn + .gd`  | 4 子界面场景树 | 任务列表/任务详情/因果DAG图/悬赏通缉        |
| 表8 邮件系统 `.tscn + .gd`  | 3 子界面场景树 | 邮件列表/邮件详情/写邮件                |
| 表9 社交公会 `.tscn + .gd`  | 6 子界面场景树 | 公会面板/成员列表/聊天频道/好友/NPC对话/玩家交易 |

**界面数**: 19 个

**测试策略**:从主 HUD 进入地图/任务/邮件/社交,验证列表滚动、详情展开、Tab 切换。

***

### P3 · 深度期：抽卡 + 工坊 + 魔典 + 怪物

**目标**:深度成长四件套骨架落盘,抽卡有演出动画、锻造有强化预览、AST 编辑器可拖节点、怪物图鉴可翻页。

| 交付物                    | 规格       | 验收要点                      |
| :--------------------- | :------- | :------------------------ |
| 表6 抽卡祈愿 `.tscn + .gd`  | 3 子界面场景树 | 祈愿主界面/抽卡结果/保底历史           |
| 表12 制造工坊 `.tscn + .gd` | 4 子界面场景树 | 锻造工坊/配方列表/物品分解/材料仓库       |
| 表13 魔典著书 `.tscn + .gd` | 5 子界面场景树 | 魔典书库/AST编辑器/著书立说/版税结算/反编译 |
| 表11 怪物生态 `.tscn + .gd` | 3 子界面场景树 | 怪物图鉴/世界BOSS/兽潮调度          |

**界面数**: 15 个

**测试策略**:从主 HUD 进入抽卡/工坊/魔典/怪物,验证动画状态机、节点拖拽桩、列表分页。

***

### P4 · 闭环期：通知 + 存档 + 边缘

**目标**:收尾三件套骨架落盘,红点可冒泡、存档可切换、伪装可切换。

| 交付物                    | 规格       | 验收要点                      |
| :--------------------- | :------- | :------------------------ |
| 表14 通知公告 `.tscn + .gd` | 3 子界面场景树 | Toast队列/Modal弹窗/红点树 + 公告板 |
| 表16 系统存档 `.tscn + .gd` | 4 子界面场景树 | 存档槽位/确定性回放/GM沙盒/CDKey兑换   |
| 表17 边缘杂项 `.tscn + .gd` | 4 子界面场景树 | 身份伪装/精英突变/地面掉落/命名注册       |

**界面数**: 11 个

**测试策略**:触发 Toast/Modal 验证通知系统;切换存档槽位验证存档系统;点伪装按钮验证身份切换。

***

## 三、 界面数量总览与累计进度 (Screen Count by Phase)

|   期   | 系统数 | 界面数 | 累计界面 | 累计占比 |
| :---: | :-: | :-: | :--: | :--: |
| P0 地基 |  3  |  19 |  19  |  23% |
| P1 核心 |  3  |  20 |  39  |  46% |
| P2 世界 |  4  |  19 |  58  |  69% |
| P3 深度 |  4  |  15 |  73  |  87% |
| P4 闭环 |  3  |  11 |  84  | 100% |

***

## 四、 骨架施工标准 (Skeleton Construction Standards)

### 4.1 每个视图的「必含清单」

每个系统视图 (17 个) 必须包含以下 6 项,缺一不算"骨架打好":

1. **`.tscn`** **场景文件** — Godot Control 节点树,容器结构完整(不要求像素级美化,但层级要对);
2. **`.gd`** **脚本文件** — `extends Control`,有 `_ready()`,注册 Theme,绑定按钮信号;
3. **`_ready()`** **桩** — 加载 Theme、初始化 Mock 快照数据、连接按钮信号;
4. **Mock 数据注入** — 从 `GameConfig` 读默认值填充界面,确保打开即有内容;
5. **按钮点击反馈** — 每个可交互按钮都有 `pressed` 信号回调,至少切换一个视觉状态;
6. **回到主菜单入口** — 每个视图有返回按钮,可通过 ViewRouter 回到主 HUD。

### 4.2 每个界面的「必含清单」

每个子界面(84 个)在其所属系统视图内必须有:

1. **独立容器节点** — PanelContainer 或 ScrollContainer,可独立显示/隐藏;
2. **布局结构** — VBox/HBox/Grid 容器搭好内容骨架;
3. **Label/Button 占位** — 关键文案和按钮位置有节点,文案读配置表;
4. **状态枚举值** — 对应视图控制器的 enum 有对应条目,可切换显示。

### 4.3 基类改造规范

```gdscript
## 错误做法(当前状态):数据类,无法挂场景树
class_name AccountEntryView
extends RefCounted   # ❌ RefCounted 不能挂入场景树

## 正确做法:Control 节点,可挂场景树
class_name AccountEntryView
extends Control         # ✅ Control 是 Godot UI 的基类

func _ready() -> void:
    # 加载 Theme、读配置、连信号
    theme = preload("res://frontend/theme/kalar_theme.tres")
    _setup_mock_data()
    _connect_signals()
```

### 4.4 Theme 令牌与配置对齐规范

```gdscript
## 从 event_categories.json 动态读取配色
## 新增分类只需加配置,前端零改动
func get_category_color(category_name: String) -> Color:
    var categories := GameConfig.get_dict("infrastructure", "event_categories", {})
    for key in categories:
        var entry: Dictionary = categories[key]
        if entry.get("name", "") == category_name:
            return Color.html(entry.get("color", "#94a3b8"))
    return Color("#94a3b8")  # 兜底默认
```

***

## 五、 测试验收标准 (DoD Matrix)

### 5.1 单视图验收(每视图必过)

| 验收项     | 验收标准                                     | 验证方式                                          |
| :------ | :--------------------------------------- | :-------------------------------------------- |
| 场景存在    | 每个系统有对应 `.tscn` 场景文件                     | `ls frontend/views/*/*.tscn`                  |
| 基类正确    | 全部 `.gd` 继承 `Control`,无 `RefCounted`     | `rg "extends RefCounted" frontend/views/` 无命中 |
| 可挂载     | 场景可被 `ViewRouter.show_view("xxx")` 打开不报错 | 运行时验证                                         |
| Mock 数据 | 打开即有内容,无空白界面                             | 目视走查                                          |
| 点击反馈    | 所有按钮有 `pressed` 信号回调 + 视觉变化              | 逐按钮点击验证                                       |
| 配置驱动    | 无硬编码文案,全部读 `ui.json`                     | `rg '"登录"' frontend/views/` 仅命中配置读取           |
| 配色对齐    | 事件分类配色读 `event_categories.json`          | 删配置键验证回退默认色                                   |
| 零接线     | 不接入 EventBusCore（rg "EventBus" 子串门禁覆盖）,不调后端 API | `rg "EventBus" frontend/views/*/*.gd` 无命中     |

### 5.2 全链路验收(每期必过)

| 验收项      | 验收标准                  | 验证方式             |
| :------- | :-------------------- | :--------------- |
| 启动可达     | 冷启动 → 登录 → 主菜单 全链路可走通 | 运行时手动走查          |
| 视图切换     | 本期所有视图可从主菜单进入并返回      | 逐入口点击验证          |
| 无运行时报错   | Godot 输出窗口无 red error | 观察 Output 面板     |
| Theme 生效 | 所有界面使用统一主题,配色与分类对齐    | 目视走查 + 改配置验证实时生效 |
| 鼠标全交互    | 每个可交互组件可点击、有反馈        | 逐组件点击验证          |

### 5.3 全局验收(全期完成后)

1. **84/84 界面全覆盖** — 需求表中每个界面都有对应场景节点,无遗漏;
2. **零接线纪律** — 全部 17 个视图中无 `EventBusCore.get_instance()` 调用,无后端领域 API 引用;
3. **配置驱动** — 删除 `config/frontend/ui.json` 任一文案键值,界面回退兜底默认值,不崩溃;
4. **鼠标全可达** — 从启动页出发,鼠标可点击到达全部 84 个界面并返回;
5. **Theme 一致性** — 修改 `event_categories.json` 中任一分类颜色,对应界面配色实时变化。

***

## 六、 目录结构规划 (Target Directory Structure)

```
frontend/
├── theme/
│   └── kalar_theme.tres          # 全局主题资源(配色/字号/间距)
├── navigation/
│   ├── view_router.gd            # 视图路由 + 切换栈
│   └── view_registry.gd          # 17 视图注册表
├── views/
│   ├── main_dashboard.gd/.tscn   # (旧)过渡态演示仪表盘
│   ├── account_entry/
│   │   ├── account_entry_view.gd
│   │   └── account_entry_view.tscn
│   ├── main_hud/
│   │   ├── main_hud_view.gd
│   │   └── main_hud_view.tscn
│   ├── character_progression/
│   │   ├── character_progression_view.gd
│   │   └── character_progression_view.tscn
│   ├── combat_view/
│   │   ├── combat_view.gd
│   │   └── combat_view.tscn
│   ├── economy_trade/
│   │   ├── economy_trade_view.gd
│   │   └── economy_trade_view.tscn
│   ├── gacha_wish/
│   │   ├── gacha_wish_view.gd
│   │   └── gacha_wish_view.tscn
│   ├── quest_causality/
│   │   ├── quest_causality_view.gd
│   │   └── quest_causality_view.tscn
│   ├── mail_system/
│   │   ├── mail_system_view.gd
│   │   └── mail_system_view.tscn
│   ├── guild_social/
│   │   ├── guild_social_view.gd
│   │   └── guild_social_view.tscn
│   ├── world_map/
│   │   ├── world_map_view.gd
│   │   └── world_map_view.tscn
│   ├── monster_ecology/
│   │   ├── monster_ecology_view.gd
│   │   └── monster_ecology_view.tscn
│   ├── crafting_workshop/
│   │   ├── crafting_workshop_view.gd
│   │   └── crafting_workshop_view.tscn
│   ├── grimoire_authoring/
│   │   ├── grimoire_authoring_view.gd
│   │   └── grimoire_authoring_view.tscn
│   ├── notification_bulletin/
│   │   ├── notification_bulletin_view.gd
│   │   └── notification_bulletin_view.tscn
│   ├── settings_center/
│   │   ├── settings_center_view.gd
│   │   └── settings_center_view.tscn
│   ├── system_save/
│   │   ├── system_save_view.gd
│   │   └── system_save_view.tscn
│   └── misc_edge/
│       ├── misc_edge_view.gd
│       └── misc_edge_view.tscn
└── mocks/                        # 本地 Mock 快照数据(骨架专用,不进接线阶段)
    ├── character_mock.json
    ├── combat_mock.json
    ├── economy_mock.json
    └── ...
```

