# 卡拉尔世界引擎 (Kalar World Engine)

无头确定性母机 + 解耦表现宿主的 Godot 4 工程。后端 47 个业务领域以「零硬编码、全配置驱动」为准则，前端仅消费 `EventBusCore` 事件流（Phase 72 后旧 `EventBus` 已全域退役）。

## 快速开始

```bash
# 运行全域单元测试（109 个测试套件，断言数以 run_tests.sh 输出为准）
./run_tests.sh

# 等价于
godot --headless -s res://tests/test_runner.gd

# 首次导入工程（生成 .godot 缓存；新增/重命名脚本后需要）
godot --headless --import

# 启动前端仪表盘（图形界面）
godot
```

> 新增或重命名 `.gd` 文件后，必须执行 `godot --headless --import`，
> 否则新脚本不会写入 `.godot/global_script_class_cache.cfg`，
> 其他脚本引用该 `class_name` 时会报 `Identifier not found`。

## 目录结构

```
WebGames/
├── backend/
│   ├── infrastructure/       # 基础设施：配置底座、事件总线、存档、时钟、确定性 RNG
│   └── domains/              # 47 个业务领域，每领域 3 文件（实体 / 求解器 / 状态机）
├── frontend/views/           # 表现层宿主（仅消费事件，不含业务逻辑）
├── tests/
│   ├── unit/                 # 每领域一个测试文件
│   ├── test_registry.gd      # 全域测试注册表（CLI 与 UI 共用，唯一事实来源）
│   └── test_runner.gd        # headless CLI 入口
├── config/                   # 全部配置表（见下）
│   └── infrastructure/domains.json  # 领域清单唯一事实来源（架构护栏依据）
├── docs/                     # 设计文档
└── run_tests.sh
```

## 配置驱动约定

所有数值、文案、标识均来自 `config/`，代码内只保留**兜底默认值**。

| 目录 | 表名规则 | 用途 |
|---|---|---|
| `config/domains/<name>.json` | `domains.<name>` | 业务数值、阈值、概率、公式系数 |
| `config/narratives/<name>.json` | `narratives.<name>` | 用户可见文案（支持 `%s`/`%d` 占位） |
| `config/infrastructure/<name>.json` | `infrastructure.<name>` | 日志级别、事件分类、存档、时钟 |
| `config/frontend/<name>.json` | `frontend.<name>` | UI 文案与演示数据 |

### 领域清单与架构护栏

`config/infrastructure/domains.json` 是全域领域的唯一事实来源：每条记录一个领域的
`id` / `config` / `narrative` / `test` / `test_symbol` / `phase` / `depends_on`。
新增领域必须登记，否则架构护栏立即变红。

`tests/unit/test_architecture_guard.gd`（`TestArchitectureGuardDomain`）依据该清单做 6 项断言，
**所有期望值均从磁盘推导**（禁止写死领域总数、断言总数）：

| 断言 | 校验内容 |
|---|---|
| TC-ARCH-01 | `backend/domains/` 目录集合与清单 `id` 集合双向差集为空（含 `depends_on` 引用完整性） |
| TC-ARCH-02 | 清单每条 `config` / `narrative` 表文件存在；且该领域 `.gd` 中引用的 `"domains.<x>"` 字面量全部有落地表 |
| TC-ARCH-03 | 清单每条 `test` 文件存在、已在 `tests/test_registry.gd` 中 `preload` 且出现在 `get_all_test_classes()`；注册表条目数 == 清单条目数 + 2 |
| TC-ARCH-04 | 扫描 `backend/` 全部 `.gd`，断言无裸调用 `randf()` / `randi()` / `randomize()` |
| TC-ARCH-05 | 本文档与 `config/README.md` 中的领域计数与清单条目数一致 |
| TC-ARCH-06 | 代码读取的「表 + 键路径」双字符串字面量必须在配置表中真实存在（防止删键后静默回退默认值） |

读取方式（多级路径，未命中回退默认值，不抛错）：

```gdscript
GameConfig.get_int("domains.currency", "rates/silver", 100)
GameConfig.get_float("domains.combat", "participant_defaults/hp", 100.0)
GameConfig.get_string("narratives.currency", "sink_transaction", "")
GameConfig.get_dict("infrastructure.event_categories", "combat", {})
GameConfig.msg("matter_disposal", "slag_ash_name")   # 领域文案统一入口（表=narratives.<域>，未命中回退键名）
GameConfig.reload_config()   # 热重载（不可命名 reload()——GDScript 内建遮蔽同名静态方法）
```

### 分层规范

