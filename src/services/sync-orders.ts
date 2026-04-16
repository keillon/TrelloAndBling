import { supabase } from "../lib/supabase";
import { env } from "../config/env";
import { fetchBlingOrderDetails, fetchNewBlingOrders } from "./bling";
import { createTrelloCard, updateTrelloCard } from "./trello";

type SyncResult = {
  scanned: number;
  eligible: number;
  created: number;
  skipped: number;
  errors: Array<{ orderId: string; message: string }>;
};

type SyncOptions = {
  specificOrderIds?: string[];
  onCardCreated?: (event: {
    orderId: string;
    trelloCardId: string;
    trelloCardUrl: string;
  }) => void;
};

type SyncCandidateOrder = {
  id: string;
  data?: string;
  situacao?: string | number;
};

type SyncCursorRow = {
  key: string;
  value: string;
};

type SyncedCardRow = {
  bling_order_id: string;
  trello_card_id: string;
  payload?: {
    numero?: string;
  };
};

const formatCurrencyBRL = (value: number | undefined): string => {
  if (value === undefined) return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
};

const formatNumberBR = (value: number | undefined): string => {
  if (value === undefined) return "-";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(value);
};

const normalizeStatus = (
  value: string | number | undefined,
): string | undefined => {
  if (value === undefined) return undefined;
  return String(value).trim().toLowerCase();
};

