# 游戏退出流程实现审查报告 (AUDIT_REPORT_退出流程审查)

> **审查基准版本**：WebGames (Godot 4.7) / Phase 57 契约收口完成后  
> **审查目标链路**：`前端退出页面 → 用户触发退出 → 前端退出请求/状态切换 → 后端接收退出指令 → 游戏运行实例停止 → 相关运行资源释放 → 状态最终确认 → 前端完成退出流程`  
> **审查原则**：事实求是、零臆测、按真实代码逐行核查，明确职责边界与依赖，仅做审查，不越权编码。

---

## 1. 当前实现状态

```text
已实现：
  - [单机底层持久化原子写与SHA-256完整性校验]：SaveManager (backend/infrastructure/save_manager.gd:48-112) 具备完整的原子写（.tmp -> .bak -> rename）与 SHA-256 签名校验机制，可作为退出保存的可靠底层。
  - [跨域存档组装器]：GameSaveAssembler (backend/domains/persistence_protocol/save_assembler.gd:29-43) 具备收集全域序列化数据并构建 payload 的标准方法。
  - [会话注销能力基建]：AuthService (backend/domains/account/auth_service.gd:126-136) 具备 revoke_token() 与 clear_sessions() 的单机静态实现。
  - [前端国际化退出文本定义]：ui.json 中已配置 "ui.fe02.battle_log.exit_game" 词条，UIIntermediary 可正常解析文案。

部分实现：
  - [HUD 菜单退出按钮触发]：MainHUDView (frontend/views/main_hud/main_hud_view.gd:63, 670-671) 存在 _menu_btn_exit 控件与其点击回调 _on_menu_exit_pressed()，但该回调仅向战报聊天框输出一条本地系统文本，未发起退出确认弹窗，未调用任何后端通信或状态变更。
  - [引擎主循环状态栈]：GameLoopStateStack (backend/infrastructure/game_loop_fsm.gd:10-18) 定义了 7 种引擎状态并支持序列化，但枚举仅覆盖到 COMBAT/SETTLEMENT/PAUSED_MODAL，缺失退出态，且在运行时未被作为全局单例调度。

未实现：
  - [前端退出确认模态框/退出过渡页面]：缺失二次确认对话框（防误触）、保存中遮罩（Saving Overlay）、退回登录页/退回桌面的路由编排。
  - [OS 窗口关闭事件拦截]：全库对 NOTIFICATION_WM_CLOSE_REQUEST 的监听与处理为 0；用户点击窗口右上角“X”时直接被引擎强制中断，无法执行优雅退出与数据保存。
  - [退出 API 协议与契约端点]：contracts.json (config/infrastructure/contracts.json) 中无任何关于 EXIT、STOP、SHUTDOWN 的契约端点；无对应 Request/Response DTO。
  - [游戏生命周期管理与停机状态机]：无权威生命周期管理器（LifecycleManager），缺失 Running → Stopping → Stopped 的状态机约束；GameBootstrap (backend/infrastructure/game_bootstrap.gd) 仅有 assemble()，完全缺失 teardown() / shutdown() 逆向释放接口。
  - [世界网关逆向退出跃迁]：WorldGatewayFSM (backend/domains/world_gateway/world_gateway_fsm.gd:17-103) 状态终止于 IN_WORLD (阶段 7)，不存在 exit_world、logout 等逆向离开状态。
  - [状态与反馈闭环]：无停机进度反馈、无保存状态异步回执，全库生产代码中未调用过 get_tree().quit()。

存在问题：
  - [假退出无实质行为]：用户在 MainHUD 点击退出后，除了一行文字日志外没有任何实质动作，造成“退出按钮无效”的严重体验问题。
  - [数据丢失高危敞口]：因 OS 窗口直接关闭未受保护、手动退出未触发 SaveManager，所有内存运行时进度在关闭时必然丢失。
  - [单例常驻与脏状态残留]：GameBootstrap 静态变量（_catalog, _magic_registry, _ground_loot_listener 等）与 EventBus 单例无卸载清理机制，重进游戏将产生脏数据与重复事件监听。
  - [表现层与底层直连债务]：main_dashboard.gd 直接 new 了后端 5 个领域实体，存在早期架构违规直接调用的历史技术债务。
```

