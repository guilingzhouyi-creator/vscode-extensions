---
档号: KALAR-DEV-2026-ST51-003
全宗号: KALAR (卡拉尔世界引擎全宗)
类别号: DEV-ST (技术研发·短期施工周期归档)
年度: 2026年
案卷号: ST51 (Phase_55_配置值域schema化与语义守卫加固)
件号: 003
保管期限: 永久 (Permanent)
密级: 内部公开 (Internal Open)
责任者: 卡拉尔世界引擎架构组
题名: Phase_55_配置值域schema化与语义守卫加固 —— 阶段3：audit_config值域校验与缺省兜底工程化
形成日期: 2026-09-04
归档日期: 2026-09-06（中午）
验收状态: 已归档·100%自动化测试验收通过 (PASS)
主题词/关键词: audit_config 值域 schema 扩展; 缺省兜底与守卫常量语义登记; 错误码与文案键登记; code_governance_rules.json
---

# 施工细则：阶段3_audit_config值域校验与缺省兜底工程化

> 施工开始日期: 2026-09-04 下午
> 责任人: 卡拉尔世界引擎架构组
> 状态: ✅ 已闭环（第2轮施工已完成并验证闭环）

> [!NOTE]
> **【施工目标】**：将阶段1/2 的运行时守卫工程化收口，并落地**第二防线——配置表静态值域 schema 校验**（audit_config 扩展 `VD_*` 规则族，CI 阻断「表本身写坏」）；同时完成守卫常量说明、错误码/文案键登记与依赖治理。
> **案卷全局共享上下文**：👉 [KALAR-DEV-2026-ST51-ATT_附件_案卷共享契约与上下文.md](KALAR-DEV-2026-ST51-ATT_附件_案卷共享契约与上下文.md)。
> **对应需求源**：全域质量与边界专项审查报告（2026-09-04）→ L1 / L11 / L3 / L12；Phase 55 阶段1/2
> 📍 **卷内快速直达**：[ATT 共享附件](KALAR-DEV-2026-ST51-ATT_附件_案卷共享契约与上下文.md) ｜ [阶段1](KALAR-DEV-2026-ST51-001_阶段1_配置值域schema与数值不变量契约设计.md) ｜ [阶段2](KALAR-DEV-2026-ST51-002_阶段2_除数下限与符号钳制语义守卫算法实现.md) ｜ **阶段3 (当前)** ｜ [阶段4](KALAR-DEV-2026-ST51-004_阶段4_值域注入与语义边界验收测试矩阵.md)

---

## 📌 第一性原理溯源指针

* **精准上游规范指针**：阶段1 §一.1 schema 规则族与 §一.2 守卫清单；阶段2 §一 全部实现
* **核心不变量约束断言**：`Inv-VD-4`（值域可静态断言，0/负/倒置表 CI 即红）；`Inv-ENG-1`（规则 ID 稳定、audit_config 单一登记）；`Inv-ENG-2`（本卷守卫不引入新业务硬编码）
* **工程化重构最高指示**：schema 扩展最小侵入——先覆盖本卷 L 项真实键，`VD_*` 规则以数据驱动（规则表/JSON）登记，不在 audit_config 中堆 if-else 长链；守卫常量（0/1/EPS/下限值）属边界保护，须在代码注释登记语义但不进配置表（防过度配置化）

---

## 一、 配置驱动与泛化扩展实现 (Configuration-Driven & Refactoring)

### 1. audit_config 值域 schema 扩展（第二防线）

```python
# 模块路径: scripts/py/audit_config.py（扩展值域校验段）
# 设计：值域规则以「规则声明表」登记（对齐既有规则 ID 稳定惯例），不堆 if-else：
# VD_POSITIVE_INT   : 键路径 → int > 0          （tier_size / salt_modulus / 同类分母）
# VD_POSITIVE_FLOAT : 键路径 → float > 0         （learner_normalize / supply_floor 类）
# VD_RANGE_ORDERED  : 键对 → left < right        （deadzone inner<outer / value_min ≤ value_max）
# VD_INT_RANGE      : 键路径 + [min, max]         （drop_lowest ∈ [0, dice_count-1]）
# 登记清单：以阶段1 §一.1 五族 × 真实键落表（键路径与 config 实况对齐后一次性登记，
#           严禁扫描式泛规则扩大审计面造成基线噪变）
```

规则声明表落点：`scripts/config/code_governance_rules.json` 或 audit_config 内部规则常量区（以该文件现有规则承载方式为准，实现轮 `--rules` 查询后对齐）；**规则 ID 一经发布不改名**（对齐文档棘轮/CI 注解需求）。

