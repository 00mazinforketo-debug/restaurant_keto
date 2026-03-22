import type { NextFunction, Request, Response } from "express";
export declare const errorMiddleware: (error: unknown, request: Request, response: Response, _next: NextFunction) => void;
