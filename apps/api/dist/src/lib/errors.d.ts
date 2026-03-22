export declare class ApiError extends Error {
    statusCode: number;
    code: string;
    details?: unknown;
    constructor(statusCode: number, code: string, message: string, details?: unknown);
}
export declare const badRequest: (message: string, details?: unknown) => ApiError;
export declare const unauthorized: (message?: string) => ApiError;
export declare const forbidden: (message?: string) => ApiError;
export declare const notFound: (message?: string) => ApiError;
export declare const conflict: (message: string, details?: unknown) => ApiError;
export declare const tooManyRequests: (message: string, details?: unknown) => ApiError;
