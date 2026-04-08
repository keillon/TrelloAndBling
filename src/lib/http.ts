type RetryOptions = {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

type RateLimitedRequester = {
  request: (input: string, init?: RequestInit) => Promise<Response>;
};

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const parseRetryAfterMs = (response: Response): number | null => {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(retryAfter);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - Date.now());
};

export const createRateLimitedRequester = (
  minIntervalMs: number,
  retryOptions: RetryOptions,
): RateLimitedRequester => {
  let nextAllowedTime = 0;

  const applyPacing = async (): Promise<void> => {
    const now = Date.now();
    if (now < nextAllowedTime) {
      await sleep(nextAllowedTime - now);
    }
    nextAllowedTime = Date.now() + minIntervalMs;
  };

  const request = async (
    input: string,
    init?: RequestInit,
  ): Promise<Response> => {
    let attempt = 0;

    while (true) {
      await applyPacing();
      const response = await fetch(input, init);

      if (response.ok) {
        return response;
      }

      const shouldRetry = response.status === 429 || response.status >= 500;
      if (!shouldRetry || attempt >= retryOptions.maxRetries) {
        return response;
      }

      const retryAfterMs = parseRetryAfterMs(response);
      const exponentialDelay = Math.min(
        retryOptions.maxDelayMs,
        retryOptions.baseDelayMs * 2 ** attempt,
      );
      const jitter = Math.floor(Math.random() * 150);
      const delayMs = retryAfterMs ?? exponentialDelay + jitter;

      await sleep(delayMs);
      attempt += 1;
    }
  };

  return { request };
};