### 2. 缺省兜底与守卫常量语义登记

- 阶段2 全部守卫遵循「类型化取值器默认值 + 读取侧钳制」双保险：默认值保持既有配置默认（如 tier_size=2、salt_modulus=10000），守卫仅在配置被改写为 0/负/倒置时介入——**不改任何 config 默认值**；
- 守卫下限常量（`1`、`0.01`、`0`）在代码注释登记语义（如 `# 分母下限 1：对齐 respec_pipeline maxf(1.0,…) 惯例`），不进配置表（防过度参数化，对齐阶段1 防漂移指示）；
- 死区 EPS 常量命名与取值（0.01）登记为 `hardware_input` 域内部常量，注释说明「仅防倒置配置的映射精度下限，非业务阈值」。

### 3. 错误码与文案键登记

| 新增语义 | 落点 | 文案键（如适用） |
| :--- | :--- | :--- |
| 金库负数取款拦截 | `organization_governance_solver` 返回 `INVALID_AMOUNT` | `narratives.organization_guild` 新增 `treasury_invalid_amount`（实现轮在既有文案表就近登记，禁另建文件） |
| 别名键类型错误 | `movement_vector_bridge_solver` 返回 `INVALID_DIRECTION_ALIAS` | 结构化错误码即可，不需文案（对齐同文件返回风格） |
| clamp 区间注册拒绝 | item_attribute_registry 告警 | 日志告警 + 结构错误码（对齐注册表现有错误语义） |

### 4. 依赖治理与文档同步

- 全部守卫落点均为**同域读取点/入口点**，无新跨域依赖；
- audit_config 扩展仅依赖既有 `scripts/config/code_governance_rules.json`（或 audit_config 内部规则区），不引入新依赖；
- 底座约定文档（`docs/README.md` / `config/README.md`，改文档时同步一行）：登记「配置分母/取模类键一律 >0、区间键有序」的 schema 约定与 `VD_*` 规则族入口指针。

---

## 二、 命令式施工执行清单 (Agent Execution Checklist)

- [x] **Step 3.1**: `--rules` 查询 audit_config 现有登记格式 → 起草 `VD_*` 五族规则表（真实键路径对齐）
- [x] **Step 3.2**: 值域校验段实现 + 自测（构造 0/负/倒置临时表验证 CI 变红；测毕即删临时表）
- [x] **Step 3.3**: 文案键/错误码登记（narratives 就近补键 + 注释），audit_copywriting / TC-ARCH-06 通过
- [x] **Step 3.4**: 守卫常量注释登记 + 底座约定一行 + audit-docs 0 新增
- [x] **Step 3.5**: 全量复核：config/ 默认值零改动、audit-all 全绿

---

## 三、 工程化验收矩阵 (DoD Matrix)

| 检验项 ID | 校验目标 | 验证输入 | 预期输出断言 |
| :--- | :--- | :--- | :--- |
| `TC-VD-S3-01` | schema 规则可查 | audit_config --rules | VD_* 五族全部登记且键路径指向真实键 |
| `TC-VD-S3-02` | CI 拦截坏表 | 临时注入 tier_size=0 表 | audit_config 值域段 exit 1（测后移除） |
| `TC-VD-S3-03` | 正常表零误报 | 现有全量配置跑值域段 | 0 error（基线 0 新增） |
| `TC-VD-S3-04` | 文案/错误码登记 | 文案键落地 + audit_copywriting | 键存在、无悬空引用 |
| `TC-VD-S3-05` | config 默认值零改动 | git diff config/ | 无 config 文件改动（临时注入表已移除） |
| `TC-VD-S3-06` | 无跨域依赖新增 | audit_arch | 领域拓扑 0 新增告警 |

---

## 附：第 2 轮实施收敛登记（2026-09-04）

- **配置键单位收敛**：细则 §1 补偿/值域阈值拟定 `ttl_ms`；实现轮对齐域内既有时间语义（`current_time_utc` 秒制），`redemption/compensation/ttl_seconds`（默认 180）落表（`config/domains/cdkey_voucher.json`）。代码注释与上表以实际键名为准。
- **audit_config VD_\* 落地**：四族规则（VD_POSITIVE_INT / VD_POSITIVE_FLOAT / VD_RANGE_ORDERED / VD_INT_RANGE 跨键式）数据驱动登记于 `VALUE_DOMAIN_RULES`，坏表 CI 即红（本轮全量配置 0 误报验证通过）。
