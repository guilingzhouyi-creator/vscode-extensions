# 技能激活与联动：运维参考

> 本文面向维护 `.agents/skills` 与 `scripts/common/skill-registry.json` 的运维者，回答四件事：技能靠什么被激活、触发词怎么写、联动块从哪来、改完怎么闭环。四件套结构与描述窗口的完整契约见 [skill-governance 入口](../SKILL.md) 与 [progressive-disclosure-patterns.md](progressive-disclosure-patterns.md)；本文只覆盖激活面与联动面。

## 一、激活面：Agent 只看得见 description

- 索引面只有 frontmatter 的 `description`：Agent 依据这一行判断是否加载技能，命中后才读 `SKILL.md` 正文，正文里的 `references/` 再按需 JIT 读取。描述写得像摘要，正文再全也不会被触发（说明书口径见 `scripts/common/render-skill-catalog.js:47-48`）。
- 描述行由注册表的 `activation.template` 渲染为 `【触发：{triggers}】{pitch}`，触发词用分隔符 `/` 连接，pitch 紧随其后（`scripts/common/skill-registry.json:5-6`；渲染实现 `scripts/common/skill-registry-resolver.js:90-93`）。
- `descriptionWindow` 为 50~200 字符（`scripts/common/skill-registry.json:7-10`；校验实现为 `scripts/common/validate-skills.js` 的 `DESCRIPTION_WINDOW` 常量与 `validateFrontmatter`）。**推断**：50 下限刚好容纳“模板 + 六个触发词 + 一句调用含义”，让索引面同时具备词向量与判据；200 上限防止把正文摘要塞进索引面，挤占上下文并稀释技能间区分度。
- 描述只是索引，不是契约正文：规则矩阵、验证命令与反例仍在 `SKILL.md` 正文与 `references/`，命中后才按需加载。改描述等于改激活命中率，不是改文案。

## 二、触发词写法：六个起、九个止、三类语义至少占两类

- 数量窗口 6~9 个（`scripts/common/skill-registry.json:11-14`）；同一个词跨技能最多复用 3 次（`:15`），防止“重构”“排查”这类泛词把所有技能拉成同一个钩子。
- 分类判据有优先级（`scripts/common/skill-registry-resolver.js:102-109`）：先命中症状词表记 symptom；再命中意图词表记 intent；含 ASCII 字母或命中技术词表记 technical；三者都不中落 topic。词表在 `scripts/common/skill-registry.json:16-117`。
- 硬校验由 `checkTriggerContract` 承担（`scripts/common/validate-skills.js:537-575`）：每个词按 `Array.from` 计宽，须落在 2~8 字符；同一技能内不得重复；分类结果须覆盖至少 3 个不同类目（`topic` 回退也算一类），且 intent / symptom / technical 至少命中 2 个。只堆技术名词或只堆口语词的描述都会被判红。
- 正例（`debugging-and-error-recovery`）：`排错/报错/崩溃/单测失败/SSCCE/复现/假说/故障`——意图（排错）、症状（报错、崩溃、失败）、技术标识（SSCCE）三类齐备。
- 反例一（全技术名词）：`SSOT/ELOC/CAS/LUT/CC/Depth/JSON`——没有动作与场景，用户说“这个文件一千二百行了”时命不中。
- 反例二（全口语词）：`搞一下/看看/改改/麻烦/处理/帮忙`——技术上无法区分技能，任意请求都会误触发。
- 反例三（pitch 复述技能名）：`这是 coding-craft 技能。用于编写代码。`——既没说何时必须用，也没说看守什么；应写成“编写或审查任何代码时必须遵循……”，并带上失败语义与依赖方向。

## 三、联动语义：前置、接续、并行支援

- 联动拓扑由 `domains` 编排（`scripts/common/skill-registry.json:139-477`）：每个领域含 `chain`（有先后顺序的主链）、`supports`（领域支援清单）与 `scenarios`（场景 → 联动技能）。
- 前置 = 链上当前技能的前一项；接续 = 后一项。一个技能可同时属于多条领域链，因此前置与接续都是集合；领域入口没有前置（`scripts/common/skill-registry-resolver.js:171-191`）。
- 并行支援 = 与当前技能共同服务多个领域的伙伴：按共同领域数降序、同分按技能规范顺序排序，最多 4 项，且排除已作为前置或接续出现的技能（`scripts/common/skill-registry-resolver.js:37`、`:142-161`）。
- 注入顺序为“前置 → 接续 → 并行支援”：加载领域入口后按此顺序展开（说明书口径 `scripts/common/render-skill-catalog.js:64`）；SKILL.md 的「联动技能」表也按定位、前置、接续、并行支援、领域链排列（`scripts/common/skill-registry-resolver.js:266-270`）。
- **并行支援不是召唤代理，而是同一批改动要一起守的约束**：它来自各领域的 `supports` 清单，表示这些技能对同一改动同时提要求（例如 `coding-craft` 的失败语义与 `complexity-budget` 的体积预算）。命中入口后先走主链，再并行核对支援清单，而不是逐个去调用技能。
- `scenarios` 是“何时联动”的检索入口：SKILL.md 的「何时联动」单元由 `scripts/common/skill-registry-resolver.js:246-250` 生成，最多取两条；说明书的领域章列出全部场景（`scripts/common/render-skill-catalog.js:105`）。按场景命中比按链硬走更快。

## 四、字段与真源：改哪个字段，波及哪些文件

