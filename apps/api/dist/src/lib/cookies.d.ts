import type { Request, Response } from "express";
export declare const setAuthCookies: (response: Response, values: {
    accessToken: string;
    refreshToken: string;
    csrfToken: string;
    rememberMe: boolean;
}) => void;
export declare const clearAuthCookies: (response: Response) => void;
export declare const readCookie: (request: Request, name: string) => string | undefined;
