import type { Server as SocketServer } from "socket.io";
export type IoContext = {
    current?: SocketServer;
};
export declare const createApp: (ioContext: IoContext) => import("express-serve-static-core").Express;