| 字段 | 含义 | 消费方 | 改动波及 |
| :--- | :--- | :--- | :--- |
| `layer` | 三层归属：通用方法论 / 治理底座 / 领域适配 | 规范排序（`scripts/common/skill-registry-resolver.js:74-81`）与说明书三层表（`scripts/common/render-skill-catalog.js:75-85`） | 只影响排序与说明书拓扑，不改联动 |
| `pitch` | 描述行第二句：何时必须用、看守什么 | frontmatter description 与说明书调用卡片 | 需重渲染 SKILL.md 与说明书 |
| `purpose` | 调用含义（说明书口径） | 说明书调用卡片（`scripts/common/render-skill-catalog.js:143`） | 不进 frontmatter，但读者据此判断调用价值 |
| `triggers` | 六个至九个触发词 | description 行、说明书卡片、触发词分类 | 直接影响激活命中率 |
| `situations` | 典型情形（用户原话） | 说明书调用卡片“典型情形”（`scripts/common/render-skill-catalog.js:154`） | 不进索引面，只帮人工检索 |
| `verification` | 验证命令 | 说明书调用卡片“验证命令”（`scripts/common/render-skill-catalog.js:156`） | 必须真实可执行，否则运维照抄会失败 |
| `domains.chain` / `supports` / `scenarios` | 联动拓扑 | 每份 SKILL.md 的「联动技能」块与说明书领域章 | 改链会同时改动所有相关技能的联动块 |
| `domains.archetype` | 对应 SubAgent 原型 | 说明书领域块（`scripts/common/render-skill-catalog.js:100`） | 只作文档映射 |

## 五、维护闭环：只改注册表，其余交给渲染

1. 改 `scripts/common/skill-registry.json`：描述含义、触发词、领域链与场景只在这一处改。
2. `node scripts/common/sync-skill-metadata.js`：渲染各 `SKILL.md` 的 frontmatter 与「联动技能」块。
3. `node scripts/common/render-skill-catalog.js`：重渲染 `docs/skill-catalog.md`。
4. `node scripts/common/sync-skills.js`：同步 `.agents/plugins/workspace-governance/skills/` 镜像（该目录被 `.gitignore` 忽略，fresh clone 需先同步）。
5. `node scripts/common/validate-skills.js` 收口：注册表与磁盘闭包、触发词契约、联动完整性、说明书同源一次判定；再执行 `pwsh -File scripts/ps1/audit-all.ps1 -Fast`。

- 第 2~4 步都支持 `--check`：只比对不写盘，漂移时退出码为 1（`scripts/common/sync-skill-metadata.js:132`、`scripts/common/render-skill-catalog.js:238`、`scripts/common/sync-skills.js:145-152`）。`validate-skills.js` 本身就是只读校验，没有 `--check`。
- 顺序不能倒：先 sync 元数据、再渲染说明书，两处都由同一个解析器派生，才能保证同源；最后同步镜像并跑校验。
- 不要手改生成物：SKILL.md 的 frontmatter 与联动块、`docs/skill-catalog.md` 都是渲染结果，手改会在下一次 sync 被覆盖或被 `--check` 判红。

## 六、看守规则：三道闸各自看守什么

三道闸门都落在 `validate-skills.js`，以两段式断言名报错（`SKILL_ASSERTIONS`，`scripts/common/validate-skills.js:53-55`）：

- `SKILL-METADATA`（元数据闭合）：`checkRegistryClosure` 双向比对注册表与 `.agents/skills` 目录，`checkTriggerContract` 逐技能核对触发词契约，`validateRegistryMetadata` 比对描述渲染漂移。多一个未登记目录、少一条注册记录或手改描述，都会在这一闸暴露。
- `SKILL-LINKAGE`（联动完整性）：`validateRegistryLinkage` 校验领域链、领域支援、场景引用与 SubAgent 原型；链断裂时渲染出的 `../<ghost>/SKILL.md` 会被死链校验直接拦下（链接渲染见 `scripts/common/skill-registry-resolver.js:203`）。
- `SKILL-CATALOG`（说明书同源）：`validateSkillCatalogDocument` 断言 `docs/skill-catalog.md` 与注册表渲染逐字节一致，防止说明书与入口元数据各说一套。

三项断言名都取两段式（`SKILL_ASSERTIONS`，`scripts/common/validate-skills.js:47-55`）是刻意的：规则 ID 必须登记在 SSOT 目录才可引用，而这三位是校验断言而非规则，两段式可避免规则引用扫描把诊断名当成未登记规则。

## 七、常见失败模式

- 手改 SKILL.md 的 frontmatter 或联动块：下一次 `sync-skill-metadata.js` 直接覆盖，`--check` 当场判红。
- 只改 SKILL.md 不改注册表：改动在下一次渲染即丢失，注册表才是真源。
- 新增技能漏登记：磁盘目录存在但注册表没有，渲染循环不会为它生成描述与联动，激活面永远缺失。
- 领域链断裂或技能改名：联动块出现死链或 fallback 文案（`—（作为领域入口，无前置）`），孤儿资产与死链校验会拦截。
- 描述超出 50~200 窗口、触发词超出 6~9、单词超出 2~8 字符或类目不足：`validate-skills.js` 直接 BLOCK，提交门禁不过。
- 给校验断言起三段式规则 ID 形状的名字而未经登记：规则引用扫描会判为未登记（`RCFG-RULE-DRIFT`）。
- 忘同步插件镜像：`validate-skills.js` 报 plugin skills drift，重跑 `sync-skills.js` 才恢复。

本文（`references/skill-activation-and-linkage.md`）属于 JIT 深水区资产：`SKILL.md` 只在需要时链接到这里，本文不参与 frontmatter 渲染。
