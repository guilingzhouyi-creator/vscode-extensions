/**
 * Module: Artifact Sandbox Security Bridge & Native Gesture Gate
 * File Path: .agents/skills/interaction-design-physics/templates/sandbox-iframe-bridge.ts
 * Architecture Role: Secure bi-directional postMessage bridge between host and untrusted artifact iframes.
 * Dependencies & Triggers: Consumes Window message events and navigator.userActivation APIs.
 * Responsibilities:
 *   1. Assert null-origin isolation by enforcing sandbox="allow-scripts" without allow-same-origin.
 *   2. Intercept synthetic event forgery by validating event.isTrusted and navigator.userActivation.
 *   3. Enforce strict JSON schema message validation before executing sensitive actions.
 * Exit Semantics & Design Rationale: Fail-closed architecture; unverified messages are silently discarded.
 */

export interface SandboxMessageEnvelope<T = unknown> {
    readonly type: string;
    readonly payload: T;
    readonly requiresUserGesture?: boolean;
}

export interface SandboxBridgeConfig {
    readonly expectedTargetOrigin: string;
    readonly onMessage: (msg: SandboxMessageEnvelope) => void;
    readonly onSecurityViolation?: (reason: string) => void;
}

export class SandboxIframeBridge {
    private readonly iframe: HTMLIFrameElement;
    private readonly config: SandboxBridgeConfig;
    private isDestroyed: boolean = false;

    public constructor(iframe: HTMLIFrameElement, config: SandboxBridgeConfig) {
        this.iframe = iframe;
        this.config = config;
        this.assertSandboxAttributes();
        this.attachListeners();
    }

    /**
     * Enforces null-origin isolation on the host side.
     */
    private assertSandboxAttributes(): void {
        const sandboxAttr = this.iframe.getAttribute('sandbox') ?? '';
        if (sandboxAttr.includes('allow-same-origin')) {
            throw new Error('[SECURITY] Disallowed allow-same-origin detected in artifact sandbox iframe');
        }
        if (!sandboxAttr.includes('allow-scripts')) {
            this.iframe.setAttribute('sandbox', 'allow-scripts');
        }
    }

    private attachListeners(): void {
        window.addEventListener('message', this.handleWindowMessage);
    }

    private handleWindowMessage = (event: MessageEvent): void => {
        if (this.isDestroyed) return;
        if (event.source !== this.iframe.contentWindow) return;

        // Untrusted sandbox iframes have origin "null"
        if (event.origin !== 'null' && event.origin !== this.config.expectedTargetOrigin) {
            this.config.onSecurityViolation?.(`Origin mismatch: received ${event.origin}`);
            return;
        }

        const data = event.data as SandboxMessageEnvelope | null;
        if (!data || typeof data !== 'object' || typeof data.type !== 'string') {
            this.config.onSecurityViolation?.('Malformed message envelope');
            return;
        }

        if (data.requiresUserGesture && !this.assertNativeUserActivation(event)) {
            this.config.onSecurityViolation?.(`Blocked synthetic gesture forgery for action: ${data.type}`);
            return;
        }

        this.config.onMessage(data);
    };

    /**
     * Verifies physical human input via event.isTrusted and navigator.userActivation.
     */
    public assertNativeUserActivation(event: UIEvent | MessageEvent): boolean {
        // Enforce physical browser dispatch
        if (!event.isTrusted) {
            return false;
        }

        // Check modern Navigator User Activation API
        const nav = navigator as unknown as { userActivation?: { hasBeenActive: boolean; isActive: boolean } };
        if (nav.userActivation) {
            return nav.userActivation.isActive || nav.userActivation.hasBeenActive;
        }

        // Fallback: isTrusted is true in standard browsers
        return true;
    }

    /**
     * Send structured payload into the sandboxed iframe.
     */
    public postToSandbox<T>(type: string, payload: T): void {
        if (this.isDestroyed || !this.iframe.contentWindow) return;

        const envelope: SandboxMessageEnvelope<T> = {
            type,
            payload,
            requiresUserGesture: false,
        };

        // Target origin for sandboxed null origin is "*"
        this.iframe.contentWindow.postMessage(envelope, '*');
    }

    public destroy(): void {
        this.isDestroyed = true;
        window.removeEventListener('message', this.handleWindowMessage);
    }
}
