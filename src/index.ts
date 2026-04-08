import express, { Request, Response } from "express";
import cron from "node-cron";
import { env } from "./config/env";
import {
  backfillSyncedCardsToCurrentPattern,
  syncBlingOrdersToTrello,
} from "./services/sync-orders";

const app = express();
app.use(express.json());
let syncRunning = false;

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
    const result = await syncBlingOrdersToTrello();
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
  if (syncRunning) {
    console.log("[sync] skipped because previous sync is still running");
    return;
  }

  try {
    syncRunning = true;
    const result = await syncBlingOrdersToTrello();
    console.log(
      `[sync] scanned=${result.scanned} created=${result.created} skipped=${result.skipped}`,
    );
    if (result.errors.length > 0) {
      console.warn(`[sync] errors=${result.errors.length}`, result.errors);
    }
  } catch (error) {
    console.error("[sync] fatal error", error);
  } finally {
    syncRunning = false;
  }
});

app.listen(env.PORT, () => {
  console.log(`Server running at http://localhost:${env.PORT}`);
});
