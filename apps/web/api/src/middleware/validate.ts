import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodSchema } from "zod";
import { badRequest } from "../lib/errors.js";

export const validateBody = <T>(schema: ZodSchema<T>) => {
  return (request: Request, _response: Response, next: NextFunction) => {
    try {
      request.body = schema.parse(request.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(badRequest("Validation failed.", error.flatten()));
        return;
      }

      next(error);
    }
  };
};
