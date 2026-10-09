/**
 * Module: Storage Provider Interface (全量存储提供者抽象契约)
 * File Path: src/persistence/IStorageProvider.ts
 * Architecture Role: 持久化层主存储与冗余备份存储的统一抽象契约，规范全量数据存取与可用性探针行为。
 * Dependencies & Triggers: 依赖 domain/models 中的 WorkspaceTimingData 实体；被 StorageCoordinator 组合作为级联驱动。
 * Responsibilities: 规范全量数据加载 (load)、持久化 (save)、彻底清除 (delete) 以及健康探针 (isAvailable) 标准接口。
 * Exit Semantics & Design Rationale: 采用异步 Promise 接口，解耦具体存储实现（内存、键值、文件系统）；允许策略性插拔与多介质容灾。
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
