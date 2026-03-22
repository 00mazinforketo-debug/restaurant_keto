export declare const SESSION_IDLE_TIMEOUT_MINUTES = 30;
export declare const SESSION_IDLE_TIMEOUT_MS: number;
export declare const SESSION_TOUCH_THROTTLE_MS: number;
export declare const isSessionIdle: (lastActiveAt: Date | string) => boolean;
export declare const shouldTouchSession: (lastActiveAt: Date | string) => boolean;
