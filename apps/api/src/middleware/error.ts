import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export const errorMiddleware = (
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction
) => {
  if (error instanceof ApiError) {
    response.status(error.statusCode).json({
      success: false,
      message: error.message,
      error: {
        code: error.code,
        details: error.details,
        requestId: request.requestId
      }
    });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      success: false,
      message: "Validation failed.",
      error: {
        code: "VALIDATION_ERROR",
        details: error.flatten(),
        requestId: request.requestId
      }
    });
    return;
  }

  logger.error({ error, requestId: request.requestId }, "Unhandled API error");
  response.status(500).json({
    success: false,
    message: "Internal server error.",
    error: {
      code: "INTERNAL_ERROR",
      requestId: request.requestId
    }
  });
};
