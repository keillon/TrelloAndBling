import { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { env } from "../config/env";

type CardCreatedEvent = {
  orderId: string;
  trelloCardId: string;
  trelloCardUrl: string;
};

type SyncCompletedEvent = {
  scanned: number;
  eligible: number;
  created: number;
  skipped: number;
  errors: Array<{ orderId: string; message: string }>;
  source: "cron" | "manual" | "webhook";
};

let io: SocketIOServer | null = null;

const resolveCorsOrigin = (): string[] => {
  if (!env.SOCKET_CORS_ORIGIN) return ["*"];
  return env.SOCKET_CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
};

export const initializeRealtimeServer = (server: HttpServer): void => {
  io = new SocketIOServer(server, {
    cors: {
      origin: resolveCorsOrigin(),
    },
  });

  io.on("connection", (socket) => {
    socket.emit("orders:connected", {
      connectedAt: new Date().toISOString(),
    });
  });
};

export const emitCardCreated = (event: CardCreatedEvent): void => {
  io?.emit("orders:card-created", {
    ...event,
    createdAt: new Date().toISOString(),
  });
};

export const emitSyncCompleted = (event: SyncCompletedEvent): void => {
  io?.emit("orders:sync-completed", {
    ...event,
    emittedAt: new Date().toISOString(),
  });
};