---

## 2. 当前架构调用链

### 当前实际代码调用情况（断裂与本地孤岛）

```text
[用户行为]
   │
   ├─► 点击 MainHUD "退出" 按钮
   │     ↓
   │   MainHUDView._on_menu_exit_pressed() (main_hud_view.gd:670)
   │     ↓
   │   UIIntermediary.text("ui.fe02.battle_log.exit_game") (ui_intermediary.gd:54)
   │     ↓
   │   MainHUDView.append_battle_log() (main_hud_view.gd:606)
   │     ↓
   │   [调用链终止：仅本地富文本框追加一条字符串，无网络/无契约/无生命周期流转]
   │
   └─► 点击 OS 窗口右上角 "X" 关闭
         ↓
       [Godot 原生默认处理：进程被操作系统无条件杀死，0 行脚本介入，0 字节保存]
```

### 理论应有架构调用链（目标规范）

```text
前端页面 (MainHUD / ExitConfirmDialog)
  ↓ (调用)
API 契约层 (ContractRegistry / ExitCommandDTO)
  ↓ (分发)
Application/Service (GameLifecycleService / SessionCoordination)
  ↓ (编排)
Lifecycle Manager (GameLifecycleFSM: RUNNING → STOPPING → STOPPED)
  ↓ (串联释放)
Resource Manager (SaveManager落盘 ➔ EventBus注销 ➔ AuthService会话清理 ➔ GameBootstrap反装配)
  ↓ (状态回执)
前端收到完成回执 ➔ ViewRouter 切至 Splash/Login 或 get_tree().quit() 安全退进程
```

---

## 3. 依赖关系

| 模块 / 角色 | 依赖谁 | 被谁依赖 | 是否合理 | 是否需要调整 | 调整建议 / 目标接口 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **MainHUDView**<br>(`frontend/views/main_hud/`) | `UIIntermediary`<br>`ThemeManager` | `ViewRouter` (场景切换)<br>用户点击事件 | **不合理** (当前仅本地假日志) | **需要调整** | 剥离退出交互至独立确认模态框，接入标准退出指令分发。 |
| **UIIntermediary**<br>(`frontend/i18n/`) | `UITextResolver`<br>`PlaceholderFiller` | `MainHUDView`<br>各前端视图 | **合理** (仅文本编排) | 保持现状 | 仅用于退出弹窗文案解析。 |
| **Exit API / 契约层**<br>(*待建*) | `ContractRegistry`<br>`DTO 校验器` | 前端页面 / 退出控制器 | **尚未实现** | **必须新建** | 建立 `CMD_STOP_GAME` 契约端点，规范请求/响应结构。 |
| **GameLifecycleService**<br>(*待建*) | `GameLifecycleFSM`<br>`SaveManager`<br>`AuthService` | API 契约层 | **尚未实现** | **必须新建** | 退出用例门面服务，编排保存、清理、停机次序。 |
| **GameLoopStateStack**<br>(`backend/infrastructure/`) | `EventBus` | 仅单元测试 / 局部孤立调用 | **不合理** (脱离主循环，缺退出态) | **需要调整** | 扩展 `STOPPING`、`STOPPED` 枚举，或与全局生命周期体系合流。 |
| **WorldGatewayFSM**<br>(`backend/domains/world_gateway/`) | `EventBus`<br>`GameModeRoutingSolver` | 进世界调用方 | **不合理** (单向无逆向退网关) | **需要调整** | 增加 `exit_world()` 跃迁，允许退回 `AUTHENTICATED` 状态。 |
| **SaveManager**<br>(`backend/infrastructure/`) | `DirAccess`<br>`FileAccess`<br>`GameConfig` | `test_persistence_protocol.gd`<br>(生产退出未挂接) | **合理** (纯粹持久化原子工具) | **需要挂接** | 由生命周期停机链在进入 `STOPPING` 态时显式调用。 |
| **AuthService**<br>(`backend/domains/account/`) | `GameConfig`<br>`DeterministicRNG` | 鉴权各方<br>(退出未挂接) | **合理** (会话管理独立) | **需要挂接** | 停机时由生命周期管理器调用 `revoke_token()` 销毁当前会话。 |
| **GameBootstrap**<br>(`backend/infrastructure/`) | `ItemLoaderPipeline`<br>`MagicTierRegistry` | 引擎入口 / 测试套件 | **不合理** (只进不出，静态单例永驻) | **需要调整** | 补充 `teardown()`，重置静态单例，解绑全局常驻监听器。 |
| **MainDashboard**<br>(`frontend/views/`) | `WorldClockMaster`<br>`WearableInventoryAggregate` 等 | 场景宿主 | **严重不合理** (直接 new 领域实体) | **建议重构** | 历史技术债务，在后续重构中解耦为只读 DTO 表现宿主。 |

