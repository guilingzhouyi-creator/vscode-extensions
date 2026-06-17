/**
 * GlobalStorageProvider — 全局存储提供者
 *
 * 通过 VS Code 的 ExtensionContext.globalState 实现跨工作区数据共享。
 * 用于跨工作区累计时长汇总。
 */
import * as vscode from 'vscode';
import { GlobalTimingData } from '../domain/global-types';
export declare class GlobalStorageProvider {
    private readonly context;
    private _available;
    constructor(context: vscode.ExtensionContext);
    isAvailable(): boolean;
    /** 读取全局数据 */
    load(): Promise<GlobalTimingData>;
    /** 写入全局数据 */
    save(data: GlobalTimingData): Promise<void>;
    /** 清空全局数据 */
    delete(): Promise<void>;
}
