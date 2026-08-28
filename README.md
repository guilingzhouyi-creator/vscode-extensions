# vscode-extensions 🛠

> 我的 VS Code 插件集合 | My VS Code extensions monorepo
> 轻量化 · 高可扩展 · 双语支持 · 崩溃安全

---

## 📌 仓库定位 | Scope

本仓库以 **VS Code 插件**为主体，另收录一个独立的 **Node CLI 静态分析工具**（`auto-refactor`，非 VS Code 扩展，不参与扩展打包/发布）。

> ⚠️ **Windows 工具链**（PowerShell 脚本、环境配置、桌面工具等）属于**另一条独立线**，不在本仓库内混放。请移步对应的 Windows 项目仓库。
>
> 两侧的**路线图**统一在下方 [🗺️ 路线图 Roadmap](#-路线图-roadmap) 中管理，便于整体规划，但**代码与文档**严格按板块区分存放。

---

## 📦 插件列表 | Extensions

| 插件 | 版本 | 状态 | 简介 |
|------|------|:--:|------|
| **[Workspace Timing](./workspace-timing)** | v0.4.4 | 🟢 已发布 | ⏱ 轻量化工作区时长追踪：自动计时、跨工作区聚合对比、12周热力图、24小时分布、双语界面热切换；RingBuffer + Journal 双写入，崩溃保护 |

> 🧰 **非扩展模块**：[auto-refactor](./auto-refactor) — 高性能、声明式、项目无关的自动化代码重构与静态质量分析引擎（常量提取 / 大文件拆分 / 圈复杂度），面向 CI/CD 与 IDE。能力：多语言适配（TS / JS / Rust，内置 oxc 快速路径）、warm daemon（IPC 常驻进程）、行级增量（reuseSubtree 子树复用）、**高性能自定义 Diff 基座（SWAR + BPM 向量化 + AST 语义）**、三级回滚（3-tier rollback）、Praxis 集成与分形 Git 工作树/门禁规范、CI 就绪结构化输出（JSON / SARIF / text），支持自定义分析器插件。**不含 `engines.vscode`，不会被 CI/打包/发布自动发现**，仅作为工具模块与本仓库并存。

---

## 📁 目录结构 | Structure

```
vscode-extensions/              ← 本仓库（VS Code 插件专用）
├── .vscode/                    ← 仓库级调试与设置（launch.json / tasks.json / settings.json）
│   └── workspace-timing.json / .journal  ← 运行时数据（gitignore，不入库）
├── workspace-timing/           ← 工作区时长追踪
│   ├── src/
│   │   ├── application/        ← 应用业务逻辑
│   │   ├── cache/              ← 缓存层（10 秒异步刷盘）
│   │   ├── domain/             ← 领域模型（RingBuffer、Timer、Journal）
│   │   ├── i18n/               ← 国际化（zh-CN / en）
│   │   ├── integration/        ← VS Code API 集成 + 命令注册
│   │   ├── persistence/        ← 持久化层（Journal + JSON + GlobalState）
│   │   └── presentation/       ← 表现层（Dashboard + StatusBar + Toast）
│   ├── .vscode/                ← 单扩展独立打开时的调试配置（备用）
│   ├── package.json
│   ├── README.md
│   └── LICENSE
├── auto-refactor/              ← 独立 Node CLI 静态分析引擎（非扩展，不参与打包/发布）
│   ├── src/                    ← analyzers / core（含 diff、praxis、rollback、swar）/ daemon / cli / utils
│   ├── scripts/                ← 基准 / 等价性 / 增量验证脚本
│   ├── testdata/               ← 语义化命名的投影边界夹具
│   ├── docs/                   ← 6 大主题分节设计/规格/性能文档（01-architecture … 05-specs-and-benchmarks + diagrams）
│   ├── DOCS.md                 ← 文档索引
│   └── package.json
├── <future-extension>/         ← 新扩展预留位：建目录 + 放 package.json（需声明 engines.vscode）即自动接入 CI/发布
├── scripts/                    ← 仓库级脚本库（按语言域分类：sh / ps1 / py，规范见 scripts/README.md）
│   ├── sh/                     ← Bash：package.sh（打包）、check-display-assets.sh（CI 资产校验）、
│   │                             auto-label / pr-gate / auto-merge-gate / release / test-release（CNB 门禁与发布）
│   ├── ps1/                    ← PowerShell：package.ps1（Windows 打包同构实现）
│   └── py/                     ← Python（预留域）
├── dist/                       ← ★ 统一包输出目录（gitignore，不入库）
│   └── <扩展名>/
│       ├── <扩展名>-<版本>.vsix    # 主产物（按扩展名分类）
│       └── SHA256SUMS.txt         # 校验和
├── archive/                    ← 版本归档（gitignore，不入库；已清理冗余 node_modules/dist）
├── .github/workflows/          ← CI 校验 + 自动发布流水线
├── .cnb/ + .cnb.yml            ← CNB 协作流水线（与 GitHub 双轨）
├── .node-version               ← Node 版本锁定（20）
└── .editorconfig / .gitattributes ← 换行与编码统一
```

> 📐 **新增扩展零配置接入**：在仓库顶层新建 `<扩展名>/` 目录并放入 `package.json`（**须声明 `engines.vscode`**，以此与 auto-refactor 等纯工具目录区分），
> CI 与发布流水线会自动发现并纳入（自动发现逻辑见两个 workflow 的「Detect extensions」步骤）。

---

## 🏷️ 打包与发布 | Packaging & Release

### 标记系统（Tag 规范）

```
<扩展名>-vMAJOR.MINOR.PATCH      例：workspace-timing-v0.4.1
```

每个扩展独立的 Tag 命名空间，互不冲突；旧全局 Tag（如 `v0.3.8`）仅作历史参考。

### 发布方式（三选一）

| 方式 | 操作 | 版本来源 |
|------|------|----------|
| **版本提交自动发布**（推荐） | push 到 main，提交信息以 `vX.Y.Z` 开头，且改动触及扩展目录 | 提交信息前缀 |
| **Tag 触发** | push 标签 `<扩展名>-vX.Y.Z` | Tag 本身 |
| **手动触发** | Actions → Release → Run workflow，可填扩展名与版本号 | 手动输入 |

发布产物自动附加到 [GitHub Releases](https://github.com/guilingzhouyi-creator/vscode-extensions/releases)（VSIX + SHA256 校验和），Release Notes 自动提取自扩展 `CHANGELOG.md` 对应版本段落。

### 本地打包

```powershell
# Windows
.\scripts\package.ps1                          # 打包全部扩展
.\scripts\package.ps1 -Name workspace-timing   # 只打包指定扩展
.\scripts\package.ps1 -Keep 3                  # dist 中每扩展保留最近 3 个版本

# Linux / macOS / CI（同构）
bash scripts/sh/package.sh                        # 打包全部
bash scripts/sh/package.sh --name workspace-timing --keep 3
bash scripts/sh/package.sh --skip-build           # 跳过编译仅打包
```

产物输出到 `dist/<扩展名>/`（不入库），与 CI 产出结构完全同构。

### 目录规范

- **根目录不散乱**：运行时数据（`.vscode/workspace-timing.*`）与工具缓存（`.cnb/.cache`、`dist/`、`archive/`）均 `gitignore`；根 `.vscode/` 仅放调试/设置，单扩展 `.vscode/` 为备用
- **归档集中**：历史快照统一 `archive/`，已清理 `archive/**/node_modules` 与 `dist` 冗余
- **换行统一**：`.gitattributes` 强制 `*.sh LF` / `*.ps1 CRLF` / `*.png binary`，配合 `.editorconfig`

---

## 🗺️ 路线图 Roadmap

> 规划分**两条线**：`🧊 Windows 工具链` 与 `🧩 VS Code 插件`。两线互不混放，分别跟踪各自进度。

### 🧩 VS Code 插件线（本仓库）

| 阶段 | 目标 | 状态 |
|------|------|:--:|
| ✅ v0.1.0 ~ v0.4.4 | **Workspace Timing** 功能迭代：自动计时、跨工作区对比、热力图、小时分布、双语支持、崩溃保护 | 已发布 |
| 🎯 下一插件 | **待定选题**（见下方「下一步规划」） | 规划中 |

### 🧰 工具模块线（本仓库，非扩展）

| 阶段 | 目标 | 状态 |
|------|------|:--:|
| ✅ v0.1.0 | **auto-refactor** 静态分析引擎：内置规则（常量提取/大文件/圈复杂度）+ 多语言适配 + 自定义 diff 基座（SWAR/BPM/AST） | 已落地 |
| 🚧 演进中 | diff/Praxis 集成、三级回滚、分形 Git 工作树与门禁规范（`docs/01-architecture/04-*`） | 持续迭代 |

### 🧊 Windows 工具链线（独立仓库）

| 阶段 | 目标 | 状态 |
|------|------|:--:|
| 📝 规划 | PowerShell 脚本 / 环境配置 / 桌面工具整理，独立成仓 | 待启动 |

> 💡 Windows 与 VS Code 插件分线维护：**文档不混放、代码不混仓、进度各表**，但统一在本 README 的路线图中总览。

---

## 🚀 下一步规划 | Next Steps

**准备下一个 VS Code 插件的开发**。候选方向（按可复用性 & 与现有扩展协同性排序）：

1. **💾 文件同步助手** — 基于 `workspace-timing` 的 i18n / 持久化 / 五层架构模板快速起步。
2. **🔍 代码片段增强** — 复用现有 `RingBuffer` + Journal 设计经验。
3. **🧩 与 Windows 工具链联动的插件** — 在 VS Code 内调用 Windows 侧能力（需先落地 Windows 线）。

> 📐 新插件统一遵循本仓既有规范：**TypeScript · 五层分层 · zh-CN/en 双语 · 崩溃安全**。

---

## 🔧 技术栈 | Tech Stack

**Workspace Timing（扩展）**
- **语言**：TypeScript
- **目标**：VS Code ≥ 1.85.0
- **架构**：五层分层（Domain → Cache → Persistence → Application → Presentation）
- **存储**：RingBuffer(1024) → Journal(NDJSON) → FullSave(JSON) 三级写入
- **国际化**：i18n 模块，zh-CN / en 双语
- **跨工作区**：ExtensionContext.globalState 全局聚合

**auto-refactor（工具模块）**
- **语言**：TypeScript，Node ≥ 20（`bin: auto-refactor`，CLI 可执行）
- **多语言解析**：TS / JS（TypeScript AST）+ Rust（`rustAdapter`）+ oxc 快速路径（`oxcAdapter`）
- **性能基座**：SWAR 位运算 + BPM 字节级向量化 + AST 语义的**自定义 Diff 基座**；懒投影零物化遍历；行级增量子树复用
- **架构**：分析器（analyzers）+ 规则引擎 + core（cache / config / dependencyGraph / rollback / praxis）+ daemon（IPC 常驻）+ cli + utils
- **输出**：JSON / SARIF / text，`config.schema.json` + `report.schema.json` 双 Schema
- **扩展**：自定义分析器插件契约 + 生命周期钩子（custom-analyzer-plugin）

---

## 📝 开发 | Development

```bash
# 克隆
git clone https://github.com/guilingzhouyi-creator/vscode-extensions.git
cd vscode-extensions/workspace-timing

# 安装依赖
npm install

# 编译
npm run compile

# 单元测试（需先 compile，用例断言编译产物 out/）
npm run test:unit

# lint
npm run lint
```

---

## 📄 许可证 | License

MIT © 2026 OriginalTC