---

## 4. 参数分类

### 参数归属对照表

| 参数 / 状态 | 来源 | 类型 | 是否硬编码 | 是否配置驱动 | 是否 API 参数 | 所属模块 / 阶段 | 治理说明 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `shutdown_timeout_seconds` | 配置表 | `float` | 否 | **是** | 否 | `GameLifecycleManager` | 停机超时阈值，默认 5.0 秒，超时触发降级强制终止。 |
| `force_kill_timeout_seconds` | 配置表 | `float` | 否 | **是** | 否 | `GameLifecycleManager` | 强制终止等待时间，默认 2.0 秒。 |
| `auto_save_on_exit` | 配置表 | `bool` | 否 | **是** | 否 | `GameLifecycleService` | 退出时是否强制自动存盘，默认 `true`。 |
| `save_flush_timeout_seconds` | 配置表 | `float` | 否 | **是** | 否 | `SaveManager` 调度层 | 存档落盘等待最长耗时，默认 3.0 秒。 |
| `allow_cancel_exit` | 配置表 | `bool` | 否 | **是** | 否 | 前端退出弹窗控制器 | 是否允许玩家在退出弹窗中点击“取消”，默认 `true`。 |
| `session_token` | 前端请求 | `String` | 否 | 否 | **是** | API 退出请求 DTO | 当前发起退出的会话凭证，用于鉴权与会话注销。 |
| `exit_reason` | 前端请求 | `String` | 否 | 否 | **是** | API 退出请求 DTO | 退出原因枚举（如 `USER_QUIT`, `LOGOUT_TO_MENU`, `DESKTOP_QUIT`）。 |
| `idempotency_key` | 前端请求 | `String` | 否 | 否 | **是** | API 退出请求 DTO | 客户端生成的防重请求 UUID，防止连续点击多次停机。 |
| `save_slot_id` | 前端请求 | `String` | 否 | 否 | **是** | API 退出请求 DTO | 退出时指定要回写的存档槽位标识。 |
| `LifecyclePhase` 枚举 | 结构体 | `enum` | **是** | 否 | 否 | `GameLifecycleModel` | `RUNNING`, `STOPPING`, `STOPPED`, `STOP_FAILED`，代码结构常量。 |
| `ExitErrorCode` 枚举 | 结构体 | `enum` | **是** | 否 | 否 | 契约层错误码规范 | `ALREADY_STOPPING`, `SAVE_FAILED`, `TIMEOUT`，协议结构约束。 |
| `current_lifecycle_state` | 内部状态 | `int` | 否 | 否 | 否 | `GameLifecycleManager` | 运行时动态持有，写权限严格收敛在生命周期管理器内部。 |
| `is_save_completed` | 内部状态 | `bool` | 否 | 否 | 否 | 停机流程上下文 | 运行时状态标志，记录关键领域数据是否已安全落盘。 |

- **硬编码参数归属**：仅保留状态枚举与协议不可变结构码；严禁在代码中写死超时秒数与默认重试次数。
- **配置驱动参数归属**：新建 `config/infrastructure/lifecycle.json` 集中治理停机、持久化与防死锁配置。
- **API 参数归属**：仅暴露会话凭据、操作原因与槽位标识；严禁将内部 Worker、线程句柄暴露给 API。

