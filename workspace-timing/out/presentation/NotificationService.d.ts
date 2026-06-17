/**
 * NotificationService — 通知服务
 *
 * 职责：封装 VS Code 通知 API，提供统一的信息/警告/错误提示
 * 边界：不关心数据含义，只负责渲染通知
 */
export declare class NotificationService {
    /** 显示信息提示 */
    info(message: string): void;
    /** 显示警告提示 */
    warn(message: string): void;
    /** 显示错误提示 */
    error(message: string): void;
    /**
     * 显示信息提示（带操作按钮）
     * @returns 用户点击的按钮文本，未操作则返回 undefined
     */
    infoWithActions(message: string, ...actions: string[]): Promise<string | undefined>;
}
