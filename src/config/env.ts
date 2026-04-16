import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3333),
  BLING_API_BASE_URL: z
    .string()
    .url()
    .default("https://api.bling.com.br/Api/v3"),
  BLING_ACCESS_TOKEN: z.string().min(1),
  BLING_CLIENT_ID: z.string().optional(),
  BLING_CLIENT_SECRET: z.string().optional(),
  BLING_REFRESH_TOKEN: z.string().optional(),
  BLING_ALLOWED_STATUS: z.string().optional(),
  BLING_MIN_ORDER_DATE: z.string().optional(),
  BLING_SYNC_LOOKBACK_DAYS: z.coerce.number().int().min(0).default(7),
  BLING_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(350),
  TRELLO_API_BASE_URL: z.string().url().default("https://api.trello.com/1"),
  TRELLO_KEY: z.string().min(1),
  TRELLO_TOKEN: z.string().min(1),
  TRELLO_LIST_ID: z.string().min(1),
  TRELLO_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(120),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SOCKET_CORS_ORIGIN: z.string().optional(),
  SYNC_CRON: z.string().default("*/2 * * * *"),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error(
    "Invalid environment variables:",
    parsedEnv.error.flatten().fieldErrors,
  );
  process.exit(1);
}

export const env = parsedEnv.data;
