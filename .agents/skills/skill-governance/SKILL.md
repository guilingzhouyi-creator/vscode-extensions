---
name: skill-governance
description: >-
  工作区技能集工程化结构、生命周期与同构分发治理规范。指导 Agent 遵循 JIT 渐进式披露原则，
  规范维护 15 项研发技能的四件套物理布局（SKILL.md、references、templates、scripts）、
  YAML Frontmatter 语法契约、双目录（.agents/skills 与插件包）100% 字节等价性同步与自动化门禁验证。
---

# skill-governance — 技能集工程化结构与生命周期治理规范

本技能确立了全工作区技能集（Skills）的标准物理架构、YAML 元数据契约、JIT 渐进式披露（Progressive Disclosure）原则、根目录与插件包双副本 100% 字节等价同步机制以及自动化校验门禁标准。

---

## 一、 适用场景与触发条件

在以下任一场景中，必须激活本技能：
1. **新建或扩充工作区技能**：为新领域或新子系统定义专属研发技能；
2. **更新或修正现有技能内容**：对齐工作区规则总规、消除过时术语或更新规范指标；
3. **维护技能模板或参考指南**：在 `references/` 或 `templates/` 下增加深入指南或代码脚手架；
4. **执行技能集双目录同步**：在修改根目录 `.agents/skills/` 后，同步更新至 `.agents/plugins/workspace-governance/skills/`；
5. **排查技能门禁拦截**：定位与修复 `validate-skills.js` 或暂存区门禁报错。

---

## 二、 技能标准物理架构（四件套模型）

每个技能必须作为一个高内聚的自包含工程单元存在，位于 `.agents/skills/<skill-name>/` 下，目录结构如下：

```text
.agents/skills/<skill-name>/
├── SKILL.md                 # [必选] 技能唯一顶层入口与快速决策中枢 (100~300 行)
├── references/              # [推荐] 深水区技术实现指南、数学模型与详细背景 (按需查阅)
│   └── *.md
├── templates/               # [推荐] 开箱即用的标准化样板代码、配置文件或测试骨架
│   └── *.{ts,js,gd,json,md}
└── scripts/                 # [可选] 伴生自动化校验工具或 JIT 辅助脚本
    └── *.js
```

---

## 三、 JIT 渐进式披露设计原则 (JIT Progressive Disclosure)

为避免单文件上下文膨胀并提升 Agent 的决策速度，技能编写必须遵守渐进式披露原则：

1. **`SKILL.md` 保持高内聚精炼**：
   - 目标长度控制在 **100 ~ 300 行**；
   - 聚焦：适用场景、核心公理矩阵、关键架构约束、常用验证命令及关联文件指针；
   - 避免在 `SKILL.md` 中平铺展示数百行的大段背景叙述或完整代码实现。
2. **深水区下沉至 `references/`**：
   - 将复杂数学证明、算法边界、历史演进或深度协议规范抽离为独立的 Markdown 文档；
   - 在 `SKILL.md` 尾部通过相对链接形式提供“按需查阅”指针。
3. **实操脚手架收口至 `templates/`**：
   - 将标准类定义、测试用例骨架、JSON 配置样板独立放置在 `templates/` 中；
   - 模板代码本身必须严格遵守圈复杂度 $\text{CC} \le 15$、嵌套深度 $\text{Depth} \le 4$ 及模块头六字段 JSDoc 规范。

---

## 四、 YAML Frontmatter 与元数据规范

每个技能的 `SKILL.md` 必须在首行包含合法的 YAML Frontmatter：

```markdown
---
name: <skill-name>
description: >-
  <简明扼要的技能描述，包含意图触发词、适用领域、指导范围与核心规范关键字，长度 50~200 字符>
---
```

**刚性字段要求**：
- **`name`**：必须与该技能所在的文件夹名称（`kebab-case`）100% 严格一致；
- **`description`**：必须包含高辨识度的触发词向量（如项目名、核心规则代号、操作意图），禁止留空或敷衍。

---

## 五、 全局质量契约与排版纪律

所有技能文档与伴生资源均受工作区全局刚性公理管束：
1. **严格换行符**：Markdown（`.md`）、JSON（`.json`）、TypeScript/JavaScript（`.ts`/`.js`）及 Bash（`.sh`）磁盘文件必须严格保持 **LF 换行**；严禁写入 CRLF；
2. **零空文件**：严禁创建或保留 0 字节物理空文件或纯空白字符文件（`HYG-EMP-001`）；
3. **单源规则反虚构 (`RCFG-RULE-DRIFT`)**：技能正文中提及的所有大写规则 ID（如 `ARCH-FAC-001`、`ADV-PRF-002`、`GATE-AST-001`）必须在 `scripts/common/rule-catalog.json` 中真实登记；
4. **相对链接卫生 (`LINK-ABS-FILE-URI`)**：所有超链接必须为有效的相对路径，严禁使用 Windows 盘符绝对路径或 `file:///` URI；目标物理文件必须真实存在；
5. **零黑话与零敏捷代号**：严禁使用 `Phase_{NN}`、`ST{NN}`、`p[0-9]+` 等敏捷施工临时代号，一律采用客观技术主题命名；
6. **单文件双轨体积与契约注释密度**：技能模板与伴生代码文件同样受 $\text{ELOC} \le 900, \text{LOC} \le 1400$ 双轨体积红线与 1:3 动态反推包络约束；高负荷代码（$\text{ELOC} \ge 600$）契约注释密度必须达到 8% 及以上；
7. **全仓零高危技术债务与防反弹红线**：全工作区 High/Critical 技术债务历史性归零（0 项），技能演进与重构坚决捍卫 0 项基线，严禁引入任何高危债务反弹。

---

## 六、 双目录单源同构与自动同步机制

工作区技能体系实行**根目录为单源真源 (SSOT)，插件包同构镜像**的架构：
- **真源目录**：`.agents/skills/`
- **分发镜像**：`.agents/plugins/workspace-governance/skills/`

**同步与防护流程**：
1. **编辑单源**：所有增删改查操作必须且仅需在 `.agents/skills/` 中实施；
2. **一键同步**：完成编辑后运行：
   ```bash
   node scripts/common/sync-skills.js
   ```
   自动将根目录技能树增量镜像至插件包，清理多余孤儿文件并保证 100% 字节等价；
3. **门禁看守**：本地预提交门禁与全仓审计中枢通过 `validate-skills.js` 持续比对两处副本，一旦检出漂移立即熔断阻断提交。

---

## 七、 常用维护与验证命令矩阵

```bash
# 1. 验证技能 YAML、排版卫生、相对链接与规则真实性
node scripts/common/validate-skills.js

# 2. 静默比对根目录与插件包技能是否 100% 字节等价
node scripts/common/sync-skills.js --check

# 3. 将根目录技能变更一键同步至插件包镜像
node scripts/common/sync-skills.js

# 4. 执行包含技能验证的全工作区统一质量审查
pwsh -File scripts/ps1/audit-all.ps1 -Fast
```

