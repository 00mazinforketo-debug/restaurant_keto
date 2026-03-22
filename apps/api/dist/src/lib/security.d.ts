export declare const hashPin: (pin: string) => Promise<string>;
export declare const verifyPin: (pin: string, hash: string) => Promise<boolean>;
export declare const createPinLookup: (pin: string) => string;
export declare const hashOpaqueToken: (token: string) => string;
export declare const createOpaqueToken: () => string;
export declare const createCsrfToken: (sessionId: string) => string;