const getStatusLabel = (value: string | number | undefined): string => {
  const normalized = normalizeStatus(value);
  if (!normalized) return "-";
  // Bling status codes observed in this account:
  // 1 = Atendido, 10 = Em andamento
  if (normalized === "1") return "Atendido";
  if (normalized === "10") return "Em andamento";
  if (normalized === "em andamento") return "Em andamento";
  if (normalized === "atendido") return "Atendido";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const formatDateBR = (value: string | undefined): string => {
  const parsed = parseBlingDate(value);
  if (!parsed) return value ?? "-";
  return new Intl.DateTimeFormat("pt-BR").format(parsed);
};

const cardNameFromOrder = (order: {
  id: string;
  numero?: string;
  situacao?: string | number;
  valorTotal?: number;
  clienteNome?: string;
}): string => {
  const numberPart = order.numero ? `#${order.numero}` : `Bling ${order.id}`;
  const statusPart = getStatusLabel(order.situacao);
  const totalPart = formatCurrencyBRL(order.valorTotal);
  const clientPart = order.clienteNome ? ` | ${order.clienteNome}` : "";
  return `Pedido ${numberPart} | ${statusPart} | ${totalPart}${clientPart}`;
};

const cardDescriptionFromOrder = (order: {
  id: string;
  numero?: string;
  data?: string;
  clienteNome?: string;
  valorTotal?: number;
  situacao?: string | number;
  situacaoId?: number;
  observacoes?: string;
  itens?: Array<{
    descricao: string;
    quantidade: number;
    valorUnitario?: number;
    valorTotal?: number;
  }>;
}): string => {
  const itens = order.itens?.length
    ? order.itens
        .map(
          (item) =>
            `- ${item.descricao} (Qtd: ${formatNumberBR(item.quantidade)} | Unit: ${formatCurrencyBRL(item.valorUnitario)} | Subtotal: ${formatCurrencyBRL(item.valorTotal)})`,
        )
        .join("\n")
    : "-";

  const lines = [
    "## Pedido",
    `- ID Bling: ${order.id}`,
    `- Numero: ${order.numero ?? "-"}`,
    `- Data: ${formatDateBR(order.data)}`,
    `- Cliente: ${order.clienteNome ?? "-"}`,
    "",
    "## Status e Totais",
    `- Status (Bling): ${getStatusLabel(order.situacao)}`,
    `- Codigo status (Bling): ${order.situacao ?? "-"}`,
    `- ID status (Bling): ${order.situacaoId ?? "-"}`,
    `- Total da venda: ${formatCurrencyBRL(order.valorTotal)}`,
    "",
    "## Itens",
    itens,
    "",
    "## Observacoes",
    order.observacoes ?? "-",
  ];

  return lines.join("\n");
};

const parseBlingDate = (value: string | undefined): Date | null => {
  if (!value) return null;

  const iso = new Date(value);
  if (!Number.isNaN(iso.getTime())) return iso;

  const [datePart, timePart] = value.split(" ");
  if (!datePart) return null;
  const [day, month, year] = datePart.split("/");
  if (!day || !month || !year) return null;
  const normalized = `${year}-${month}-${day}${timePart ? `T${timePart}` : "T00:00:00"}`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const allowedStatusSet = new Set(
  (env.BLING_ALLOWED_STATUS || "Atendido,Em andamento")
    .split(",")
    .map((status) => status.trim().toLowerCase())
    .filter((status) => status.length > 0),
);

const allowedStatusIdSet = new Set([1, 10]);

const isAllowedStatus = (
  value: string | number | undefined,
  statusId?: number,
): boolean => {
  if (typeof statusId === "number" && allowedStatusIdSet.has(statusId)) {
    return true;
  }
  const normalized = normalizeStatus(value);
  return Boolean(normalized && allowedStatusSet.has(normalized));
};

const loadLastSyncDate = async (): Promise<Date | null> => {
  const { data, error } = await supabase
    .from("sync_settings")
    .select("key, value")
    .eq("key", "last_bling_sync_at")
    .maybeSingle<SyncCursorRow>();

  if (error) throw error;
  return parseBlingDate(data?.value);
};

const saveLastSyncDate = async (date: Date): Promise<void> => {
  const { error } = await supabase.from("sync_settings").upsert(
    {
      key: "last_bling_sync_at",
      value: date.toISOString(),
    },
    { onConflict: "key" },
  );

  if (error) throw error;
};

const buildDateThreshold = (_lastSync: Date | null): Date => {
  if (env.BLING_MIN_ORDER_DATE) {
    const fixedDate = parseBlingDate(env.BLING_MIN_ORDER_DATE);
    if (fixedDate) return fixedDate;
  }

  // Default behavior: always process orders from the beginning of current month.
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  return monthStart;
};

export const syncBlingOrdersToTrello = async (): Promise<SyncResult> => {
  return syncBlingOrdersToTrelloWithOptions();
};

export const syncBlingOrdersToTrelloWithOptions = async (
  options?: SyncOptions,
): Promise<SyncResult> => {
  const lastSyncAt = await loadLastSyncDate();
  const dateThreshold = buildDateThreshold(lastSyncAt);
  const requestedOrderIds = options?.specificOrderIds;
  const hasRequestedOrderIds = Boolean(
    requestedOrderIds && requestedOrderIds.length > 0,
  );
  const requestedOrderIdSet = new Set(requestedOrderIds ?? []);

  const fetchedOrders: SyncCandidateOrder[] = hasRequestedOrderIds
    ? requestedOrderIds!.map((id) => ({ id }))
    : await fetchNewBlingOrders();
  const deduplicatedOrderMap = new Map<string, SyncCandidateOrder>();
  for (const order of fetchedOrders) {
    deduplicatedOrderMap.set(order.id, order);
  }
  const orders = Array.from(deduplicatedOrderMap.values());

  const eligibleOrders = orders.filter((order) => {
    if (hasRequestedOrderIds) return true;
    const orderDate = parseBlingDate(order.data);
    const byDate = orderDate ? orderDate >= dateThreshold : false;
    return byDate;
  });

  const result: SyncResult = {
    scanned: orders.length,
    eligible: eligibleOrders.length,
    created: 0,
    skipped: 0,
    errors: [],
  };

  for (const order of eligibleOrders) {
    try {
      if (!hasRequestedOrderIds || requestedOrderIdSet.has(order.id)) {
        const { data: existingById, error: existingError } = await supabase
          .from("order_syncs")
          .select("bling_order_id")
          .eq("bling_order_id", order.id)
          .maybeSingle();

        if (existingError) {
          throw existingError;
        }

        if (existingById) {
          result.skipped += 1;
          continue;
        }
      }

      const detailedOrder = await fetchBlingOrderDetails(order.id);

      const detailedOrderDate = parseBlingDate(detailedOrder.data);
      if (!detailedOrderDate || detailedOrderDate < dateThreshold) {
        result.skipped += 1;
        continue;
      }

      if (!isAllowedStatus(detailedOrder.situacao, detailedOrder.situacaoId)) {
        result.skipped += 1;
        continue;
      }

      if (detailedOrder.numero) {
        const { data: existingRowsByNumber, error: existingByNumberError } =
          await supabase
            .from("order_syncs")
            .select("bling_order_id, payload")
            .eq("payload->>numero", detailedOrder.numero)
            .limit(1);

        if (existingByNumberError) {
          throw existingByNumberError;
        }

        const existingByNumber = (existingRowsByNumber ?? []) as SyncedCardRow[];
        if (existingByNumber.length > 0) {
          result.skipped += 1;
          continue;
        }
      }

      const trelloCard = await createTrelloCard({
        name: cardNameFromOrder(detailedOrder),
        desc: cardDescriptionFromOrder(detailedOrder),
      });

      const { error: insertError } = await supabase.from("order_syncs").insert({
        bling_order_id: order.id,
        trello_card_id: trelloCard.id,
        trello_card_url: trelloCard.shortUrl,
        payload: detailedOrder,
      });

      if (insertError) {
        throw insertError;
      }

      options?.onCardCreated?.({
        orderId: order.id,
        trelloCardId: trelloCard.id,
        trelloCardUrl: trelloCard.shortUrl,
      });
      result.created += 1;
    } catch (error) {
      result.errors.push({
        orderId: order.id,
        message: error instanceof Error ? error.message : "Unexpected error",
      });
    }
  }

  await saveLastSyncDate(new Date());

  const { error: runInsertError } = await supabase.from("sync_runs").insert({
    scanned: result.scanned,
    eligible: result.eligible,
    created: result.created,
    skipped: result.skipped,
    errors: result.errors,
  });

  if (runInsertError) {
    throw runInsertError;
  }

  return result;
};

export const backfillSyncedCardsToCurrentPattern = async (): Promise<{
  scanned: number;
  updated: number;
  errors: Array<{ orderId: string; message: string }>;
}> => {
  const pageSize = 100;
  let offset = 0;
  let scanned = 0;
  let updated = 0;
  const errors: Array<{ orderId: string; message: string }> = [];

  while (true) {
    const { data, error } = await supabase
      .from("order_syncs")
      .select("bling_order_id, trello_card_id")
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const rows = (data ?? []) as SyncedCardRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      try {
        const detailedOrder = await fetchBlingOrderDetails(row.bling_order_id);
        await updateTrelloCard(row.trello_card_id, {
          name: cardNameFromOrder(detailedOrder),
          desc: cardDescriptionFromOrder(detailedOrder),
        });
        updated += 1;
      } catch (error) {
        errors.push({
          orderId: row.bling_order_id,
          message: error instanceof Error ? error.message : "Unexpected error",
        });
      }
    }

    offset += rows.length;
  }

  return { scanned, updated, errors };
};
