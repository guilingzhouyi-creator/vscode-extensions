---
档号: KALAR-DEV-2026-ST50-001
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST50 (Phase_54_确定性随机高位化与迭代安全加固)
件号: 001
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_54_确定性随机高位化与迭代安全加固 —— 阶段1：RNG位宽契约与事件排期数据模型设计
形成日期: 2026-09-04
归档日期: 2026-09-05（上午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: RNG 整数派生契约; 时间轴排期数据流契约; 组合键无歧义编码契约
---

# 施工细则：阶段1_RNG位宽契约与事件排期数据模型设计

> 施工开始日期: 2026-09-04 下午
> 责任人: 卡拉尔世界引擎架构组
> 状态: 📝 待获批（第1轮细则已编制，待批准后进入实现）

> [!NOTE]
> **【施工目标】**：为「随机数低比特偏置（M2）」与「迭代安全/键碰撞」两类缺陷建立契约：① `DeterministicRNG` 整数派生一律改走**高位缩放**，杜绝低比特奇偶交替；② 第三时间轴事件排期必须**分离「到期触发」与「重排期」两阶段**，杜绝迭代中修改容器；③ 组合键编码必须**无歧义**（长度前缀），杜绝分隔符碰撞。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST50-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST50-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：全域质量与边界专项审查报告（2026-09-04）→ M2 / M8 / L10
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST50-ATT_附件_案卷共享契约与上下文.md) ｜ **阶段1 (当前)** ｜ [阶段2](KALAR-DEV-2026-ST50-002_阶段2_高位缩放取模与时间轴分离排期算法实现.md) ｜ [阶段3](KALAR-DEV-2026-ST50-003_阶段3_RNG配置固化与事件键转义工程化.md) ｜ [阶段4](KALAR-DEV-2026-ST50-004_阶段4_随机性分布与迭代安全验收测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游证据指针**：
  - M2：`backend/infrastructure/deterministic_rng.gd:90,96`（`lo + int(next_state() % (hi - lo + 1))` / `arr[int(next_state() % arr.size())]`）——mult=1103515245、inc=12345 均奇数 → state 低比特每步翻转；实证：`randi_range(0,1)` 输出 `0,1,0,1,…` 严格交替；`pick` 偶数池下标周期 4（`2,3,0,1,…`）；真实命中点 `combat_initiative_solver.gd:136` 决胜掷硬币
  - M8：`backend/domains/physics_thermodynamics/tertiary_timeline_engine.gd:55-67`（`for evt in scheduled_events:` 内命中即 `_schedule_next_random_dispatch/_schedule_next_tension_pulse`，二者在 80/99 行 `scheduled_events.append(...)`；67 行 `scheduled_events = remaining_events` 整体替换）——迭代中追加行为不定，且 `*_interval_min_ms=0` 时新事件 `trigger_time == now` 可同趟再触发
  - L10：`backend/domains/event_extractor/composite_event_extractor.gd:16,98`（`KEY_SEP = "|"`，`"%s|%s|%s|%s|%s"` 拼接 account_id/transaction_id）——字段含 `|` 时跨账号分组碰撞
* **核心不变量约束断言**：`Inv-RG-1`：整数派生与数组选取的均匀性不得依赖 LCG 低比特（低比特奇偶翻转不得影响输出分布）；`Inv-TL-1`：时间轴推进每次重排期事件的 `trigger_time_ms` 严格 `> current_timeline_ms`（进度保证，杜绝同趟再触发）；`Inv-TL-2`：任何遍历不得在迭代体内原地修改被迭代容器；`Inv-EC-1`：组合键编码必须可无歧义解码回原字段序列（对任意字段内容成立）
* **防漂移最高指示**：禁止「改默认种子/改常量」式掩盖低比特问题（治标不治本）；必须以派生方式（高位缩放）重构取模来源

---

## 一、 数据结构设计与代码契约 (Data Structures & Code Contracts)

### 1. RNG 整数派生契约（M2 落点）

```gdscript
# 契约：整数输出从状态高位派生，禁用 state % range 低比特路径
# 核心改动点：randi_range（87-90 行）与 pick（93-96 行）
#   统一派生：取出一次 next_state()，以 randf() 同源全精度（状态/mask+1）缩放区间，
#   即：value = lo + int(randf() * float(hi - lo + 1))，末位 float 舍入钳回 hi
#   或（实现轮二选一，须附分布验证）：(next_state() >> 16) 高位段再取模
# 保留契约：每次调用恰好消费 1 次 next_state()（序列节奏不变）；
# 序列派生版本登记：本改造属派生算法 v1 → v2，同种子序列整体变化（见阶段3 兼容登记）
```

验证基准（DoD 注入前置）：`randi_range(0,1)` 连续 32 次输出**不再严格交替**；`pick(size=4)` 下标在 4 值域内无固定周期 ≤ 4 的模式（χ²/游程粗检）。

### 2. 时间轴排期数据流契约（M8 落点）

```
advance_time(delta_ms) 两阶段数据流（替代「边遍历边 append」）：
  阶段 A（触发收集）：遍历 scheduled_events 快照拷贝
       ├─ trigger_time <= now → is_processed=true、入 fired_events
       └─ 否则 → 入 pending_events（保留未到期）
  阶段 B（重排期）：对 fired_events 逐条判定类型 → 生成新事件（trigger 严格 > now）→ 追加 pending_events
  收尾：scheduled_events = pending_events；返回 fired_events
```

| 数据项 | 类型 | 语义 |
| :--- | :--- | :--- |
| `pending_events` | Array[TimelineEventPointDTO] | 未到期 + 本轮新排期的合集（最终落位） |
| `fired_events` | Array[TimelineEventPointDTO] | 本轮到期（仅作返回值与重排期依据，不直接入 scheduled_events） |
| 新事件 `trigger_time_ms` | int | `= current_timeline_ms + maxi(1, delta)`（delta 由区间配置取）——严格大于 now（Inv-TL-1） |

### 3. 组合键无歧义编码契约（L10 落点）

```gdscript
# 契约：组合键采用长度前缀编码（netstring 风格），对任意字段内容无碰撞（Inv-EC-1）
# 替换：KEY_SEP("|") 直接拼接（98 行）→ _encode_composite_key(parts: Array) -> String
# 编码：for part in parts: key += "%d:%s" % [part.length(), part]（length 十进制 + ':' + 原文）
# 示例：["a|b", "c"] → "3:a|b1:c"；["a", "b|c"] → "1:a3:b|c"（键互异，解码无歧义）
# 约束：原字段为 String（account_id/transaction_id/rule_id）；长度前缀以 ASCII 十进制，字段含
#       任意字符（含 ':' 与数字）均安全——本键仅用于等值分组，无需解析回退路径
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [ ] **Step 1.1**: 通读 `deterministic_rng.gd` 全文件，确定 randi_range/pick 改造采用「randf 缩放」或「高位段取模」之一，并写明分布验证方法（相邻奇偶翻转检测脚本）
- [ ] **Step 1.2**: 通读 `tertiary_timeline_engine.gd` 全文件（99 行），核对 interval 配置读取点，锁定两阶段改造边界
- [ ] **Step 1.3**: 通读 `composite_event_extractor.gd` 全文件，确认组合键全部构造点（98 行及有无其他拼接点）
- [ ] **Step 1.4**: 固化 DoD 矩阵（§三），M2/M8/L10 各 ≥3 注入点

---

## 三、 数据结构验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-RG-S1-01` | 掷硬币无交替 | `randi_range(0,1)` × 32（任意种子） | 输出序列非严格交替（存在相邻相同项） |
| `TC-RG-S1-02` | pick 无短周期 | `pick(size=4)` × 32 | 下标分布无 ≤4 固定周期模式（粗检） |
| `TC-RG-S1-03` | 序列确定性保留 | 同种子两次全序列 | 两次派生序列逐项一致（确定性不破） |
| `TC-TL-S1-01` | 新排期严格未来 | interval_min_ms=0 配置注入 | 新事件 trigger_time > current_timeline_ms |
| `TC-TL-S1-02` | 排期不丢失 | 触发 3 事件含双类型 | 后续 advance 仍能触发重排期事件（原丢失缺陷红） |
| `TC-EC-S1-01` | 键无歧义 | 含竖线字符（\|）字段样本对 | 编码键互异且可解码还原 |
