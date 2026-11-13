/**
 * Module: Interaction Design Physics — 999px Pill Segmented Control Component
 * File Path: .agents/skills/interaction-design-physics/templates/segmented-control-pill.tsx
 * Architecture Role: Accessible tablist pill component with geometric sliding indicator.
 * Dependencies & Triggers: Depends on React; rendered inside toolbar and filter headers.
 * Responsibilities: Compute percentage-based indicator geometry with 2px inset padding and container-query support.
 * Exit Semantics & Design Rationale: Pure controlled React component; avoids layout thrashing during tab switches.
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
            {/* Pure geometry-aligned sliding indicator */}
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

            {/* Segmented tab labels */}
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
