import type { AuthUserDto } from "@ros/shared";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthUserDto & {
        sessionId: string;
      };
      requestId?: string;
      io?: import("socket.io").Server;
    }
  }
}

export {};
