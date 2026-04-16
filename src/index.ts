import { createServer } from "node:http";
import express, { Request, Response } from "express";
import cron from "node-cron";
import { env } from "./config/env";
import {
  backfillSyncedCardsToCurrentPattern,
  syncBlingOrdersToTrelloWithOptions,
} from "./services/sync-orders";
import {
  emitCardCreated,
  emitSyncCompleted,
  initializeRealtimeServer,
} from "./services/realtime";

const app = express();
app.use(express.json());
let syncRunning = false;
let authErrorPauseUntil = 0;
const AUTH_ERROR_PAUSE_MS = 15 * 60 * 1000;

const extractOrderIdsFromWebhook = (payload: unknown): string[] => {
  if (!payload || typeof payload !== "object") return [];
  const data = payload as Record<string, unknown>;
  const candidates: unknown[] = [
    data.id,
    data.orderId,
    data.pedidoId,
    data?.data &&
      typeof data.data === "object" &&
      (data.data as Record<string, unknown>).id,
    data?.data &&
      typeof data.data === "object" &&
      (data.data as Record<string, unknown>).pedidoId,
  ];
  const normalized = candidates
    .map((value) =>
      value === undefined || value === null ? null : String(value),
    )
    .filter((value): value is string =>
      Boolean(value && value.trim().length > 0),
    );
  return Array.from(new Set(normalized));
};

const runSync = async (
  source: "cron" | "manual" | "webhook",
  specificOrderIds?: string[],
) => {
  const result = await syncBlingOrdersToTrelloWithOptions({
    specificOrderIds,
    onCardCreated: emitCardCreated,
  });
  emitSyncCompleted({ ...result, source });
  return result;
};

app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

app.post("/sync-orders", async (_req: Request, res: Response) => {
  try {
    if (syncRunning) {
      res.status(202).json({ message: "Sync already running" });
      return;
    }
    syncRunning = true;
    const result = await runSync("manual");
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      message:
        error instanceof Error
          ? error.message
          : "Unexpected error while syncing",
    });
  } finally {
    syncRunning = false;
  }
});

app.post("/webhooks/bling/orders", async (req: Request, res: Response) => {
  try {
    if (syncRunning) {
      res.status(202).json({ message: "Sync already running" });
      return;
    }
    syncRunning = true;
    const specificOrderIds = extractOrderIdsFromWebhook(req.body);
    const result = await runSync("webhook", specificOrderIds);
    res.status(200).json({
      ...result,
      receivedOrderIds: specificOrderIds,
    });
  } catch (error) {
    res.status(500).json({
      message:
        error instanceof Error
          ? error.message
          : "Unexpected error while processing Bling webhook",
    });
  } finally {
    syncRunning = false;
  }
});

app.post("/backfill-cards", async (_req: Request, res: Response) => {
  try {
    const result = await backfillSyncedCardsToCurrentPattern();
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      message:
        error instanceof Error
          ? error.message
          : "Unexpected error while backfilling cards",
    });
  }
});

cron.schedule(env.SYNC_CRON, async () => {
  if (Date.now() < authErrorPauseUntil) {
    return;
  }

  if (syncRunning) {
    console.log("[sync] skipped because previous sync is still running");
    return;
  }

  try {
    syncRunning = true;
    const result = await runSync("cron");
    console.log(
      `[sync] scanned=${result.scanned} created=${result.created} skipped=${result.skipped}`,
    );
    if (result.errors.length > 0) {
      console.warn(`[sync] errors=${result.errors.length}`, result.errors);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("BLING_REFRESH_TOKEN_INVALID")
    ) {
      authErrorPauseUntil = Date.now() + AUTH_ERROR_PAUSE_MS;
      console.error(
        `[sync] paused for ${AUTH_ERROR_PAUSE_MS / 60000}m due to invalid Bling refresh token. Update Render env and redeploy.`,
      );
      return;
    }
    console.error("[sync] fatal error", error);
  } finally {
    syncRunning = false;
  }
});

const httpServer = createServer(app);
initializeRealtimeServer(httpServer);

httpServer.listen(env.PORT, () => {
  console.log(`Server running at http://localhost:${env.PORT}`);
});
