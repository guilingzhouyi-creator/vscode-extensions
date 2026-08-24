"use strict";
/**
 * IJournalStore — journal 存储端口（依赖倒置）
 *
 * JournalWriter 只依赖此窄接口，不感知具体落盘实现（当前为 persistence/JournalStorageProvider）。
 * 目的：
 *   1. 消除 cache → persistence 具体类的反向依赖；
 *   2. 单测可用纯 Node 假实现替换，脱离 VS Code 文件系统。
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=IJournalStore.js.map