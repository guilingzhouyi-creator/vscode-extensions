/**
 * Universal 999px Pill Segmented Control
 * 
 * 核心机制：
 * 1. 999px 全圆角轨道，严格 2px 几何内边距；
 * 2. 纯几何绝对定位，120ms 瞬时咬合；
 * 3. 容器查询 @container 自适应收缩。
 */

import React from 'react';

export interface SegmentedItem<T extends string> {
    readonly id: T;
    readonly label: string;
    readonly icon?: React.ReactNode;
}

export interface SegmentedControlProps<T extends string> {
    readonly items: readonly SegmentedItem<T>[];
    readonly selectedId: T;
    readonly onSelect: (id: T) => void;
    readonly className?: string;
}

export function SegmentedControl<T extends string>({
    items,
    selectedId,
    onSelect,
    className = '',
}: SegmentedControlProps<T>) {
    const activeIndex = items.findIndex((item) => item.id === selectedId);
    const total = items.length;

    const leftPercent = activeIndex >= 0 ? (activeIndex * 100) / total : 0;
    const widthPercent = total > 0 ? 100 / total : 100;

    return (
        <div
            role="tablist"
            className={`relative inline-flex items-center rounded-full p-[2px] bg-neutral-200/60 dark:bg-neutral-800/80 ${className}`}
            style={{ containerType: 'inline-size' }}
        >
            {/* 纯几何定位滑动指示器 */}
            {activeIndex >= 0 && (
                <div
                    aria-hidden="true"
                    className="absolute top-[2px] bottom-[2px] rounded-full bg-white dark:bg-neutral-700 shadow-sm transition-all duration-150 ease-[cubic-bezier(0.32,0.72,0,1)]"
                    style={{
                        left: `calc(2px + ${leftPercent}% * (1 - 4px / 100%))`,
                        width: `calc(${widthPercent}% - 4px / ${total})`,
                    }}
                />
            )}

            {/* 各选项标签 */}
            {items.map((item) => {
                const isSelected = item.id === selectedId;
                return (
                    <button
                        key={item.id}
                        role="tab"
                        type="button"
                        aria-selected={isSelected}
                        onClick={() => onSelect(item.id)}
                        className={`relative z-10 flex-1 px-3 py-1 text-xs font-medium rounded-full transition-colors duration-150 flex items-center justify-center gap-1.5 ${
                            isSelected
                                ? 'text-neutral-900 dark:text-neutral-100'
                                : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
                        }`}
                    >
                        {item.icon}
                        <span className="truncate">{item.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
