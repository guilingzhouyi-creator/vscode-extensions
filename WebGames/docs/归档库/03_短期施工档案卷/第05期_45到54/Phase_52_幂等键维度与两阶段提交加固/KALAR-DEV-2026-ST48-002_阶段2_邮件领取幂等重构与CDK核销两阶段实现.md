---
档号: KALAR-DEV-2026-ST48-002
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST48 (Phase_52_幂等键维度与两阶段提交加固)
件号: 002
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_52_幂等键维度与两阶段提交加固 —— 阶段2：邮件领取幂等重构与CDK核销两阶段实现
形成日期: 2026-09-04
归档日期: 2026-09-05（上午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: M3 修复：幂等缓存键复合化 + 生成 ID 唯一化; M4 修复：CDK 兑换两阶段提交; 补偿通道算法
---

# 施工细则：阶段2_邮件领取幂等重构与CDK核销两阶段实现

> 施工开始日期: 2026-09-04 下午
> 责任人: 卡拉尔世界引擎架构组
> 状态: 📝 待获批（第1轮细则已编制，待批准后进入实现）

> [!NOTE]
> **【施工目标】**：落地 M3/M4 修复算法与调用链改造：① `_claimed_results` 幂等键升级为「账户::mail_id」复合键并迁移全部读写点；② CDK 邮件默认 ID 改走唯一生成器；③ 兑换执行改为「占码 → 投递 → 核销」两阶段，失败路径可回收码与计数，消除永久悬挂。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST48-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST48-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：全域质量与边界专项审查报告（2026-09-04）→ M3 / M4；Phase 52 阶段1 契约
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST48-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST48-001_阶段1_幂等键命名空间与投递状态契约设计.md) ｜ **阶段2 (当前)** ｜ [阶段3](KALAR-DEV-2026-ST48-003_阶段3_幂等状态权威化与补偿通道工程化.md) ｜ [阶段4](KALAR-DEV-2026-ST48-004_阶段4_幂等与悬挂补偿验收测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游证据指针**：见阶段1 §一（证据行号、状态机与错误码表）
* **核心不变量约束断言**：`Inv-IP-1/2/3`（复合键维度 / ID 唯一 / 核销后置）
* **业务实现最高指示**：改造以**最小调用面变更**为原则——`claim_single_mail`/`claim_all_mails` 对外签名与返回结构不变，仅内部键与生成逻辑修正；CDK 兑换对外错误码新增仅限补偿场景，既有 `success/error_code` 结构不变

---

## 一、 核心业务细类与算法实现 (Business Implementation & Solver)

### 1. M3 修复：幂等缓存键复合化 + 生成 ID 唯一化

```gdscript
# 模块路径: res://backend/domains/mail_system/mail_delivery_pipeline.gd
static var _claimed_results: Dictionary = {}   # 键升级为 "account_id::mail_id"（保持有界裁剪）

static func _claim_cache_key(mail: MailItemAggregate) -> String:
    # Inv-IP-1：键粒度 ≥ 状态所有者粒度；旧键仅 mail.mail_id → 跨账户错配根因
    return "%s::%s" % [mail.recipient_account_id, mail.mail_id]

# claim_single_mail 内两处读写点同步迁移：
#   22-23 行：if _claimed_results.has(_claim_cache_key(mail)): return _claimed_results[_claim_cache_key(mail)]
#   107 行 ：_claimed_results[_claim_cache_key(mail)] = result.duplicate(true)
# FifoBudget.trim_oldest(...) 有界裁剪语义不变（仍按插入序裁剪最旧）
```

```gdscript
# 模块路径: res://backend/domains/cdkey_voucher/voucher_dispatch_pipeline.gd（第 33 行改造）
# 旧：mail_id if not mail_id.is_empty() else "CDK_%d" % Time.get_unix_time_from_system()
# 新：mail_id if not mail_id.is_empty() else UniqueIdGenerator.next_id("CDK")
# 说明：Inv-IP-2 —— 同毫秒自动追加防碰撞序号；显式 mail_id 由调用方负责唯一
```

**兼容性**：存量已写入 `_claimed_results` 的旧键（历史进程内）随进程重启自然失效，无需迁移脚本；磁盘存档中的 mail_id 字符串不受影响（只读标识）。

### 2. M4 修复：CDK 兑换两阶段提交（占码 → 投递 → 核销）

```gdscript
# 模块路径: res://backend/domains/cdkey_voucher/redemption_flow_orchestrator.gd
# 目标时序（替代「先推进计数/history 后投递、失败悬挂」）：
#   redeem(code) ──► code: CLAIM_PENDING ──► try_dispatch(...)
#       ├── success ──► 提交核销：code=USED、current_global_redemptions+=1、history.append（同点提交 Inv-IP-3）
#       └── failure ──► code 保持 CLAIM_PENDING，登记 DISPATCH_PENDING（可 retry）
#                       └── 补偿通道（见下）超时判定 → code=RELEASED、计数零推进
```

```gdscript
# retry_dispatch 增强（原 84-102 行）：
# 失败原因含「同信箱 mail_id 冲突」时（M3 生成侧修复后不再出现），自动以
# UniqueIdGenerator.next_id("CDK") 重新生成 mail_id 再投——与阶段1 契约的「补偿可重试」闭环
```

**失败回滚对称性检查表**（阶段1 §一.4 `Inv-IP-3`）：

| 提交项 | 旧行为 | 新行为 |
| :--- | :--- | :--- |
| `code` 状态 | 领取即置 USED | CLAIM_PENDING → USED(投递成功) / RELEASED(补偿回收) |
| `current_global_redemptions` | 先 `+= 1`（137 行） | 投递成功同点推进；失败零推进 |
| redemption history | 先 append | 投递成功同点 append（或失败分支同步回滚） |
| `DISPATCH_PENDING` 记录 | 永久悬挂 | 补偿超时出口：RETRY_QUEUED → RELEASED |

### 3. 补偿通道算法（防永久悬挂）

```
补偿判定（可挂接在既有领域 FSM 或领取代收流水处）：
  遍历 DISPATCH_PENDING 且驻留时长 > 补偿阈值（配置 infra 侧，见阶段3）的兑换：
    ├── 重试上限未达 → 重试投递（mail_id 冲突时重新生成唯一 id）
    └── 重试上限已达 → code=RELEASED + 清理 PENDING 记录 + 返回可重新领取
```

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [ ] **Step 2.1**: mail_delivery_pipeline 两处缓存读写点迁移至复合键，行为回归（同账户同 mail 二次领取仍幂等返回缓存结果）
- [ ] **Step 2.2**: voucher_dispatch_pipeline 默认 mail_id 改走 `UniqueIdGenerator.next_id("CDK")`，补头注释说明唯一性来源
- [ ] **Step 2.3**: redemption_flow_orchestrator 实现两阶段时序（占码/投递/核销/补偿四出口），计数与 history 推进点后移
- [ ] **Step 2.4**: cdkey_redemption_solver 核销判定改造为「投递成功回调内提交」，移除先发推进
- [ ] **Step 2.5**: 补偿通道接入（阈值走配置，见阶段3），自查成功路径零退化

---

## 三、 业务功能初步验证矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-IP-S2-01` | 跨账户同 mail_id 不错配 | 账户 A/B 同秒各收一条 CDK 邮件（同 mail_id） | A 领 A 的附件、B 领 B 的附件，各自 success 且金额归属正确 |
| `TC-IP-S2-02` | 同账户重复领取幂等 | 同 mail 二次调用 claim_single_mail | 二次命中缓存返回同结果，无重复入账 |
| `TC-IP-S2-03` | 默认 mail_id 无碰撞 | 同秒连发 100 条（同账户） | 100 条全部投递成功、mail_id 互异 |
| `TC-IP-S2-04` | 投递失败码可回收 | 模拟信箱满/投递拒绝 | code 保持 CLAIM_PENDING，计数零推进 |
| `TC-IP-S2-05` | 补偿超时释放 | PENDING 驻留超阈值且重试达上限 | code=RELEASED、PENDING 清理、可再次领取 |
| `TC-IP-S2-06` | 成功路径零退化 | 正常兑换流程 | code=USED、计数/history 各 +1、奖励全量到账 |

---

## 附：第 2 轮实施收敛登记（2026-09-04）

- **补偿式两阶段落地**：细则 §2.2 原写「核销判定改造为投递成功回调内提交、计数推进点后移」。实现收敛为**「原子核销（占码即核销）→ 投递失败置 DISPATCH_PENDING → 补偿通道超时重试、达上限回滚核销（RELEASED）」**——保留既有 solver 原子语义（文件头「事务键去重+原子核销」契约零改动），由新增 `CDKeyRedemptionSolver.rollback_redemption` 与 `RedemptionFlowOrchestrator.compensate_stale_pending` 达成「码不烧失 + 悬挂有出口」的用户契约（Inv-IP-3 以补偿式最终一致实现）。对应错误码 `CODE_RELEASED_AFTER_FAILURE`。
- **M3 协同**：默认 mail_id 唯一化后，retry_dispatch 不再因同信箱同 id 永拒（测试 TC-CDKEY-04/05 已覆盖）。
