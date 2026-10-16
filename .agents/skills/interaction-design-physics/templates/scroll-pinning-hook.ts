/**
 * Universal Viewport Scroll Pinning & Intent Cooldown Hook
 * 
 * 核心机制：
 * 1. 150ms 冷却时间戳防抢夺：用户一旦主动触发滚动，系统锁定自动拉底权限 150ms；
 * 2. 40px 底部容差图钉锁定：距离底部小于等于 40px 视为处于底部锁定态。
 */

import { useEffect, useRef, useState, useCallback } from 'react';

export interface ScrollPinningOptions {
    readonly cooldownMs?: number;
    readonly bottomTolerancePx?: number;
}

export function useScrollPinning(dependencies: unknown[], options: ScrollPinningOptions = {}) {
    const { cooldownMs = 150, bottomTolerancePx = 40 } = options;

    const containerRef = useRef<HTMLDivElement>(null);
    const [isPinned, setIsPinned] = useState(true);
    const [showJumpToBottom, setShowJumpToBottom] = useState(false);
    const lastUserInputAt = useRef(0);
    const programmaticScroll = useRef(false);

    const markUserInput = useCallback(() => {
        lastUserInputAt.current = performance.now();
        setIsPinned(false);
    }, []);

    const handleScroll = useCallback(() => {
        if (programmaticScroll.current) {
            programmaticScroll.current = false;
            return;
        }
        const el = containerRef.current;
        if (!el) return;

        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        const pinned = distanceFromBottom <= bottomTolerancePx;
        setIsPinned(pinned);
        setShowJumpToBottom(distanceFromBottom > 120);
    }, [bottomTolerancePx]);

    const scrollToBottom = useCallback((smooth = false) => {
        const el = containerRef.current;
        if (!el) return;

        programmaticScroll.current = true;
        el.scrollTo({
            top: el.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto',
        });
        setIsPinned(true);
        setShowJumpToBottom(false);
    }, []);

    useEffect(() => {
        if (performance.now() - lastUserInputAt.current <= cooldownMs) {
            return;
        }
        if (isPinned) {
            scrollToBottom(false);
        }
    }, [dependencies, isPinned, cooldownMs, scrollToBottom]);

    return {
        containerRef,
        isPinned,
        showJumpToBottom,
        scrollToBottom,
        handleScroll,
        markUserInput,
    };
}
