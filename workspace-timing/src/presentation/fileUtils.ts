/**
 * fileUtils — 展现层文件命名工具
 *
 * 导出/还原流程共用的纯函数集合。此前 CommandRegistrar 与 dashboardMessages
 * 各自复制了一份 sanitizeFileName 且行为不一致（后者多了 trim 与兜底），
 * 现收敛为单一实现，杜绝语义漂移。
 */

/** 清洗文件名中的非法字符（工作区名可能含 /\:*?"<>| 等）；空结果回退为 'workspace' */
export function sanitizeFileName(name: string): string {
    return name.replace(/[/\\:*?"<>|]/g, '_').trim() || 'workspace';
}