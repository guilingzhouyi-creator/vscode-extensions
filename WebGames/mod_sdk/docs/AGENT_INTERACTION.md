# 卡拉尔世界引擎 · Agent 交互推演协议与无头评测指南 (Agent Interaction Protocol)

> [!NOTE]
> **【协议定位与目标】**
> 本指南定义了卡拉尔世界引擎与外部自动化评测 Agent、自主决策推演模型以及黑盒集成流水线之间的流式交互协议。基于标准输入输出 (`stdio`) 与行定界 JSON (NDJSON)，外部 Agent 能够以完全无头（Headless）的方式开展单步剧情观察、分支决策探索、因果回溯排查与生成权威战报。

---

## 一、 通道管道与通信协议规范 (Channel Protocol)

推演通信建立在进程间标准输入输出通道之上，具备跨平台、低开销、零外部网络依赖等特性。

### 1. 启动命令与命令行参数

外部 Agent 进程通过子进程方式唤起推演引擎内核：

```bash
python mod_sdk/tools/play_mod.py <mod_dir_1> [mod_dir_2 ...] --interactive [--json]
```

#### 关键参数表：
- `<mod_dirs...>`：一个或多个待联合装配推演的模组物理目录路径；
- `--interactive`：【核心开关】激活交互式单步会话模式，挂起批处理推演，等待来自 `stdin` 的动作指令；
- `--json`：强制要求全程输出纯净 NDJSON 数据包，抑制所有人类可读彩色控制台格式化字符；
- `--race <RACE_ID>`：（可选）指定创角种族（如 `HUMAN`, `ELF`，缺省自动解析或继承）；
- `--origin <ORIGIN_ID>`：（可选）指定创角身世标识符；
- `--seed <STRING>`：（可选）设置确定性伪随机数种子，保障同参探索 100% 可重现。

### 2. 编码与防死锁缓冲公理 (I/O & Flush Invariants)

1. **UTF-8 全程保证**：通道两端的所有字符传输必须统一采用 UTF-8 编码，彻底杜绝 Windows GBK 环境下的转义损毁；
2. **行定界 JSON (NDJSON)**：每个发往 `stdin` 的行动包（Action）与每个由 `stdout` 吐出的观察包（Observation）必须占用且仅占用单行文本，以换行符 `\n` 作为完整包定界符；
3. **即时清空刷新 (Immediate Flush)**：推演引擎与 Agent 在写入每个完整 JSON 行后，必须立即显式调用流刷新操作（如 Python 的 `sys.stdout.flush()`）。严禁因管道行缓冲机制导致会话死锁挂起。

---

## 二、 观察-行动单步流转时序 (Observation-Action Flow)

推演会话生命周期严格遵从确定性因果状态机模型：

```mermaid
sequenceDiagram
    autonumber
    participant Agent as 外部评测 Agent / LLM
    participant Engine as play_mod.py (推演核心内核)

    Agent->>Engine: 启动进程: play_mod.py ./my_mod --interactive --json
    Engine->>Engine: 1. 静态预检与多包冲突裁决
    Engine->>Engine: 2. 创角面板解算 (六维属性/因果天赋/行囊)
    Engine->>Engine: 3. 路由规则匹配，定位起始 DAG 入口节点
    Engine-->>Agent: 【第 0 步观察包】(Step 0 Observation)
    
    loop 循环推进决策步进
        Agent->>Engine: 【行动指令】{"action": "choose", "choice_id": "NODE_EXPLORE"}
        Engine->>Engine: 1. 门禁校验: 分支目标是否在 available_choices 中
        alt 分支合法
            Engine->>Engine: 2. 因果突变结算 (mutations_on_complete)
            Engine->>Engine: 3. 当前状态生成快照，压入历史回溯栈
            Engine->>Engine: 4. 推进至下一节点，水化本地化文案
            Engine-->>Agent: 【最新观察包】(Step N Observation, is_terminal=false)
        else 分支非法或不存在
            Engine-->>Agent: 【纠偏观察包】(Step N Observation, error_code="ERR_INVALID_CHOICE")
        end
    end

    opt 因果回溯探索
        Agent->>Engine: 【回滚指令】{"action": "rollback"}
        Engine->>Engine: 弹出栈顶历史快照，还原角色面板与前序节点
        Engine-->>Agent: 【还原观察包】(Step N-1 Observation)
    end

    Engine->>Engine: 抵达 TERMINAL_EXIT 节点 (或接收到 quit 指令)
    Engine-->>Agent: 【终态观察包】(is_terminal=true)
    Engine-->>Agent: 【权威结构化战报】(kalar.mod_sdk.playthrough_transcript.v1)
```

