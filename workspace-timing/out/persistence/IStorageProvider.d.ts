/**
 * IStorageProvider — 存储提供者接口
 *
 * 实现此接口可接入自定义存储后端。
 * 默认实现：
 *   - WorkspaceStateProvider (VS Code workspaceState)
 *   - FileStorageProvider (.vscode/workspace-timing.json)
 *   - JournalStorageProvider (.vscode/workspace-timing.journal)
 */
import { WorkspaceTimingData } from '../domain/models';
export interface IStorageProvider {
    /** 提供者唯一标识 */
    readonly id: string;
    /** 读取完整数据；没有数据时返回 null */
    load(): Promise<WorkspaceTimingData | null>;
    /** 写入完整数据 */
    save(data: WorkspaceTimingData): Promise<void>;
    /** 删除数据 */
    delete(): Promise<void>;
    /** 检查当前存储是否可用 */
    isAvailable(): boolean;
}
