import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@ros/shared";
export declare const requireAuth: (request: Request, _response: Response, next: NextFunction) => Promise<void>;
export declare const requireRole: (...roles: UserRole[]) => (request: Request, _response: Response, next: NextFunction) => void;