---

## 三、 数据契约结构详解

### 1. 观察包结构 (`kalar.mod_sdk.observation.v1`)

引擎向 Agent 派发的单步快照，详见 `mod_sdk/schemas/observation.schema.json`：

```json
{
  "schema_version": "kalar.mod_sdk.observation.v1",
  "session_id": "sess_8f3a9e21",
  "step_index": 0,
  "current_node_id": "NODE_ENTRY",
  "node_type": "START_ENTRY",
  "narrative_key": "frontier.awakening",
  "text_source": "i18n",
  "hydrated_text": "年轻的冒险者 瓦兰之剑 从边境哨所的石榻上醒来，窗外风雪呼啸。",
  "available_choices": [
    "NODE_STEP_EXPLORE",
    "NODE_STEP_REST"
  ],
  "character_snapshot": {
    "player_name": "瓦兰之剑",
    "race": "HUMAN",
    "origin_id": "IMPERIAL_NOBLE",
    "attributes": {"STR": 4, "CON": 3, "INT": 5, "AGI": 3, "SPR": 3, "VIT": 3},
    "hp": 100,
    "max_hp": 100,
    "gold": 500
  },
  "applied_mutations": [
    {"type": "CharacterCreated"},
    {"type": "LocationAssigned"}
  ],
  "history_depth": 0,
  "is_terminal": false,
  "error_code": null
}
```

### 2. 行动包指令结构 (`kalar.mod_sdk.action.v1`)

Agent 经由 `stdin` 下发的决策包，支持三种核心指令：

#### A. 分支推进 (`choose`)
```json
{
  "action": "choose",
  "choice_id": "NODE_STEP_EXPLORE"
}
```
*注：`choice_id` 支持传入目标节点 ID 字符串，亦兼容整数索引（如 `0`, `1`）。*

#### B. 历史状态回退 (`rollback`)
```json
{
  "action": "rollback"
}
```
*注：弹出历史栈顶，精准回退至上一决策点。若历史栈为空（处于第 0 步），引擎将返回带有 `ERR_ROLLBACK_EMPTY_STACK` 的观察包，状态保持不变。*

#### C. 主动提前终止 (`quit`)
```json
{
  "action": "quit"
}
```
*注：指示推演引擎立刻截断推演，对当前已有历程进行归档并生成战报。*

---

## 四、 分支探索策略与自动化测试模式

外部评测工具与 Agent 可以基于交互接口实现多样化的探索策略：

1. **贪心首选探索 (Greedy DFS / `first`)**：
   - 每次均选择 `available_choices[0]`，用于快速建立模组基线冒烟测试（Smoke Test）；
2. **随机蒙特卡洛探索 (Random Exploration)**：
   - 依据传入的 `--seed`，在各分支节点执行伪随机挑选，多批次运行以发掘边缘条件下的断裂路径；
3. **基于回溯的图全覆盖遍历 (Exhaustive Branch Coverage via Rollback)**：
   - 利用深度优先结合 `rollback` 指令：当抵达某一叶子节点（`TERMINAL_EXIT`）后，连续执行 `rollback` 回退至具备未探索出边的分支节点，选择另一 `choice_id` 继续探索，直至整张因果图的所有边覆盖率达到 100%。

---

## 五、 结构化战报规范 (`playthrough_transcript.v1`)

当推演抵达终态（`TERMINAL_EXIT`）或收到终止退出指令时，引擎将输出全量结构化战报 JSON。战报完整记录了因果演进轨迹，可直接用于自动化 CI/CD 评测与断言判定：