---

## 5. 边界问题专项检查（18 项场景）

| # | 边界场景 | 检查结果 | 当前处理位置与代码现状 | 潜在影响与风险说明 |
| :-: | :--- | :---: | :--- | :--- |
| 1 | 用户连续点击退出 | **[未处理]** | `main_hud_view.gd:670-671` 仅直连 `append_battle_log`，无防抖，无按钮禁用。 | 若接入真实请求将造成重复发送、并发停机竞争。 |
| 2 | 前端重复发送退出请求 | **[未处理]** | 全库无退出 API，无 `idempotency_key` 去重过滤器。 | 容易造成后端重复触发保存，引发文件锁竞争或覆盖。 |
| 3 | 网络中断（联机模式） | **[未处理]** | 单机模式暂无，联机权威同步存根 `authority_sync_stub.gd` 为空实现。 | 断网时无法向远端服务发送注销，导致远端玩家幽灵挂机。 |
| 4 | 后端已停止但前端仍发退出 | **[未处理]** | 缺失退出请求校验层。 | 状态不一致，前端可能接收到未捕获的 null 异常或无响应。 |
| 5 | 后端正在停止时再次请求 | **[未处理]** | 缺失 `STOPPING` 运行态锁与拦截机制。 | 并发调用会破坏正在执行的 I/O 流程或重复销毁单例。 |
| 6 | 游戏实例异常退出 (Crash) | **[未处理]** | 无异常捕获钩子，未接入 CrashHandler 或未完成事务恢复。 | 崩溃直接闪退，未落盘进度完全损毁。 |
| 7 | 某个资源释放失败 | **[未处理]** | 无 teardown 链条，无错误隔离（try/catch 式保护）。 | 一个资源的释放异常会导致整条停机链死锁，进程无法关闭。 |
| 8 | 部分资源释放、部分未释放 | **[存在风险]** | 静态单例互不感知，无原子化回滚或兜底清退。 | 内存泄漏，且如果再次重登会产生半初始化状态。 |
| 9 | 停止超时 (I/O 或协程阻塞) | **[未处理]** | 无异步等待超时计时器，无生命周期 watchdog。 | 进程在后台处于僵死状态（Zombie Process），界面卡死。 |
| 10 | 强制停止失败 | **[未处理]** | 未定义二级强制杀死（Force Kill / `quit(1)`）降级路径。 | 遇到死锁时用户只能借助任务管理器强杀进程。 |
| 11 | 前端退出页面刷新 (Web/F5) | **[未处理]** | 无 `JavaScriptBridge` 或 window 级 `beforeunload` 挂接。 | Web 端刷新直接中断游戏，未保存进度丢失。 |
| 12 | 浏览器/客户端直接关闭 | **[未处理]** | 全库对 `NOTIFICATION_WM_CLOSE_REQUEST` 监听数为 **0**。 | **最高风险项**：点击右上角“X”强制关窗，直接绕开所有存盘逻辑。 |
| 13 | Session 已失效 | **[部分处理]** | `auth_service.gd:103-124` 能识别 `TOKEN_EXPIRED`，但退出链路未接入。 | 失效 Session 调用注销会报错误码，需要作为安全幂等处理。 |
| 14 | Game Instance 已不存在 | **[未处理]** | 采用全局常驻单例，未做多实例容器化管理。 | 单机静态架构下虽无多实例问题，但无法支持热重启。 |
| 15 | API 返回成功但后台未完 | **[存在风险]** | 未建立等待存盘落盘完成（Flush Complete）的同步栅栏。 | 若 API 提前通知前端退进程，操作系统可能截断正在写入的磁盘文件。 |
| 16 | 多请求操作同一游戏实例 | **[未处理]** | 实例无并发操作锁（Mutex 或单线程请求队列）。 | 多事件源同时触发退出可能造成重入冲突。 |
| 17 | 服务重启后残留状态 | **[部分处理]** | `save_manager.gd:15-17` 具备 `.tmp`/`.bak` 校验，但内存变量同进程不重置。 | 在运行单测或返回主菜单二次进世界时产生数据污染。 |
| 18 | 配置缺失或配置非法 | **[部分处理]** | `GameConfig` 有兜底机制，但目前无任何退出相关配置项。 | 需要在 `config/` 中补齐 schema 与基线校验。 |

