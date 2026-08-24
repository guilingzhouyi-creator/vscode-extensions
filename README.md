# vscode-extensions 🛠

> 我的 VS Code 插件集合 | My VS Code extensions monorepo
> 轻量化 · 高可扩展 · 双语支持 · 崩溃安全

---

## 📌 仓库定位 | Scope

本仓库**仅收录 VS Code 插件**相关代码与文档。

> ⚠️ **Windows 工具链**（PowerShell 脚本、环境配置、桌面工具等）属于**另一条独立线**，不在本仓库内混放。请移步对应的 Windows 项目仓库。
>
> 两侧的**路线图**统一在下方 [🗺️ 路线图 Roadmap](#-路线图-roadmap) 中管理，便于整体规划，但**代码与文档**严格按板块区分存放。

---

## 📦 插件列表 | Extensions

| 插件 | 版本 | 状态 | 简介 |
|------|------|:--:|------|
| **[Workspace Timing](./workspace-timing)** | v0.4.1 | 🟢 已发布 | ⏱ 轻量化工作区时长追踪：自动计时、跨工作区聚合、周报图表、仪表板、日/累计分离；环形缓冲区 + Journal 双写入，崩溃保护 |

---

## 📁 目录结构 | Structure

```
vscode-extensions/              ← 本仓库（VS Code 插件专用）
├── workspace-timing/           ← 工作区时长追踪
│   ├── src/
│   │   ├── application/        ← 应用业务逻辑
│   │   ├── cache/              ← 缓存层（10 秒异步刷盘）
│   │   ├── domain/             ← 领域模型（RingBuffer、Timer、Journal）
│   │   ├── i18n/               ← 国际化（zh-CN / en）
│   │   ├── integration/        ← VS Code API 集成 + 命令注册
│   │   ├── persistence/        ← 持久化层（Journal + JSON + GlobalState）
│   │   └── presentation/       ← 表现层（Dashboard + StatusBar + Toast）
│   ├── package.json
│   ├── README.md
│   └── LICENSE
├── <future-extension>/         ← 新扩展预留位：建目录 + 放 package.json 即自动接入 CI/发布
├── scripts/
│   └── package.ps1             ← 本地统一打包入口（输出到 dist/）
├── dist/                       ← ★ 统一包输出目录（gitignore，不入库）
│   └── <扩展名>/
│       ├── <扩展名>-<版本>.vsix    # 主产物（按扩展名分类）
│       └── SHA256SUMS.txt         # 校验和
└── .github/workflows/          ← CI 校验 + 自动发布流水线
```

> 📐 **新增扩展零配置接入**：在仓库顶层新建 `<扩展名>/` 目录并放入 `package.json`，
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
.\scripts\package.ps1                          # 打包全部扩展
.\scripts\package.ps1 -Name workspace-timing   # 只打包指定扩展
.\scripts\package.ps1 -Keep 3                  # dist 中每扩展保留最近 3 个版本
```

产物输出到 `dist/<扩展名>/`（不入库），与 CI 产出结构完全同构。

---

## 🗺️ 路线图 Roadmap

> 规划分**两条线**：`🧊 Windows 工具链` 与 `🧩 VS Code 插件`。两线互不混放，分别跟踪各自进度。

### 🧩 VS Code 插件线（本仓库）

| 阶段 | 目标 | 状态 |
|------|------|:--:|
| ✅ v0.1.0 | **Workspace Timing** 首个插件发布（计时 + 周报 + 崩溃保护） | 已完成 |
| 🚧 v0.2.0 | **Workspace Timing** 迭代：CSV 导出 ✅、云端同步占位 ✅、多工作区对比 ✅ | 功能完成 |
| 🎯 下一插件 | **待定选题**（见下方「下一步规划」） | 规划中 |

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

- **语言**：TypeScript
- **目标**：VS Code ≥ 1.85.0
- **架构**：五层分层（Domain → Cache → Persistence → Application → Presentation）
- **存储**：RingBuffer(1024) → Journal(NDJSON) → FullSave(JSON) 三级写入
- **国际化**：i18n 模块，zh-CN / en 双语
- **跨工作区**：ExtensionContext.globalState 全局聚合

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