```json
{
  "schema_version": "kalar.mod_sdk.playthrough_transcript.v1",
  "status": "COMPLETED",
  "seed": "SEED_TEST_2026",
  "summary": {
    "total_steps": 5,
    "unique_nodes_visited": 5,
    "total_choices_made": 4,
    "rollbacks_performed": 0,
    "unresolved_placeholders_count": 0,
    "errors_encountered": 0
  },
  "initial_character": {
    "player_name": "瓦兰巡林者",
    "race": "HUMAN",
    "origin_id": "IMPERIAL_NOBLE",
    "attributes": {"STR": 4, "CON": 3, "INT": 5, "AGI": 3, "SPR": 3, "VIT": 3}
  },
  "final_character": {
    "player_name": "瓦兰巡林者",
    "gold": 650,
    "applied_mutations": ["PrologueCompleted"]
  },
  "timeline_steps": [
    {
      "step_index": 0,
      "node_id": "NODE_ENTRY",
      "text": "年轻的冒险者在哨所醒来。",
      "choice_taken": "NODE_STEP_EXPLORE"
    },
    {
      "step_index": 1,
      "node_id": "NODE_STEP_EXPLORE",
      "text": "你踏雪深入林地，发现了一处被遗弃的符文遗迹。",
      "choice_taken": "NODE_EXIT"
    }
  ],
  "verification_assertions": {
    "has_dangling_edges": false,
    "reached_terminal_cleanly": true,
    "all_placeholders_hydrated": true
  }
}
```

### 自动化测试度量标准：
- **`status` 必须为 `"COMPLETED"`**：验证剧情图无悬空死胡同；
- **`unresolved_placeholders_count` 必须为 `0`**：验证文本中没有任何遗漏插值的未决花括号占位符；
- **`reached_terminal_cleanly` 必须为 `true`**：验证因果突变结算链条完整发布。

---

## 六、 主页 HUD 结构化遥测交互与动态行动空间协议 (Home HUD Telemetry & Action Space)

从引擎 Phase 118~120 演进起，外部评测 Agent 与自主推演模型不仅支持序章 DAG 推进，更全面接入**主页 HUD 去表现化结构化切片流与专属逻辑输入通道**。

### 1. 交互流转时序与双轨通信架构

```mermaid
sequenceDiagram
    autonumber
    participant Agent as 外部决策 Agent / LLM
    participant Channel as AgentActionChannel (专属输入通道)
    participant Engine as 主页 HUD 运行时内核 (AuthoritativeHudSyncService)
    participant Bus as CompanionObserverBus (伴侣观察总线)

    Engine->>Engine: 聚合主页 HUD 权威快照并求解因果差分
    Engine->>Bus: 广播 agent_hud_packet_streamed 事件
    Engine-->>Agent: 下发标准原子遥测包 (kalar.mod_sdk.hud_telemetry.v1)

    alt 人类前台正在交互 (is_writable=false)
        Agent->>Agent: 识别 control_lease.agent_control_mode="READ_ONLY_OBSERVER"
        Agent->>Agent: 挂起动作发射，保持纯观测态 (零硬件争抢)
    else 处于空闲决策窗口 (is_writable=true)
        Agent->>Channel: 发射动作指令 (kalar.mod_sdk.agent_action.v1)
        Channel->>Channel: 校验 sequence_index 与前置条件
        Channel->>Engine: 零硬件输入争抢，直投领域用例执行
        Engine->>Engine: 结算业务逻辑与状态突变
        Engine-->>Agent: 下发下一帧递增 sequence_index 的遥测包
    end
```

### 2. 标准原子遥测数据包结构 (`kalar.mod_sdk.hud_telemetry.v1`)

主页 HUD 遥测包由信封元数据、控制权租约、纯净上下文观测、单步因果差分流及动态行动空间五大板块组成，详见 `mod_sdk/schemas/agent_hud_telemetry_packet.schema.json`：

```json
{
  "envelope": {
    "protocol_version": "1.0.0",
    "packet_id": "pkt_1791806400120_1",
    "sequence_index": 1,
    "timestamp_ms": 1791806400120,
    "domain": "HOME_HUD",
    "is_terminal": false,
    "control_lease": {
      "human_interaction_state": "IDLE",
      "agent_control_mode": "READ_WRITE",
      "active_operator": "IDLE",
      "is_writable": true,
      "preempted_by_human": false
    }
  },
  "observation": {
    "character_identity": { "character_id": "char_001", "character_name": "瓦兰之剑" },
    "physiology_status": { "hp_current": 100.0, "hp_max": 100.0, "ap_current": 10.0, "ap_max": 10.0 },
    "wallet_asset": { "wallet_gold": 500, "unallocated_potential_points": 2 },
    "calendar_environment": { "calendar_days": 1, "day_phase_key": "DAY" },
    "feature_access": { "game_mode": 0, "show_matchmaking": false },
    "active_quests": [],
    "ui_notices": []
  },
  "causal_deltas": [
    {
      "delta_type": "STAT_MUTATION",
      "field_key": "wallet_gold",
      "previous_value": 450,
      "current_value": 500,
      "numeric_delta": 50.0,
      "cause_event": "QUEST_REWARD",
      "initiator": "SYSTEM_TICK_SIMULATION"
    }
  ],
  "action_space": [
    {
      "directive_id": "ALLOCATE_POTENTIAL_STAT",
      "domain": "ASSET",
      "description": "分配未分配潜能点至基础属性",
      "cost_payload": { "potential_points": 1 },
      "preconditions": { "unallocated_points_min": 1 },
      "allowed_parameters": { "stat_target": ["STR", "AGI", "INT", "STA"] },
      "is_executable": true,
      "blocked_reason": ""
    }
  ]
}
```

