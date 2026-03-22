import type { Request, Response } from "express";
export declare const ok: <T>(response: Response, data: T, message?: string, statusCode?: number) => Response<any, Record<string, any>>;
export declare const getRequestIp: (request: Request) => string;
