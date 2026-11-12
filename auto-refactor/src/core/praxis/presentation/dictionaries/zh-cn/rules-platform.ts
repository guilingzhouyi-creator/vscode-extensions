/**
 * Module: Core Engine - Praxis Presentation Chinese Platform Dictionary
 * File Path: src/core/praxis/presentation/dictionaries/zh-cn/rules-platform.ts
 * Architecture Role: Chinese localization table for Shell, PS, UI, Volume, VSCode rules.
 * Dependencies & Triggers: Consumed by zh-cn.ts barrel and PraxisI18nProvider.
 * Responsibilities: Export localized descriptors for EXT/PS/SH/SEC-EXP/UI-ENG/VOL/VSC rules.
 * Exit Semantics & Design Rationale: Pure immutable constant lookup map with zero runtime deps.
 */

import type { PraxisRuleI18nEntry } from '../../i18n-types';

/**
 * 跨端脚本、前端交互、体积预算与扩展宿主领域规则中文本地化字典。
 */
export const ZH_CN_PLATFORM_RULES: Record<string, PraxisRuleI18nEntry> = {
    'EXT-DIR-001': {
        name: '脚本文件目录分类违例',
        summary: '可执行工具脚本散落于仓库根目录，未按运行环境与领域职责归位至专有子目录。',
        remediation: '将脚本迁入与扩展名及功能域对应的 scripts 子目录并更新关联路径引用。',
    },
    'PS-DOC-001': {
        name: 'PowerShell 脚本缺少标准注释头',
        summary: 'PowerShell 脚本或导出函数顶部缺少标准 Comment-Based Help (.SYNOPSIS) 文档块。',
        remediation: '在脚本及公共函数起始处补充 <# .SYNOPSIS ... .DESCRIPTION #> 标准文档块。',
    },
    'PS-SAFE-001': {
        name: 'PowerShell 交互读取缺少无头终端守卫',
        summary: '脚本在未检查终端可交互状态与 -Force 参数的情况下直接调用阻塞式交互读取。',
        remediation: '增加 [Environment]::UserInteractive 检查与 -Force 非交互直通开关。',
    },
    'PS-SEC-001': {
        name: 'PowerShell 动态字符串执行注入风险',
        summary: '对包含外部或动态变量拼接的字符串调用 Invoke-Expression (iex)，存在命令注入风险。',
        remediation: '改用参数展开数组传参及调用运算符 (& $cmd @args) 安全调度外部命令。',
    },
    'PS-TRAP-001': {
        name: 'PowerShell 系统句柄缺少释放保护',
        summary: '创建文件流、互斥量或进程等非托管句柄后未置于 try-finally 结构中确定性释放。',
        remediation: '使用 try { ... } finally { $handle.Dispose() } 守卫所有临界资源句柄。',
    },
    'SEC-EXP-001': {
        name: '客户端暴露未鉴权或内部管理接口路径',
        summary: '前端代码中硬编码或暴露内部运维端点、管理台地址或缺少鉴权的后台路由。',
        remediation: '剥离前端直连内部路由引用，统一经受权认证的服务端网关代理转发。',
    },
    'SEC-EXP-002': {
        name: '仅靠界面隐藏替代服务端权限校验',
        summary: '通过 CSS 隐藏 (display:none) 或按钮禁用作为敏感操作的唯一访问控制屏障。',
        remediation: '在对应服务端接口层强制实施会话身份鉴别与细粒度角色权限拦截。',
    },
    'SEC-EXP-003': {
        name: '关闭状态的特性开关随附未发布逻辑包',
        summary: '已关闭或未发布的特性开关仍在客户端产物中打包进完整业务实现代码，造成泄漏。',
        remediation: '结合编译期常量裁剪或按需动态分包机制剔除未开启特性分支实现。',
    },
    'SEC-EXP-004': {
        name: '生产构建打包测试预览与开发路由',
        summary: '开发调试、预演测试或实验性质路由未在生产产物构建阶段排除出客户端清单。',
        remediation: '在路由表引入构建期环境条件裁剪，严禁测试与预览入口流入发布包。',
    },
    'SEC-EXP-005': {
        name: '跨窗口消息监听缺少来源与激活校验',
        summary: '处理敏感行为的 postMessage 监听器未校验 event.origin 或用户瞬时激活态。',
        remediation: '在处理前显式比对可信源白名单并校验 event.userActivation?.isActive 状态。',
    },
    'SH-COND-001': {
        name: 'Bash 脚本使用脆弱单括号复合条件判断',
        summary: '在 Bash 脚本中使用单中括号 [ ... ] 结合复合逻辑或正则匹配，易因分词出错。',
        remediation: '在 Bash 环境下统一使用健壮的 [[ ... ]] 条件测试结构。',
    },
    'SH-DOC-001': {
        name: 'Shell 脚本缺少标准模块头部契约',
        summary: 'Shell 脚本头部缺少标准模块元数据说明字段（# Module / Description / Usage）。',
        remediation: '在 Shebang 之后紧接补全标准模块用途、职责与参数调用契约头注释。',
    },
    'SH-EOL-001': {
        name: 'Shell 脚本混入 Windows CRLF 换行',
        summary: 'POSIX Shell 脚本中存在回车换行符 CRLF，在 Linux 与 macOS 上将无法直接解释执行。',
        remediation: '通过脚本或编辑器将文件全文转换为纯 LF 换行格式并提交规范配置。',
    },
    'SH-EXIT-001': {
        name: 'strict 模式下裸执行预期返回非零命令',
        summary: '在启用 set -e 的脚本中直接裸执行合法可能返回非零退出码的探测命令导致误中断。',
        remediation: '使用 STATUS=0; cmd || STATUS=$? 或条件语句显式接管非零返回码。',
    },
    'SH-SAFE-001': {
        name: 'Shell 交互读入缺少超时或终端判定',
        summary: '使用阻塞式 read 命令读取用户输入而未配置超时时限及 TTY 终端交互校验。',
        remediation: '补充超时参数 (如 read -t 10) 并在读取前使用 [[ -t 0 ]] 检测终端交互性。',
    },
    'SH-SEC-001': {
        name: 'Shell 对含变量指令使用 eval 动态求值',
        summary: '通过 eval 拼接展开变量执行命令，极易受空格分词或恶意字符注入引发越权执行。',
        remediation: '采用数组参数传递 ("${CMD[@]}") 或显式命令分支分发替代动态 eval 求值。',
    },
    'SH-TRAP-001': {
        name: 'Shell 创建临时文件未注册 EXIT 清理钩子',
        summary: '申请临时文件或目录资源后未立即挂载 trap ... EXIT 回收清理逻辑，易导致孤儿残留。',
        remediation: '在 mktemp 创建临时资源的紧邻下一行立即注册 EXIT/INT/TERM 清理陷阱。',
    },
    'UI-ENG-001': {
        name: '交互式前端元素缺少语义化与无障碍属性',
        summary: '图片、表单输入及自定义交互组件缺乏 alt 文本、无障碍标签或显式 ARIA 角色。',
        remediation: '为媒体元素补充准确描述并给控件绑定 aria-label 或关联原生 label 标签。',
    },
    'UI-ENG-002': {
        name: 'DOM 层级过深或动画触发几何重排',
        summary: '节点嵌套深度超出阈值 (<= 12) 或 CSS 过渡直接修改触发布局重排的几何属性。',
        remediation: '扁平化组件树结构，并将动画属性迁移至合成层 transform 与 opacity 属性。',
    },
    'UI-ENG-003': {
        name: '前端组件属性过载或重复大段模板子树',
        summary: '组件声明 Props 超出上限 (> 10) 或内部堆砌未抽象复用的复杂重复 DOM 子树。',
        remediation: '按职责拆分为聚合型微组件，并将关联参数收敛为清晰的结构化选项对象。',
    },
    'UI-ENG-004': {
        name: '前端 Hook 与事件回调命名约定偏离',
        summary: '自定义状态钩子未使用 use* 前缀，或事件处理函数未使用 on*/handle* 规范命名。',
        remediation: '将自定义 Hook 对齐 use* 前缀，并将回调与处理器重命名为 on* 或 handle*。',
    },
    'UI-ENG-005': {
        name: '输入框 Enter 提交缺少中文输入法合成锁守卫',
        summary: '输入框或文本域的回车键监听未判断输入法合成状态，导致候选词上屏误触提交。',
        remediation: '在提交逻辑前校验 !e.nativeEvent.isComposing 且 e.keyCode !== 229。',
    },
    'UI-ENG-006': {
        name: '动态指标与计时数值缺少等宽数字字体排版',
        summary: '高频刷新计数器、时间戳或指标展示未使用 tabular-nums，易造成水平抖动。',
        remediation: '为数值容器应用 font-variant-numeric: tabular-nums 消除不等宽字形跳动。',
    },
    'UI-ENG-007': {
        name: '嵌套交互控件违反单闭合边框视觉规则',
        summary: '带边框的交互元素嵌套在同样拥有实线边框的外壳内，产生冗余视觉线框套娃。',
        remediation: '剥离内层冗余边框，改用背景明度对比或内阴影高光区分可交互区域。',
    },
    'UI-ENG-008': {
        name: '局部组件响应与中文排版断行契约缺失',
        summary: '卡片或 Webview 组件滥用视口级 @media，或中文正文容器缺少防挤压与断行控制。',
        remediation: '将局部响应切换为 @container 容器查询，并为文本配置平衡换行或断字规则。',
    },
    'VOL-DIL-001': {
        name: '垂直逻辑密度稀释底线告警',
        summary: '源码有效代码行与物理行数比例过低，存在空行过度堆砌或空壳占位函数稀释体量。',
        remediation: '消除无意义的连续空白分隔与碎片段占位体，保持紧凑均衡的垂直排版密度。',
    },
    'VOL-DOC-001': {
        name: '高负载逻辑模块注释契约比率不足',
        summary: '有效行数达到或超过 600 行的高复杂度核心模块未能维持至少 8% 的契约注释占比。',
        remediation: '补充类型边界、状态机不变量与算法复杂度前提说明，完善模块顶部六字段头。',
    },
    'VOL-ELOC-001': {
        name: '单文件有效代码行预算超限',
        summary: '单文件有效可执行行数超过 900 行，显著抬升人工审阅认知负荷与上下文窗口压力。',
        remediation: '依据单一职责原则沿业务边界拆分为多个高内聚的协同子模块。',
    },
    'VOL-LOC-001': {
        name: '单文件物理总行数预算超限',
        summary: '文件物理总行数突破 1400 行封顶红线，影响跨端编辑响应速度与模块化边界清晰度。',
        remediation: '将大文件拆分为职责单一的小型单元，把长篇参考说明下沉为独立 Markdown。',
    },
    'VOL-POR-001': {
        name: '模块胶水管道开销占比超标',
        summary: '模块中导入、重导出及透传转发等布线行占比超过 60%，掩盖了领域实质计算载荷。',
        remediation: '将无实质增值的空转封装内联回调用侧，或将组合接线收口至专门装配根模块。',
    },
    'VOL-RATIO-001': {
        name: '物理总行与有效行动态稀释包络超标',
        summary: '物理行相对有效代码行的膨胀倍率突破 1:3 保护包络，注释或断行过度冗余。',
        remediation: '合并碎片化的链式换行表达式，并将冗长描述性注释归档入独立设计文档。',
    },
    'VOL-TAU-001': {
        name: '行均语义 Token 密度低于下限',
        summary: '每有效行承载的平均语义词元低于 2.5，文件被孤立括号、单参数换行或碎片声明打散。',
        remediation: '归并过度竖直拆散的函数调用与声明，将四参数以上调用收敛为配置参数对象。',
    },
    'VOL-TAU-002': {
        name: '行均语义 Token 密度高于上限',
        summary: '单有效行平均语义词元超出 22，单行堆积过长嵌套逻辑或巨型链式调用削弱可读性。',
        remediation: '从超长单行链式表达式中提取语义中间变量，分段展开高密度判断逻辑。',
    },
    'VSC-PERF-002': {
        name: 'Webview 动画属性触发布局几何重排',
        summary: 'VS Code Webview 样式对 width、height、top、left 等几何属性做 CSS 过渡动画。',
        remediation: '将动画过渡目标切换为合成属性 transform 与 opacity，避免浏览器频繁重排。',
    },
    'VSC-UI-001': {
        name: 'Webview 列表视图缺少密度上限与折叠控制',
        summary: 'Webview 动态渲染超过 5 条记录的列表集合时未配置有界分页或折叠展开开关。',
        remediation: '按视口面板空间实现有界阈值截断与渐进折叠展示，控制初始视觉密度。',
    },
    'VSC-UI-002': {
        name: 'Webview 样式硬编码静态色彩值',
        summary: 'Webview CSS 使用静态十六进制颜色或固定黑白灰值，无法响应宿主明暗主题切换。',
        remediation: '全面迁移为 VS Code 语义主题变量 (var(--vscode-*))，兼容全部配色主题。',
    },
    'VSC-UI-003': {
        name: 'Webview 交互表单控件缺少无障碍名称绑定',
        summary: 'VS Code Webview 中的输入、选择或按钮控件缺少可读无障碍标签或 aria 绑定。',
        remediation: '为可聚焦控件补全 aria-label、aria-labelledby 或关联明确的 label 元素。',
    },
    'VSC-UI-004': {
        name: 'Webview 悬停或激活态动态改变边框宽度',
        summary: '交互伪类动态修改 border-width 引发文字及邻近元素发生像素级布局跳动。',
        remediation: '保持静态透明边框占位或改用内阴影 box-shadow inset 绘制高亮边界。',
    },
};
