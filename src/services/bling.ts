import { env } from "../config/env";
import { createRateLimitedRequester } from "../lib/http";
import { BlingOrder } from "../types/orders";

type BlingApiOrder = {
  id: string | number;
  numero?: string | number;
  data?: string;
  contato?: {
    nome?: string;
  };
  totalvenda?: number | string;
  situacao?: {
    id?: number;
    valor?: string | number;
  };
  total?: number | string;
  observacoes?: string;
  itens?: Array<{
    descricao?: string;
    quantidade?: number | string;
    valor?: number | string;
  }>;
};

type BlingListResponse = {
  data?: BlingApiOrder[];
};

type BlingDetailResponse = {
  data?: BlingApiOrder;
};

type BlingRefreshResponse = {
  access_token?: string;
  refresh_token?: string;
};

let currentAccessToken = env.BLING_ACCESS_TOKEN;
let currentRefreshToken = env.BLING_REFRESH_TOKEN;
const blingHttp = createRateLimitedRequester(env.BLING_MIN_INTERVAL_MS, {
  maxRetries: 4,
  baseDelayMs: 400,
  maxDelayMs: 4000,
});

const toNumber = (value: string | number | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const mapOrder = (order: BlingApiOrder): BlingOrder => {
  return {
    id: String(order.id),
    numero: order.numero ? String(order.numero) : undefined,
    data: order.data,
    clienteNome: order.contato?.nome,
    valorTotal: toNumber(order.total) ?? toNumber(order.totalvenda),
    situacao: order.situacao?.valor,
    situacaoId: order.situacao?.id,
    observacoes: order.observacoes,
    itens: order.itens?.map((item) => ({
      valorUnitario: toNumber(item.valor),
      valorTotal:
        (toNumber(item.quantidade) ?? 0) * (toNumber(item.valor) ?? 0),
      descricao: item.descricao ?? "-",
      quantidade: toNumber(item.quantidade) ?? 0,
    })),
  };
};

const buildBasicAuthHeader = (
  clientId: string,
  clientSecret: string,
): string => {
  const credentials = `${clientId}:${clientSecret}`;
  const encoded = Buffer.from(credentials, "utf-8").toString("base64");
  return `Basic ${encoded}`;
};

const refreshBlingAccessToken = async (): Promise<string | null> => {
  if (
    !env.BLING_CLIENT_ID ||
    !env.BLING_CLIENT_SECRET ||
    !currentRefreshToken
  ) {
    return null;
  }

  const endpoint = `${env.BLING_API_BASE_URL}/oauth/token`;
  const response = await blingHttp.request(endpoint, {
    method: "POST",
    headers: {
      Authorization: buildBasicAuthHeader(
        env.BLING_CLIENT_ID,
        env.BLING_CLIENT_SECRET,
      ),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: currentRefreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Bling refresh token failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as BlingRefreshResponse;
  if (!data.access_token) {
    throw new Error("Bling refresh response has no access_token");
  }

  currentAccessToken = data.access_token;
  if (data.refresh_token) {
    currentRefreshToken = data.refresh_token;
  }

  return currentAccessToken;
};

const fetchOrdersWithToken = async (
  token: string,
  page: number,
  limit: number,
): Promise<Response> => {
  const params = new URLSearchParams({
    pagina: String(page),
    limite: String(limit),
  });
  const endpoint = `${env.BLING_API_BASE_URL}/pedidos/vendas?${params.toString()}`;
  return blingHttp.request(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
};

const fetchOrderDetailWithToken = async (
  orderId: string,
  token: string,
): Promise<Response> => {
  const endpoint = `${env.BLING_API_BASE_URL}/pedidos/vendas/${orderId}`;
  return blingHttp.request(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
};

export const fetchNewBlingOrders = async (): Promise<BlingOrder[]> => {
  const allOrders: BlingApiOrder[] = [];
  const pageLimit = 100;
  let page = 1;

  while (true) {
    let response = await fetchOrdersWithToken(
      currentAccessToken,
      page,
      pageLimit,
    );

    if (response.status === 401) {
      const refreshedToken = await refreshBlingAccessToken();
      if (refreshedToken) {
        response = await fetchOrdersWithToken(refreshedToken, page, pageLimit);
      }
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Bling request failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as BlingListResponse;
    const orders = data.data ?? [];
    allOrders.push(...orders);

    if (orders.length < pageLimit) {
      break;
    }
    page += 1;
  }

  return allOrders.map(mapOrder);
};

export const fetchBlingOrderDetails = async (
  orderId: string,
): Promise<BlingOrder> => {
  let response = await fetchOrderDetailWithToken(orderId, currentAccessToken);

  if (response.status === 401) {
    const refreshedToken = await refreshBlingAccessToken();
    if (refreshedToken) {
      response = await fetchOrderDetailWithToken(orderId, refreshedToken);
    }
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Bling detail request failed (${response.status}): ${body}`,
    );
  }

  const data = (await response.json()) as BlingDetailResponse;
  if (!data.data) {
    throw new Error(`Bling detail request has no data for order ${orderId}`);
  }

  return mapOrder(data.data);
};