### 3. 专属逻辑动作通道指令包 (`kalar.mod_sdk.agent_action.v1`)

Agent 经由专属逻辑动作通道（`AgentActionChannel`）提交上行决策，彻底杜绝与人类键鼠发生硬件争抢。详见 `mod_sdk/schemas/agent_action_packet.schema.json`：

```json
{
  "session_id": "sess_8f3a9e21",
  "sequence_index": 1,
  "directive_id": "ALLOCATE_POTENTIAL_STAT",
  "params": {
    "stat_target": "STR",
    "points": 1
  },
  "origin_packet_id": "pkt_1791806400120_1",
  "agent_signature": "model_gemini_pro",
  "client_timestamp_ms": 1791806400125
}
```

#### 7 大动态行动空间指令规格表：

| 指令 ID (`directive_id`) | 所属域 | 核心语义 | 代价载荷 (`cost_payload`) | 前置条件 (`preconditions`) | 参数值域 (`params`) |
| :--- | :---: | :--- | :--- | :--- | :--- |
| `ALLOCATE_POTENTIAL_STAT` | `ASSET` | 分配未分配潜能点至基础属性 | `{"potential_points": 1}` | `unallocated_points_min >= 1` | `stat_target`: `STR/AGI/INT/STA` |
| `REST_AND_ADVANCE_TIME` | `RETENTION` | 在安全宿屋休息推进时相并恢复体能 | `{"ap": 2.0}` | `ap_min >= 2.0` | 无 |
| `CLAIM_QUEST_OBJECTIVE` | `ACTION` | 交付当前达标的任务目标并领取报酬 | 无 | `quest_completable == true` | 无 |
| `INSPECT_INVENTORY_SLOT` | `ASSET` | 查验背包轻量道具槽位与耐久 | 无 | 无 | 可选 `slot_index` |
| `TOGGLE_MODE_ADAPTATION` | `META` | 探测并调整单机/联机自适应特性 | 无 | 无 | 可选 `target_mode` |
| `MARK_MAIL_READ` | `RETENTION` | 读取未读信件并收取附件奖励 | 无 | `unread_mail_min >= 1` | 可选 `mail_id` |
| `DISMISS_UI_NOTICE` | `META` | 确认并关闭前台去表现化弹窗通知 | 无 | 无 | 可选 `notice_id` |

### 4. 人类操作独占租约与只读退化机制

1. **抢占时限窗口**：人类前台操作触发时，引擎激活优先抢占租约（`human_preemption_lease_ms = 2000`）；
2. **只读模式自动降级**：
   - 遥测包信封中的 `control_lease.is_writable` 置为 `false`；
   - `control_lease.agent_control_mode` 切换为 `"READ_ONLY_OBSERVER"`；
   - 动态行动空间中所有指令的 `is_executable` 被置为 `false`，`blocked_reason` 标记为 `"ERR_PREEMPTED_BY_HUMAN"`；
3. **安全上行守卫**：若 Agent 在只读窗口强行提交动作包，`AgentActionChannel` 立即拦截并返回阻断状态，杜绝打断玩家交互。

### 5. 定长环形轨迹记忆与紧凑二进制流

1. **时序轨迹反思窗口**：
   - 引擎内置 `AgentTrajectoryRingBuffer`（默认容量 32 槽位），支持 $O(1)$ 常数时间滚动覆盖；
   - 提供 `get_trajectory_window(k)` 接口，允许 Agent 提取最近 $k$ 步历史切片，支持多步因果反思与长程归因；
2. **紧凑二进制编解码 (`BinaryTelemetryCodec`)**：
   - 针对高频通信场景，支持通过 Godot 原生 `PackedByteArray` 序列化；
   - 包含 `0x4B414C52` (`KALR`) 魔数校验与单字节紧凑字段映射，单包体积压缩至 ~85 字节（压缩率达 95.7%）。

