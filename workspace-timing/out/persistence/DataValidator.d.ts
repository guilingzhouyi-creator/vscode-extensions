/**
 * DataValidator — 外部计时数据校验器
 *
 * 职责：还原（restore）前对不可信 JSON 做结构/数值校验与净化。
 * 边界：纯函数；**拒绝整体结构非法的文件，过滤条目级脏数据**——
 *       校验失败时绝不触碰现网数据。
 */
import { WorkspaceTimingData } from '../domain/models';
export interface ValidationResult {
    ok: boolean;
    /** ok=false 时的失败原因（面向用户的简短描述） */
    error?: string;
    /** 净化后的数据（ok=true 时可用） */
    data?: WorkspaceTimingData;
}
/** 校验并净化一份外部计时数据 */
export declare function validateTimingData(raw: unknown): ValidationResult;
