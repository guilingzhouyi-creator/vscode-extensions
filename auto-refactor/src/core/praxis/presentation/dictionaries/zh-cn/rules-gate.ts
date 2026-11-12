/**
 * Module: Core Engine - Praxis Presentation Chinese Gate & Hygiene Dictionary
 * File Path: src/core/praxis/presentation/dictionaries/zh-cn/rules-gate.ts
 * Architecture Role: Chinese localization table for Guard, Hygiene, and Production rules.
 * Dependencies & Triggers: Consumed by zh-cn.ts barrel and PraxisI18nProvider.
 * Responsibilities: Export localized descriptors for GUARD, HYG, and PROD canonical rules.
 * Exit Semantics & Design Rationale: Pure immutable constant lookup map with zero runtime deps.
 */

import type { PraxisRuleI18nEntry } from '../../i18n-types';

/**
 * 门禁防线、物理卫生与生产构建领域规则中文本地化字典。
 */
export const ZH_CN_GATE_RULES: Record<string, PraxisRuleI18nEntry> = {
    'GUARD-AST-001': {
        name: '提交切片 AST 复杂度门禁缺失',
        summary: '预提交门禁缺少针对暂存切片代码的复杂度 (CC <= 15) 与嵌套深度 (Depth <= 4) 检查。',
        remediation: '在 pre-commit 钩子中启用暂存切片校验守卫，阻断超限变更提交。',
    },
    'GUARD-BASE-001': {
        name: '质量基线单调棘轮守护',
        summary: '多维自审指标（体积预算、逆向层级耦合或标准化平衡）不得低于冻结基线。',
        remediation: '修复回退维度的代码退化，或经评审后提交带充分理由的基线说明记录。',
    },
    'GUARD-BUDGET-001': {
        name: '预提交门禁缺少切片耗时收敛',
        summary: 'pre-commit 阶段无差别运行全仓测试且未按暂存文件过滤，易突破本地执行时预算。',
        remediation: '分级收敛门禁预算：提交前保持秒级增量检测，全量回归下沉至推送前阶段。',
    },
    'GUARD-DESTR-001': {
        name: '危险路径递归删除操作',
        summary: '递归删除目标指向根目录、宿主或用户主目录、或经变量别名传导的未界定路径。',
        remediation: '仅删除脚本自建或显式常量路径，并在删除前校验目标非空且非根目录或主目录。',
    },
    'GUARD-ERR-001': {
        name: '门禁脚本缺少严格失败中止声明',
        summary: '门禁脚本未启用严格错误中止标志，可能导致底层步骤报错后静默放行。',
        remediation:
            '在 Bash 启用 set -euo pipefail，或在 PowerShell 设置 $ErrorActionPreference 为 Stop。',
    },
    'GUARD-FAC-001': {
        name: '门面实质承载校验缺口',
        summary: '门禁流水线缺少对门面模块实质承载量 (ELOC >= 15) 与空转跳板消融的静态检查。',
        remediation: '在门禁链路接入门面纪律校验，拦截薄封装透传文件与无实质编排的导出外壳。',
    },
    'GUARD-FBK-001': {
        name: '门禁反馈闭环词表守卫',
        summary: '门禁输出使用了位置型阶段标签或非标准状态同义词，违背闭环判定词表契约。',
        remediation: '改用注册表语义步骤编号，并将方括号状态统一限定为 PASS、BLOCK、SKIP 或 WARN。',
    },
    'GUARD-HOOK-001': {
        name: '本地左移 Git 钩子缺失',
        summary: '仓库缺少本地左移校验钩子，物理卫生与回归缺陷全部滞后至远端集成阶段暴露。',
        remediation: '装配标准化的 .githooks 或本地钩子路由，在提交和推送前完成本地左移拦截。',
    },
    'GUARD-HYG-001': {
        name: '预提交物理卫生检测缺口',
        summary: 'pre-commit 门禁未拦截零字节空文件及跨平台换行符混用问题。',
        remediation: '在提交前门禁接入物理卫生校验，阻断 0 字节文件与非约定换行符入库。',
    },
    'GUARD-ISO-001': {
        name: '本地与远端双层门禁不同构',
        summary: '远端持续集成检查项未在本地推前门禁中镜像覆盖，存在提交后才触发失败的盲区。',
        remediation: '同步本地与 CI 检查步骤注册表，保持本地左移检查与远端沙箱结果一致。',
    },
    'GUARD-MSG-001': {
        name: '提交信息结构契约校验缺失',
        summary: 'commit-msg 门禁缺少规范化前缀、项目归属标记及分段结构完整性校验。',
        remediation: '部署结构化提交信息校验门禁，强制包含规范类型、项目归属及验证结论段。',
    },
    'GUARD-MSG-002': {
        name: '提交信息禁词表未接线',
        summary: 'commit-msg 门禁未加载双语风格禁词单源配置，无法拦截主观套话或虚构数字描述。',
        remediation: '将 commit-msg-forbidden-terms 接入提交门禁，确保提交说明客观准确。',
    },
    'GUARD-MSG-003': {
        name: '多包仓库提交缺少项目归属标注',
        summary: 'Monorepo 提交门禁未强制校验证明所属子项目作用域的 [Project] 段落与白名单。',
        remediation: '在提交门禁启用项目归属段落验证，校验所有变更文件所属子域一致性。',
    },
    'GUARD-PAIR-001': {
        name: '跨平台门禁脚本缺少双端配对',
        summary: 'Shell 与 PowerShell 门禁脚本未形成同构配对，单一平台缺少对应脚本实现。',
        remediation: '在 scripts/sh 与 scripts/ps1 中补全功能与步骤注册表对等的双端门禁脚本。',
    },
    'GUARD-PROC-001': {
        name: 'PowerShell 交互提示缺少重定向守卫',
        summary: 'PowerShell 门禁脚本在重定向或无头管道环境下调用交互输入可能阻塞挂起。',
        remediation: '在交互读取前校验 UserInteractive 为真且标准输出未被重定向。',
    },
    'GUARD-ROUTE-001': {
        name: '钩子路由器直调易碎宿主壳',
        summary: 'Git 钩子入口直接调用脆弱 /bin/sh 或旧版 Windows PowerShell 5.1 而未做兼容回退。',
        remediation: '优先探测 pwsh 7+ 执行路由，缺失时平滑回退至具备 POSIX 完整特性的 bash。',
    },
    'GUARD-SSOT-001': {
        name: '门禁规则未对齐单源注册目录',
        summary: '门禁校验脚本使用分散的硬编码规则列表，存在规则编号漂移或悬空风险。',
        remediation: '接入单源 rule-catalog 真源校验，阻断未登记规则 ID 与双向闭合缺口。',
    },
    'GUARD-SYS-001': {
        name: '仓库缺少两级门禁防御体系',
        summary: '未在仓库中检测到有效的本地 Git 钩子与远端流水线联动校验结构。',
        remediation: '初始化涵盖 pre-commit、commit-msg、pre-push 与 CI 的分层门禁体系。',
    },
    'GUARD-VAR-001': {
        name: 'PowerShell 写入只读自动变量',
        summary: '脚本尝试向 $PID、$PWD 或 $Matches 等 PowerShell 只读自动变量赋值导致异常或失效。',
        remediation: '重命名业务局部变量标识符，避免与 PowerShell 内置只读自动变量同名冲突。',
    },
    'HYG-BOM-001': {
        name: '文件头部存在 UTF-8 BOM 字节序标记',
        summary: '源文件包含 0xEF 0xBB 0xBF 前缀字节序标记，可能破坏跨平台解析器与哈希对齐。',
        remediation: '将文件重新保存为无 BOM 的纯 UTF-8 编码格式并清理首部标记字节。',
    },
    'HYG-CLT-001': {
        name: '工作区残留未管控临时杂物文件',
        summary: '源码目录遗留构建日志转储、备份碎片或系统桌面元数据文件。',
        remediation: '清理滞留的瞬态杂物文件，并在对应层级的 .gitignore 中补全忽略模式。',
    },
    'HYG-DIR-001': {
        name: '源码或工具树存在游离空目录',
        summary: '在排除忽略目录后，该活跃目录中不包含任何有效源码或配置文件。',
        remediation: '删除不再使用的空目录，或补齐原定由该目录承载的有效模块实现。',
    },
    'HYG-EMP-002': {
        name: '剔除注释后文件不含实质逻辑',
        summary: '目标源文件除头部说明与注释外缺乏可执行声明、类型定义或有效导出逻辑。',
        remediation: '补充领域实质代码实现，或确认无需求后删除空壳占位文件。',
    },
    'HYG-EOL-001': {
        name: '文件物理行尾换行符契约违例',
        summary: '文件行尾结束符不符合双端约定（PowerShell 脚本须为 CRLF，其余文本文件须为 LF）。',
        remediation: '按文件扩展名规范统一换行符格式，将普通源码转为 LF 并将 .ps1 转为 CRLF。',
    },
    'HYG-IND-001': {
        name: '源码缩进包含非法制表符 Tab',
        summary: '非 Tab 语言源码中混入硬制表符，违背纯空格缩进排版契约。',
        remediation: '将全部制表符替换为规范空格缩进（TS 采用 4 空格，配置及 JS 脚本按约定缩进）。',
    },
    'HYG-SUP-001': {
        name: '未获豁免的编译器或 Lint 静默指令',
        summary: '代码中使用 @ts-ignore、eslint-disable 或 # noqa 等抑制注释绕过检查且未登记理由。',
        remediation: '根治底层类型或规则告警并移除静默指令；如属边界特例须补充标准豁免注解。',
    },
    'HYG-TRL-001': {
        name: '文件末尾换行符违背 POSIX 单换行规范',
        summary: '文件缺少末尾终止换行符，或文件尾部堆积多行连续空行。',
        remediation: '修剪文件尾端冗余空行，保留并确保存在唯一一个终止换行符。',
    },
    'PROD-HYG-001': {
        name: '生产产物残留调试输出与本地路径',
        summary: '构建产物中遗留 console 调试日志、TODO 标记或暴露本地主机文件路径。',
        remediation: '配置打包压缩规则自动剥离调试语句并启用源码路径规范化重写。',
    },
    'PROD-HYG-002': {
        name: '生产构建向客户端暴露 SourceMap',
        summary: '面向终用户的生产产物随附开放映射文件或保留 sourceMappingURL 注释引用。',
        remediation: '关闭公开 SourceMap 输出，或仅将符号文件私有上传至受控错误收集平台。',
    },
    'PROD-HYG-003': {
        name: '后端敏感环境变量泄漏至客户端包',
        summary: '密钥令牌、数据库凭证或私密服务端环境变量名称及默认值被打包进前端产物。',
        remediation: '严格隔离服务端环境变量读取边界，仅允许白名单公开前缀变量注入前端构建。',
    },
};
