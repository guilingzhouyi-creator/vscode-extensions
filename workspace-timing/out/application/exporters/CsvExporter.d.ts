/**
 * CsvExporter — CSV 导出器
 *
 * 将 WorkspaceTimingData 导出为 CSV：会话记录 + 按日统计。
 *
 * ⚠️ 时间戳统一使用**本地时区**格式化（YYYY-MM-DD HH:MM:SS），
 *    与聚合层的本地时区归桶口径一致——禁止使用 toISOString()（UTC），
 *    否则 UTC+8 用户早上 8 点前的会话会被归到前一天。
 */
import { WorkspaceTimingData } from '../../domain/models';
import { IDataExporter } from './IDataExporter';
export declare class CsvExporter implements IDataExporter {
    readonly formatName = "csv";
    export(data: WorkspaceTimingData, workspaceName: string): Promise<string>;
}
