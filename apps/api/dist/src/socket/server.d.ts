import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
export declare const createSocketServer: (httpServer: HttpServer) => Promise<Server<import("socket.io").DefaultEventsMap, import("socket.io").DefaultEventsMap, import("socket.io").DefaultEventsMap, any>>;
