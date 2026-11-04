// A small, polite HTTP client: one descriptive User-Agent, conditional requests
// where the publisher supports them, bounded retries, and Retry-After honored.
//
// No secrets, no API keys, no parallel fan-out. Each adapter fetches once per run.

export const REPO_URL = 'https://github.com/slayyyyer/what-changed';
export const CONTACT = 'slayyyyer@users.noreply.github.com';
export const USER_AGENT = `what-changed/1.0 (+${REPO_URL}; ${CONTACT})`;

const DEFAULTS = {
  timeoutMs: 45_000,
  retries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 20_000,
};

class HttpError extends Error {
  constructor(message, { status = null, url = null, retryable = false } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.retryable = retryable;
  }
}

/**
 * GET a JSON document.
 *
 * @param {string} url
 * @param {{
 *   etag?: string|null,
 *   lastModified?: string|null,
 *   timeoutMs?: number,
 *   retries?: number,
 *   headers?: Record<string,string>,
 *   log?: (message:string)=>void
 * }} [options]
 * @returns {Promise<{
 *   notModified: boolean,
 *   status: number,
 *   etag: string|null,
 *   lastModified: string|null,
 *   body: any,
 *   text: string,
 *   url: string
 * }>}
 */
export async function fetchJson(url, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
    ...(options.headers || {}),
  };
  if (options.etag) headers['If-None-Match'] = options.etag;
  if (options.lastModified) headers['If-Modified-Since'] = options.lastModified;

  let attempt = 0;
  let lastError = null;

  while (attempt <= settings.retries) {
    if (attempt > 0) {
      const delay = Math.min(settings.baseDelayMs * 2 ** (attempt - 1), settings.maxDelayMs);
      settings.log?.(`retry ${attempt}/${settings.retries} in ${delay}ms after: ${lastError?.message}`);
      await sleep(delay);
    }

    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(settings.timeoutMs),
        redirect: 'follow',
      });

      if (response.status === 304) {
        return {
          notModified: true,
          status: 304,
          etag: response.headers.get('etag') || options.etag || null,
          lastModified: response.headers.get('last-modified') || options.lastModified || null,
          body: null,
          text: '',
          url: response.url || url,
        };
      }

      if (response.status === 429 || response.status === 503) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        lastError = new HttpError(`HTTP ${response.status}`, {
          status: response.status,
          url: response.url || url,
          retryable: true,
        });
        attempt += 1;
        if (attempt > settings.retries) break;
        const delay = retryAfter ?? Math.min(settings.baseDelayMs * 2 ** (attempt - 1), settings.maxDelayMs);
        settings.log?.(`got ${response.status}; waiting ${delay}ms`);
        await sleep(delay);
        continue;
      }

      if (!response.ok) {
        throw new HttpError(`HTTP ${response.status} ${response.statusText}`, {
          status: response.status,
          url: response.url || url,
          retryable: response.status >= 500,
        });
      }

      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new HttpError(`response was not JSON (${text.slice(0, 80).replace(/\s+/g, ' ')}…)`, {
          status: response.status,
          url: response.url || url,
          retryable: false,
        });
      }

      return {
        notModified: false,
        status: response.status,
        etag: response.headers.get('etag') || null,
        lastModified: response.headers.get('last-modified') || null,
        body,
        text,
        url: response.url || url,
      };
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt > settings.retries) break;
      if (error?.retryable === false) break;
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        lastError = new HttpError(`timed out after ${settings.timeoutMs}ms`, { retryable: true, url });
      }
    }
  }

  throw lastError instanceof Error ? lastError : new HttpError('request failed', { url });
}

function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1000, 60_000));
  const when = Date.parse(value);
  if (Number.isFinite(when)) return Math.max(0, Math.min(when - Date.now(), 60_000));
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { HttpError };