- 新增领域必须同时建 `config/domains/<领域>.json`；含用户可见文案时另建 `config/narratives/<领域>.json`。
- 物品原型定义放 `config/items/<name>.json`（表名 `items.<name>`），`ItemLoaderPipeline.build_catalog_from_config()` 装配时自动发现并注册。
- `GameConfig._required_tables` 列出必需表，缺失时启动告警。
- 文案中的动态数量使用 `%d` 占位符由代码传入，**不要**把领域总数等易变数字写死在配置里。

## 确定性约定

业务代码**禁止**调用 Godot 全局 `randf()` / `randi()` —— 它们依赖引擎内部状态，未显式 seed 时结果不可复现。

统一使用 `DeterministicRNG`（配置驱动的 LCG）：

```gdscript
var rng := DeterministicRNG.from_seed(12345)   # 独立实例，完全可复现
rng.randf(); rng.randi_range(1, 6); rng.pick(arr)

DeterministicRNG.global().randf()              # 共享实例（默认入口）
DeterministicRNG.reseed_global(seed)           # 整局复现开关
```

批量调用（如十连祈愿）必须**共用同一实例**，否则每抽都从同一状态重开、序列退化为重复值。

可选 RNG 参数统一经 `DeterministicRNG.resolve(rng_or_seed)` 归一（实例原样 / int>0 作种子 / 其余回退共享实例），
业务签名一律 `rng: DeterministicRNG = null`。

## 共享底座约定

- **唯一 ID**：业务 ID 一律 `UniqueIdGenerator.next_id(prefix)`（同毫秒重复生成自动追加序号防碰撞）；
  时间戳作为哈希签名因子（GM 审计签名、登录 token）不属 ID 生成，继续手写。
- **邻近判定**：圆形半径包含判定一律 `SpatialMath.within_radius(a, b, radius)`（边界点属圆内）；
  可听域等「边界排除」语义不适用，须自行比较。
- **库存操作**：按 id 查找/移除走 `WearableInventoryAggregate.find_item_by_item_id()` / `remove_item()`，
  禁止外部直接 `storage_items` 查找后 `remove_at`。
- **物品载荷契约**：跨域 payload 字典构造物品一律 `ItemEntity.from_payload(payload, fallback_*)`，
  canonical 键 `template_id`（别名 `item_template_id`）/ `name`（别名 `custom_name` / `item_name`）/
  `mass_kg` / `volume_slots`；禁止手工 `ItemEntity.new()` 后逐字段拷贝。
- **钱包账本**：多币种入账/扣账一律 `CharacterWalletEntity.apply_delta(delta)`
  （键 ∈ copper/silver/gold/platinum/mana_monocrystals，值为整数增量，未知键告警忽略）；
  「折算总额 + 阶梯扣除」语义用 `try_spend(cost_copper)`（银不够金来凑）；
  带领域前置判定的单/双币种定向扣减（如商店购买只看金银、佣金保证金只看金）
  保留显式字段操作，禁止改用 try_spend 放宽余额判定。

## 后端逻辑处理标准 v1

六角色模型与职责红线（新领域按此组排，存量领域渐进归位）：

| 角色 | 形态 | 职责 | 红线 |
|---|---|---|---|
| entity / aggregate | 实例 RefCounted | 状态容器 + serialize/deserialize | 不做业务判定 |
| solver | 静态纯函数 | 计算/评估，返回新值 | 禁 mutator（禁止 `-> void` 改写入参状态） |
| fsm | 允许实例状态 | 状态推进 | 不做跨聚合编排 |
| pipeline | 静态编排 | 跨聚合调度 | 不内联业务数值（一律 GameConfig） |
| service | 门面 | 外部副作用 | 用户可见文案出口归此 |
| registry / dto | 特例 | 注册表 / 传输契约 | 注册表禁裸全局随机（TC-ARCH-04） |

- **动词→角色映射**：solver 用 `calculate_*` / `evaluate_*`；fsm 用 `tick_*` / `apply_*` / `advance_*`；
  pipeline 用 `dispatch_*` / `process_*`；service 用 `execute_*`；查询用 `get_*` / `has_*`。
- **结果字典**：新代码统一 `{success, error_code, error_message, data?}`；存量 `{success, error}` /
  `{valid, reason}` 两派允许并存，触碰时渐进归位；error_code 命名 `<域>_<大写蛇形>`。
- **空集合语义**：显式跳过并在结果中携带计数，禁止 null 透传。
- **序列化协议**：可存档领域实现 `serialize()` / `deserialize()`；deserialize 缺键一律回落
  字段初值（即配置缺省），刻意差异的兜底键（如 `deserialize_name` / `fallback_title`）须注释保留；
  组装/回灌/版本迁移一律走 `GameSaveAssembler`（清单序保证 SHA 字节稳定，迁移链注册制）。
- **并存契约**：`chat_command.redeem_cdkey` 是 GM 表驱动直发（TC-CMD-03 契约），
  `cdkey_voucher` 是完整核销管线（频控/时效/门槛/唯一码）——两者语义不同、刻意并存，禁止互吞。
