/**
 * Shared Mapbox API HTTP client and typed error classifier.
 *
 * Ensures non-JSON error responses, offline states, rate limits, auth failures,
 * and AbortController cancellations are handled uniformly across all services.
 */

export class MapboxServiceError extends Error {
  /**
   * @param {string} message Human-readable summary suitable for UI display
   * @param {object} [options]
   * @param {string} [options.code] Machine-readable error code
   * @param {number|null} [options.status] HTTP status code if available
   * @param {boolean} [options.retryable] Whether retrying the same request may succeed
   * @param {boolean} [options.isAuthError] True for 401/403 token/scope/origin errors
   * @param {unknown} [options.details] Optional diagnostic payload
   */
  constructor(
    message,
    {
      code = 'MAPBOX_ERROR',
      status = null,
      retryable = true,
      isAuthError = false,
      details = null,
    } = {},
  ) {
    super(message);
    this.name = 'MapboxServiceError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.isAuthError = isAuthError;
    this.details = details;
  }
}

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR';
}

export function isOfflineBrowser() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function classifyMapboxHttpError(status, payload = null, serviceName = 'Mapbox') {
  const apiMessage =
    typeof payload?.message === 'string' && payload.message.trim()
      ? payload.message.trim()
      : null;
  const rawCode = typeof payload?.code === 'string' ? payload.code : null;

  if (status === 401) {
    return new MapboxServiceError(
      'Invalid or expired Mapbox access token (401). Update your token or retry.',
      {
        code: 'UNAUTHORIZED',
        status,
        retryable: true,
        isAuthError: true,
        details: { rawCode, apiMessage },
      },
    );
  }

  if (status === 403) {
    return new MapboxServiceError(
      'Mapbox token lacks required scopes or URL restrictions blocked this request (403).',
      {
        code: 'FORBIDDEN',
        status,
        retryable: true,
        isAuthError: true,
        details: { rawCode, apiMessage },
      },
    );
  }

  if (status === 429) {
    return new MapboxServiceError(
      `${serviceName} rate limit exceeded (429). Wait a moment and retry.`,
      {
        code: 'RATE_LIMITED',
        status,
        retryable: true,
        isAuthError: false,
        details: { rawCode, apiMessage },
      },
    );
  }

  if (status >= 500) {
    return new MapboxServiceError(
      `${serviceName} service is temporarily unavailable (${status}). Please retry.`,
      {
        code: 'SERVER_ERROR',
        status,
        retryable: true,
        isAuthError: false,
        details: { rawCode, apiMessage },
      },
    );
  }

  return new MapboxServiceError(
    apiMessage || `${serviceName} request failed (${status}).`,
    {
      code: rawCode || 'HTTP_ERROR',
      status,
      retryable: status === 408,
      isAuthError: false,
      details: { rawCode, apiMessage },
    },
  );
}

/**
 * Normalize an arbitrary thrown error (e.g., from Mapbox GL `error` event or fetch)
 * into a concise user-facing MapboxServiceError.
 */
export function normalizeMapboxError(error, serviceName = 'Mapbox') {
  if (error instanceof MapboxServiceError) {
    return error;
  }

  const status =
    typeof error?.status === 'number'
      ? error.status
      : typeof error?.statusCode === 'number'
        ? error.statusCode
        : null;

  if (status !== null) {
    return classifyMapboxHttpError(status, error, serviceName);
  }

  if (isOfflineBrowser()) {
    return new MapboxServiceError(
      'You are offline. Reconnect to the internet and retry.',
      { code: 'OFFLINE', status: null, retryable: true },
    );
  }

  const rawMessage = typeof error?.message === 'string' ? error.message : '';
  if (/401|unauthorized/i.test(rawMessage)) {
    return classifyMapboxHttpError(401, { message: rawMessage }, serviceName);
  }
  if (/403|forbidden/i.test(rawMessage)) {
    return classifyMapboxHttpError(403, { message: rawMessage }, serviceName);
  }
  if (/429|rate limit|too many requests/i.test(rawMessage)) {
    return classifyMapboxHttpError(429, { message: rawMessage }, serviceName);
  }
  if (/\b5\d{2}\b/.test(rawMessage)) {
    const match = rawMessage.match(/\b(5\d{2})\b/);
    return classifyMapboxHttpError(Number(match?.[1] || 503), { message: rawMessage }, serviceName);
  }

  return new MapboxServiceError(
    rawMessage || `${serviceName} request failed. Check your connection and retry.`,
    { code: 'NETWORK_ERROR', status: null, retryable: true },
  );
}

/**
 * Fetch JSON from a Mapbox HTTPS endpoint with offline detection, safe non-JSON
 * response parsing, HTTP status classification, and clean AbortError passthrough.
 */
export async function fetchMapboxJson(url, { signal, serviceName = 'Mapbox' } = {}) {
  if (isOfflineBrowser()) {
    throw new MapboxServiceError(
      'You are offline. Reconnect to the internet and retry.',
      { code: 'OFFLINE', status: null, retryable: true },
    );
  }

  let response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    if (isOfflineBrowser()) {
      throw new MapboxServiceError(
        'Connection lost while contacting Mapbox. Reconnect and retry.',
        { code: 'OFFLINE', status: null, retryable: true },
      );
    }
    throw new MapboxServiceError(
      `Network error contacting ${serviceName}. Check your connection or token.`,
      { code: 'NETWORK_ERROR', status: null, retryable: true },
    );
  }

  let rawText;
  try {
    rawText = await response.text();
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    rawText = '';
  }

  let data = null;
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    throw classifyMapboxHttpError(response.status, data, serviceName);
  }

  if (!data || typeof data !== 'object') {
    throw new MapboxServiceError(
      `${serviceName} returned an unexpected non-JSON response.`,
      {
        code: 'INVALID_RESPONSE',
        status: response.status,
        retryable: true,
      },
    );
  }

  return data;
}
