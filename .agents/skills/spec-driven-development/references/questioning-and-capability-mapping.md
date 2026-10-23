# 逆向提问协议、系统设计质询题库与五层能力拓扑分解指南

> 本指南合并了逆向《提问的智慧》（Reverse ESR）协议、跨领域与宿主特化设计质询维度以及五层单向能力拓扑分解标准。

---

## 一、 逆向提问工程协议 (Reverse Smart Questioning Protocol)

| 《提问的智慧》原始法则 | 主 Agent 逆向内化准则 |
| :--- | :--- |
| **不要问 X-Y 问题**：描述目标而非手段 | **X-Y 问题侦测**：当用户指定脆弱或破坏分层解耦的局部手段（Y）时，探寻真实系统目标（X）并推荐合规架构选项。 |
| **描述客观症状而非猜测** | **四元组补全**：引导剥离主观猜测，补全【运行环境、触发输入、预期行为、真实报错堆栈】。 |
| **提供最小可复现示例 (MRE)** | **最小夹具确认**：面对复杂边界时，主动给出最简输入/输出夹具邀请用户确认。 |
| **精确描述、言之有物** | **单点渐进质询**：每次只问一个阻塞性决策点，给出 2~3 个带 `(Recommended)` 的候选项与权衡理由。 |

---

## 二、 核心设计质询维度清单（通用系统 + 宿主特化）

| 质询维度 | 通用系统质询焦点 | 宿主扩展 / 引擎特化焦点（VS Code / Godot） |
| :--- | :--- | :--- |
| **1. 交互形态与打扰度** | 作为直接 API、CLI 命令、事件触发还是后台常驻服务？结果是静默返回还是同步阻塞？ | 仅放 Command Palette、状态栏常驻还是右键菜单？通知采用轻量状态栏更新还是弹窗？是否禁止后台抢夺光标焦点？ |
| **2. 存储与作用域边界** | 配置与状态是全局共享还是单会话隔离？何时过期淘汰？异常退出如何幂等恢复？ | 全局用户配置（Global Settings）还是单工作区隔离（Workspace）？跨窗口并发写入如何经 Journal + `.tmp` 原子合并？ |
| **3. 性能与资源预算** | 极限数据条数与吞吐量预期是多少？超限何时触发退化短路？ | 大型单体仓库（文件数 $> 50,000$）是否跳过 `.gitignore`？高频帧循环是否预分配对象池（`ADV-PRF-002`）？ |

---

## 三、 五层单向能力拓扑分解 (Capability Mapping)

复杂需求自底向上统一拆解为五个正交能力层，箭头严格单向向下（上层可依赖下层，下层严禁反向 import 上层 `DEP-INV-001`）：

| 层级 | 通用架构角色 | VS Code 扩展映射 (`workspace-timing`) | Godot / 内核映射 (`WebGames` / `fractal-git`) |
| :---: | :--- | :--- | :--- |
| **L1** | **Shared / Contract 层**：纯数据类型、量纲烙印、常量与错误枚举（零外部依赖） | `shared/`（双语字典与契约类型） | `fg-core` / `config/domains/` 数据契约 |
| **L2** | **Persistence / Storage 层**：文件系统、RingBuffer、Append-Only Journal、CAS 对象库 | `storage/`（RingBuffer + Journal 协调器） | `fg-storage` / `AccountDiskRepository` |
| **L3** | **Core / Engine 层**：纯业务计算、算法状态机、规则评估（100% 可脱机内存单测） | `engine/`（时间聚合器与跨午夜切分） | `fg-algorithms` / 后端无头领域求解器 |
| **L4** | **Application / Controller 层**：生命周期监听、命令编排、异步派发器排空 | `controller/`（事件防抖与调度） | `taxis_cmd` / `WorldGateway` 与会话协调 |
| **L5** | **Interface / Presentation 层**：CLI 入口、Webview 面板、HUD 单向快照视图 | `ui/`（状态栏与 Webview 仪表盘） | `frontend/views/`（纯 `apply_snapshot` 视图） |
