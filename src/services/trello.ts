import { env } from "../config/env";
import { createRateLimitedRequester } from "../lib/http";
import { TrelloCardPayload } from "../types/orders";

type TrelloCreateCardResponse = {
  id: string;
  shortUrl: string;
};

const trelloHttp = createRateLimitedRequester(env.TRELLO_MIN_INTERVAL_MS, {
  maxRetries: 5,
  baseDelayMs: 250,
  maxDelayMs: 5000,
});

export const createTrelloCard = async (
  payload: TrelloCardPayload,
): Promise<TrelloCreateCardResponse> => {
  const params = new URLSearchParams({
    idList: env.TRELLO_LIST_ID,
    key: env.TRELLO_KEY,
    token: env.TRELLO_TOKEN,
    name: payload.name,
    desc: payload.desc,
  });

  const endpoint = `${env.TRELLO_API_BASE_URL}/cards?${params.toString()}`;
  const response = await trelloHttp.request(endpoint, {
    method: "POST",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Trello request failed (${response.status}): ${body}`);
  }

  return (await response.json()) as TrelloCreateCardResponse;
};

export const updateTrelloCard = async (
  cardId: string,
  payload: TrelloCardPayload,
): Promise<void> => {
  const params = new URLSearchParams({
    key: env.TRELLO_KEY,
    token: env.TRELLO_TOKEN,
    name: payload.name,
    desc: payload.desc,
  });

  const endpoint = `${env.TRELLO_API_BASE_URL}/cards/${cardId}?${params.toString()}`;
  const response = await trelloHttp.request(endpoint, {
    method: "PUT",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Trello update failed (${response.status}): ${body}`);
  }
};
