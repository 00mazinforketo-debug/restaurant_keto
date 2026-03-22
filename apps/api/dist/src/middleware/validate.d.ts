import type { NextFunction, Request, Response } from "express";
import { type ZodSchema } from "zod";
export declare const validateBody: <T>(schema: ZodSchema<T>) => (request: Request, _response: Response, next: NextFunction) => void;
