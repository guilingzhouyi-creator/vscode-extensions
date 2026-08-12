/**
 * CsvExporter — CSV 导出器
 *
 * 导出会话记录 + 每日统计 + 效率数据。
 */
import { WorkspaceTimingData } from '../../domain/models';
import { DashboardData } from '../../domain/dashboard-types';
import { IDataExporter } from './IDataExporter';
export declare class CsvExporter implements IDataExporter {
    readonly formatName = "csv";
    /** 原始数据导出（仅会话记录）*/
    export(data: WorkspaceTimingData, workspaceName: string): Promise<string>;
    /** 面板数据导出（会话 + 每日统计 + 效率）*/
    exportDashboard(data: DashboardData, workspaceName: string): string;
}
