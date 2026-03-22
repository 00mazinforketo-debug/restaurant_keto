import { ZodError } from "zod";
import { badRequest } from "../lib/errors.js";
export const validateBody = (schema) => {
    return (request, _response, next) => {
        try {
            request.body = schema.parse(request.body);
            next();
        }
        catch (error) {
            if (error instanceof ZodError) {
                next(badRequest("Validation failed.", error.flatten()));
                return;
            }
            next(error);
        }
    };
};
