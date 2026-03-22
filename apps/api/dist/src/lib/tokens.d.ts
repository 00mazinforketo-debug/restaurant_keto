import type { UserRole } from "@ros/shared";
export type AccessTokenPayload = {
    sub: string;
    role: UserRole;
    sessionId: string;
    type: "access";
};
export type RefreshTokenPayload = {
    sub: string;
    role: UserRole;
    sessionId: string;
    type: "refresh";
    rememberMe: boolean;
};
export declare const ACCESS_TTL_SECONDS: number;
export declare const REFRESH_TTL_SECONDS: number;
export declare const REFRESH_REMEMBER_ME_TTL_SECONDS: number;
export declare const signAccessToken: (payload: Omit<AccessTokenPayload, "type">) => string;
export declare const signRefreshToken: (payload: Omit<RefreshTokenPayload, "type">) => string;
export declare const verifyAccessToken: (token: string) => AccessTokenPayload;
export declare const verifyRefreshToken: (token: string) => RefreshTokenPayload;
