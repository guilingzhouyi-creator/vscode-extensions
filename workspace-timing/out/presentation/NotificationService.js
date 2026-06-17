"use strict";
/**
 * NotificationService — 通知服务
 *
 * 职责：封装 VS Code 通知 API，提供统一的信息/警告/错误提示
 * 边界：不关心数据含义，只负责渲染通知
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationService = void 0;
const vscode = __importStar(require("vscode"));
class NotificationService {
    /** 显示信息提示 */
    info(message) {
        vscode.window.showInformationMessage(`[WSTiming] ${message}`);
    }
    /** 显示警告提示 */
    warn(message) {
        vscode.window.showWarningMessage(`[WSTiming] ${message}`);
    }
    /** 显示错误提示 */
    error(message) {
        vscode.window.showErrorMessage(`[WSTiming] ${message}`);
    }
    /**
     * 显示信息提示（带操作按钮）
     * @returns 用户点击的按钮文本，未操作则返回 undefined
     */
    async infoWithActions(message, ...actions) {
        return vscode.window.showInformationMessage(`[WSTiming] ${message}`, { modal: false }, ...actions);
    }
}
exports.NotificationService = NotificationService;
//# sourceMappingURL=NotificationService.js.map