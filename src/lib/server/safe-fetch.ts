import "server-only";

export class FetchFailure extends Error {
  constructor(
    public kind: "network" | "timeout" | "aborted" | "http" | "too_large" | "invalid",
    public status?: number,
    public retryAfter?: number,
  ) {
    super(`Upstream ${kind}`);
    this.name = "FetchFailure";
  }
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : undefined;
}

interface FetchOptions {
  host: "letterboxd.com" | "api.themoviedb.org" | "image.tmdb.org";
  maxBytes: number;
  timeoutMs: number;
  accept: string;
  signal?: AbortSignal;
  token?: string;
}

// A platform cache lookup can also stall before an external fetch begins.
// Bound that wait without turning cancellation into a cacheable value.
export async function waitForSignal<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([operation(), aborted]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

export async function safeFetch(url: string, options: FetchOptions): Promise<{ bytes: Uint8Array; contentType: string }> {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.hostname !== options.host || target.port || target.username || target.password) {
    throw new FetchFailure("invalid");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Upstream timeout", "TimeoutError")), options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  try {
    const response = await fetch(target, {
      method: "GET", cache: "no-store", redirect: "manual", credentials: "omit", signal,
      headers: { Accept: options.accept, ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
    });
    if (!response.ok || response.status >= 300) {
      await response.body?.cancel();
      throw new FetchFailure("http", response.status, parseRetryAfter(response.headers.get("retry-after")));
    }
    if (response.url && new URL(response.url).origin !== target.origin) {
      await response.body?.cancel();
      throw new FetchFailure("invalid");
    }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    const advertised = response.headers.get("content-length");
    if (advertised && /^\d+$/.test(advertised) && Number(advertised) > options.maxBytes) {
      await response.body?.cancel();
      throw new FetchFailure("too_large");
    }
    if (!response.body) throw new FetchFailure("invalid");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > options.maxBytes) {
          await reader.cancel();
          controller.abort();
          throw new FetchFailure("too_large");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { bytes, contentType };
  } catch (error) {
    if (error instanceof FetchFailure) throw error;
    if (signal.aborted) throw new FetchFailure(signal.reason?.name === "TimeoutError" ? "timeout" : "aborted");
    throw new FetchFailure("network");
  } finally { clearTimeout(timer); }
}
