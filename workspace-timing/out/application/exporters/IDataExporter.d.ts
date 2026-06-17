/**
 * IDataExporter — 数据导出器接口（预留扩展点）
 *
 * 实现此接口可支持不同的导出格式。
 */
import { WorkspaceTimingData } from '../../domain/models';
export interface IDataExporter {
    readonly formatName: string;
    export(data: WorkspaceTimingData, workspaceName: string): Promise<string>;
}
