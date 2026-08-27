# oxc 主线程 feed 瓶颈 — 精确诊断 + ROI 裁决

> 状态：只读分析 + 设计文档（未改任何 src/ 源码）
> 基线：`0dc3c07`（validate 9/9 + validate-warm W1–W9 全绿）
> 日期：2026-08-14

---

## 0. 结论摘要（TL;DR）

**「主线程 feed 瓶颈」精确落点是「collect 结果的反序列化（deserialize）」，即 P2-5。read 已被 read-ahead 隐藏，dispatch 可忽略，hybrid 相位是生产性并行不是浪费。**

- **read 不是墙**：`readTotal`（326–689ms）> `poolWall`（153–436ms），证明读是异步且重叠的（libuv 线程池 + dispatch 的 `!ready` 回退路径让多批读并发在飞）。
- **dispatch 不是墙**：1.4–1.6ms（可忽略）。
- **deserialize 是墙**：~4–6ms（轻量 3–4%）/~51ms（密集 ~12%），落主线程关键路径、不可重叠。
- **hybrid 相位（94–367ms）是主线程大头，但生产性**：`AR_HYBRID=0` 关掉它反而 +3~14% 变慢（交替 A/B 确认），不是浪费。
- **worker idle 32–48% = import（被 hybrid 填）+ deserialize feed 延迟**，不是可独立优化的独立项。

---

## 1. 主线程四段分解（oxc w4，AR_TIMING + P2-5 微基准）

| 阶段 | 轻量 126B（poolWall≈153ms） | 密集 2.5KB（poolWall≈375–436ms） | 判定 |
|---|---|---|---|
| **collectFiles（walk）** | discover=0.0ms | discover=0.0ms | <5ms ✓ 非墙 |
| **read（pMap32 read-ahead）** | readTotal=326.5ms（26 批，avg 12.6ms） | readTotal=689.5ms（26 批，avg 26.5ms） | 异步重叠，非墙 |
| **dispatch（postMessage 批32）** | dispatchSync=1.4ms | dispatchSync=1.6ms | 可忽略，非墙 |
| **collect 结果：deserialize** | ~4–6ms（801 文件子集） | ~51ms（801 文件子集） | **唯一显著开销** |
| **collect 结果：merge（按索引聚合）** | merge=0.5ms | merge=0.5ms | 可忽略 |
| （附）**hybrid 相位** | 94.2ms（200 文件 in-process） | 367.0ms（200 文件 in-process） | 生产性，非浪费 |

### 1.1 read 为何「看起来大」却非墙
- `readTotal` 是 `readNextBatch` 从启动到 resolve 的**墙钟**，发生在 libuv 线程池（4 线程），主线程 await 期间**不阻塞**（可处理 worker 消息 + hybrid）。
- 代码里 `inflightRead` 单变量只限制「预读深度=1」，但 dispatch 的 `!ready` 回退分支会让多个 worker 同时报告时**各自直接 `readNextBatch()`**，多批读并发在飞 → `readTotal > poolWall` 即重叠证明。
- 结论：read-ahead 对 oxc 未失效（读与 CPU 重叠），不需要「双缓冲/更大并发」。

### 1.2 墙在哪
**deserialize（结构化克隆反序列化）**是唯一落主线程关键路径、不可重叠的开销：
- 密集：~51ms / ~375ms = **~12%**。
- 轻量：~4–6ms / ~153ms = **~3–4%**。

（数据：P2-5 微基准 `v8.deserialize` 对 worker 子集 payload：密集 51ms / 轻量 5ms。）

---

## 2. 针对性方案 + ROI 裁决

### 2.1 堵在 deserialize → 就是 P2-5
- team-lead 判断正确：「堵在 deserialize 本质是 P2-5」。本轮把它重新框进「主线程 feed」视角：**结论不变**——收益 oxc 密集 ~12%（≥10% 门槛边缘）、轻量 ~3–4%（<10%）。
- 结论：**P2-5 仍是唯一值得动的 feed 优化**，且只在 oxc + issue 密集语料有 ~12%；轻量语料 <5%，不划算。维持 P2-5 已裁决的「可选门控项、待 oxc 翻默认或密集语料时重估」。

### 2.2 堵在 read / dispatch？→ 否
- read：已重叠隐藏，双缓冲/更大并发**无收益**（且 memory 已证 UV_THREADPOOL_SIZE 4→16 零提升）。
- dispatch：1.4–1.6ms，拆消息/异步派发**无收益**。

### 2.3 hybrid 相位：生产性，不动
- `AR_HYBRID=0` 关掉 → 密集 +13.7%、轻量 +11.2% 变慢（交替 A/B）。hybrid 是在填 worker import 死时间 + 并行消化文件，不是 feed 浪费。
- 唯一可探（非本轮重点）：hybrid K 是**语料密度相关**（密集语料 in-process 慢、200 文件=367ms），K 扫描受本机负载漂移污染未收敛；memory 的 K=200 在交替 A/B 下仍优于 K=0，暂不推翻。

### 2.4 ROI 总裁决
- **oxc 单次扫描的「feed 瓶颈」= deserialize，收益 ~3–12%，与 P2-5 裁决一致（borderline）。**
- 无新的 >10% 杠杆（read/dispatch/merge/hybrid 均已排除）。
- **建议：维持 P2-5 为可选门控项，不新增任务；若团队要动 oxc 单次扫描，唯一可落地项仍是 P2-5 的 resultCodec。**

---

## 3. 任务分解 / 风险

**无新增任务。** 本轮结论收敛到已设计的 P2-5（`docs/p2-5-protocol-flatten-design.md`），其任务分解（T01 编解码器 → T02 接入 → T03 回归 → T04 边界）与验收门（validate 9/9 + validate-warm W1–W9 + bench A/B）不变。

若未来重估 P2-5 的触发条件（oxc 翻默认 或 用户语料 issues≥1 万），直接沿用该文档即可。

**风险**（不变）：字节等价是硬门（detail 任意结构/suggestion 可选/key 序/数值精度）；decode 本身也是 CPU（净收益=克隆−编解码，需 bench 实测不显著即止损）。

---

## 附：复现命令
```bash
# 交替 A/B（hybrid 0 vs 默认）
node C:/tmp/ar-p25-prof/measure-feed.js        # feed-result.txt
# hybrid K 扫描（受负载漂移污染，仅参考）
node C:/tmp/ar-p25-prof/measure-feed-k.js      # feed-k.txt
# 主线程四段分解（AR_TIMING 全表）
AR_TIMING=1 node -e "...scan(parser:'oxc')..." 2> C:/tmp/ar-p25-prof/feed-oxc-light.txt
```
