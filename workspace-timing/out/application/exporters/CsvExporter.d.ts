/**
 * CsvExporter — CSV 导出器（预留）
 *
 * 将 WorkspaceTimingData 导出为 CSV 格式。
 * 后续配合 "workspaceTiming.export" 命令使用。
 */
import { WorkspaceTimingData } from '../../domain/models';
import { IDataExporter } from './IDataExporter';
export declare class CsvExporter implements IDataExporter {
    readonly formatName = "csv";
    export(data: WorkspaceTimingData, workspaceName: string): Promise<string>;
}