- **类型纪律**：全强类型基线；确需 `Variant` 处须行内注释豁免理由。

## 存档完整性

`SaveManager` 信封中**只存 `data_json` 一个数据字段**，校验与消费指向同一字节序列：
校验 `data_json` 的 SHA-256，并从该字符串反序列化返回。若存在可写的平行 `data` 字段，
攻击者只需改写 `data` 不动 `data_json` 即可绕过校验，因此不得再引入该字段。

写入采用 `tmp → 备份 .bak → rename` 原子替换，任一环节失败都不会破坏已存在的正档。

## 代码规范

- 文件头统一为分隔线注释块，含领域 / 文件路径 / 职责说明。
- 函数返回值与参数必须写类型注解；局部变量优先使用 `:=` 做类型推断。
- 常量使用 `CONSTANT_CASE`；`preload` 的类引用常量可用 `PascalCase`。
- 缩进 Tab（GDScript 与 Godot 资源），JSON / Markdown 用 2 空格。
- 换行符统一 LF（由 `.gitattributes` 与 `.editorconfig` 保证）。

## 持续集成与架构门禁

> ⚠️ 本工程位于上层仓库的子目录，而 GitHub Actions 只读取**仓库根**的 `.github/workflows/`。
> 因此门禁**不在**本目录的 `.github/` 下，而在上层仓库根的 `.github/workflows/godot-ci.yml`。
> （本目录那份 `.github/workflows/ci.yml` 从未被 GitHub 执行过，勿往里加步骤。）

流水线在 push 触及 `WebGames/**`（含纯文档改动）或任意 PR 时触发，**任一步失败即整条变红**：

| 步骤 | 命令 | 拦截内容 |
|---|---|---|
| 导入工程 | `godot --headless --import` | 脚本编译 / 全局类缓存（不重试：编译失败是确定性的） |
| DoD 验收 | `bash run_tests.sh` | 全域测试套件 |
| 架构护栏 | `bash scripts/sh/audit-arch.sh` | TC-ARCH-01~06：目录 / 配置表 / 测试注册 / 确定性 / 文档计数 / 键级漂移 |
| 配置审查 | `python3 scripts/py/audit_config.py --strict` | JSON 可解析 / 键命名 / 必需表齐全 / 格式一致性（无 BOM · LF · 2 空格规范序列化） |
| 全量审查聚合 | `bash scripts/sh/audit-all.sh` | 20 项静态门禁（配置 / 高级规范治理 / 简化防过度 / 硬编码 / 热点与堆分配 / 覆盖 / 死配置 / 密钥 / 上下界 / 物品三元组 / 文案 / 魔法维度 / 事件概率 / CDC / 头注释契约 / 信道审计 / 架构护栏 / 收口等）+ 文档四域基线棘轮门禁（`audit-docs.sh --baseline`，仅阻断新增违规；Agent 操作契约见 `docs/README.md`；bench/archive 须显式 `--group` 触发） |

后四条均套了**失败重试一次**，用于吸收读取撞上他人写入窗口的瞬时假红；
真实问题会连续两次失败，仍然红。

本地可单独复现任一门禁。`audit-arch.sh` 只跑架构护栏（比全量快得多），
失败时逐条打印违规明细与 `文件:行号`，退出码 0/1 可直接用于 CI 判定。

> **排查红灯前先排除两个瞬时红灯源**（详见 `scripts/sh/audit-arch.sh` 头注释）：
> ① 并发写入竞态——重试即绿；② 有人在跑逆向验证——窗口内的违规是**真的**，
> 护栏判定正确，别去改代码。判据：**连续两次都红才是真问题**。

## 质量现状

| 指标 | 数值 |
|---|---|
| backend .gd / 行数 | 302 / 约 26,759 行（全域 .gd 513 / 约 62,603 行，随新卷增长） |
| 领域数 | 47 |
| 测试项 | 770（CLI 与 UI 共用同一注册表，109 个测试套件 / 覆盖 47 领域；实时以 `tests/reports/test_latest.json` 为准） |
| 配置表 | 123（含 65 张必需表，`audit_config.py` 口径） |
| 配置调用点 | 862（`backend/` + `frontend/` 内 `GameConfig.get_*` 与 `GameConfig.msg`；表缺失 0；`GameConfig.get_value` 违禁调用 0） |
| 函数 / 参数类型注解 | 100% / 100% |

实时数据以审查产物为准：`bash run_tests.sh`（单测 JSON 汇总写入 `tests/reports/test_latest.json`）
与 `bash scripts/sh/audit-all.sh`（20 项静态门禁含文档四域棘轮门禁，见 `docs/README.md` 契约）。