---

## 6. 性能问题

1. **退出保存同步阻塞主线程风险**：
   - 当前 `GameSaveAssembler.build_save_payload` 与 `SaveManager.save_game` 全量在主线程同步进行，包含全域字典深度遍历与 SHA-256 全文哈希计算。
   - **影响**：若角色身上道具及全域状态极多，在退出时直接在主线程做原子写入会导致画面冻结 100~500ms，甚至出现系统“无响应”提示。应提供平滑的停机过渡动画或状态反馈。
2. **事件总线无解绑造成的内存悬挂**：
   - 全局单例 `EventBus` (`event_bus.gd:34-40`) 与 `_ground_loot_listener` (`game_bootstrap.gd:42`) 建立连接后无生命周期管理。
   - **影响**：退出世界退回登录页时，旧场景节点如果被释放，EventBus 发出信号可能触发对已释放对象的野指针错误（Invalid Call to freed object），或导致监听器在整个应用生命周期中不断泄漏。
3. **缺少异步停机 Watchdog**：
   - 依赖全流程无卡顿，一旦任何下游聚合序列化死循环或文件读写受阻，主循环陷入死等待。
   - **影响**：必须引入基于系统时钟的轻量 Watchdog 定时器，保证超出时间阈值时强行熔断退出。

---

## 7. 重构建议分级

### 【必须修改】（阻塞正式发布与可靠运行的 P0 级基石）

1. **接入 OS 窗口关闭拦截**：
   - 在应用入口根节点监听 `Node.NOTIFICATION_WM_CLOSE_REQUEST`，捕获操作系统的关闭信号，执行拦截、唤起退出流程并安全存盘，完成后再显式调用 `get_tree().quit()`。
2. **建立生命周期状态机与服务**：
   - 新建 `GameLifecycleFSM`，确立权威状态迁移：  
     `RUNNING → STOPPING → [SAVE_FLUSHING] → STOPPED`；定义非法跃迁防护与单向写权限。
3. **编排资源释放与存盘链路**：
   - 建立停机编排器，顺序执行：阻止新输入 ➔ 触发全域数据持久化落盘（`SaveManager`） ➔ 会话凭证销毁（`AuthService.revoke_token`） ➔ 单例与事件解绑（`GameBootstrap.teardown`）。
4. **前端退出确认弹窗与交互防抖**：
   - 替换 `main_hud_view.gd` 中的假退出日志，封装模态确认对话框（Confirm Dialog），增加“确认中”状态禁用按钮，防止连击。

### 【建议修改】（符合规范工程架构与可维护性的 P1 级治理）

1. **契约注册表录入生命周期协议**：
   - 在 `config/infrastructure/contracts.json` 中录入生命周期相关契约（如 `CMD_STOP_GAME`、`EVENT_LIFECYCLE_CHANGED`），定义严格的 DTO 规范。
2. **配置驱动参数收口**：
   - 创建 `config/infrastructure/lifecycle.json`，配置超时时间（`shutdown_timeout_seconds`）、自动保存策略（`auto_save_on_exit`）等，接入 `audit_config.py` 与 Schema 校验。
3. **`GameBootstrap` 补充对称反装配接口**：
   - 增加 `GameBootstrap.teardown()` 静态方法，使启动装配与关机销毁形成完整的对称生命周期，消除静态变量与事件总线污染。

### 【可以暂缓】（后续长期演进或联机模式启用的 P2 级项）

1. **Web 端特定生命周期适配**：
   - 针对 HTML5 / Web 导出平台的 `beforeunload` 挂接与离线同步缓存策略，可待 Web 专属发布阶段实施。
2. **跨服/多实例分布式停机通知**：
   - 服务端权威模式下的房间离线广播与集群状态同步，目前单机/文字版阶段无需过度设计。
