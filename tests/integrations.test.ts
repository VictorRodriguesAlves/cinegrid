import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { safeFetch, FetchFailure, waitForSignal } from "@/lib/server/safe-fetch";
import { fetchRss } from "@/lib/server/letterboxd";
import { resolveProfileUsername } from "@/lib/server/resolve-profile";
import { enrichMovies } from "@/lib/server/tmdb";
import { fetchPoster } from "@/lib/server/poster";
import { GET as collageRoute } from "@/app/api/collage/route";
import { GET as posterRoute } from "@/app/api/poster/route";
import { LIMITS } from "@/lib/constants";
import type { CollageResponse, SelectedMovie } from "@/types/collage";
import shortLink from "./fixtures/profile-short-link.json";

// Only the framework cache is replaced here; route validation, parsing,
// selection, bounded reads and enrichment run unchanged. Production cache
// must be checked separately on Vercel.
const { cacheCalls } = vi.hoisted(() => ({ cacheCalls: [] as Array<{ keys: string[]; revalidate: number }> }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>, keys: string[], options: { revalidate: number }) => {
  cacheCalls.push({ keys, ...options }); return fn;
} }));

const rss = readFileSync(new URL("./fixtures/letterboxd-real.xml", import.meta.url), "utf8");
const json = (value: unknown) => Response.json(value);
const selected = (count = 1): SelectedMovie[] => Array.from({ length: count }, (_, index) => ({ key: `tmdb:${index + 1}`, title: `Film ${index}`, year: 2020, watchedDate: "2026-09-08", rating: null, tmdbId: index + 1, entryUrl: null }));
const movieMetadata = (id: number) => ({ id, title: "Film", original_title: "Film", release_date: "2020-01-01", poster_path: "/abc.jpg" });
const signal = () => new AbortController().signal;
afterEach(() => { cacheCalls.length = 0; vi.useRealTimers(); });

describe("bounded external reads", () => {
  const options = { host: "image.tmdb.org" as const, maxBytes: 8, timeoutMs: 50, accept: "image/jpeg" };
  it("bounds a stalled cache lookup as well as network requests", async () => {
    const controller = new AbortController();
    const waiting = waitForSignal(() => new Promise<never>(() => {}), controller.signal);
    const assertion = expect(waiting).rejects.toMatchObject({ name: "TimeoutError" });
    controller.abort(new DOMException("Budget exceeded", "TimeoutError"));
    await assertion;
    const operation = vi.fn();
    await expect(waitForSignal(operation, controller.signal)).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled();
  });
  it("checks actual streamed bytes without trusting Content-Length", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); controller.enqueue(new Uint8Array(5)); }, cancel }), { headers: { "content-length": "1" } })));
    await expect(safeFetch("https://image.tmdb.org/t/p/w500/a.jpg", options)).rejects.toMatchObject({ kind: "too_large" });
    expect(cancel).toHaveBeenCalled();
  });
  it("rejects redirects and unexpected request hosts without following them", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.test/a.jpg" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(safeFetch("https://evil.test/a.jpg", options)).rejects.toBeInstanceOf(FetchFailure);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(safeFetch("https://image.tmdb.org/t/p/w500/a.jpg", options)).rejects.toMatchObject({ kind: "http", status: 302 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual", cache: "no-store", credentials: "omit" });
  });
  it("enforces timeout while the body is still streaming", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, init: RequestInit) => {
      return Promise.resolve(new Response(new ReadableStream({ start(controller) {
        init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
      } })));
    }));
    await expect(safeFetch("https://image.tmdb.org/t/p/w500/a.jpg", options)).rejects.toMatchObject({ kind: "timeout" });
  });
  it("rejects a response whose final URL belongs to another origin", async () => {
    const response = new Response("abc");
    Object.defineProperty(response, "url", { value: "https://evil.test/a.jpg" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(safeFetch("https://image.tmdb.org/t/p/w500/a.jpg", options)).rejects.toMatchObject({ kind: "invalid" });
  });
});

describe("official profile short links", () => {
  it("resolves the observed redirect with one HEAD request and caches the validated username", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: shortLink.status, headers: { location: shortLink.location } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(resolveProfileUsername(shortLink.url)).resolves.toBe("apontadorroxo");
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe(shortLink.url);
    expect(options).toMatchObject({ method: "HEAD", redirect: "manual", cache: "no-store", credentials: "omit" });
    expect(options.headers).toBeUndefined();
    expect(cacheCalls).toContainEqual({ keys: ["cinegrid-profile-link-v1", "4WZNB"], revalidate: 600 });
  });
  it.each([
    "https://letterboxd.com/film/test/", "https://letterboxd.com/dave/list/test/", "https://letterboxd.com/dave/film/test/",
    "https://letterboxd.com/films/", "https://letterboxd.com.evil.test/dave/", "https://letterboxd.com@evil.test/dave/",
    "https://user:pass@letterboxd.com/dave/", "https://letterboxd.com:443/dave/", "https://letterboxd.com/a/../dave/",
    "http://letterboxd.com/dave/", "https://letterboxd.com/dave/?next=x", "/dave/", "dave", "https://boxd.it/other", "",
  ])("rejects a non-profile destination without requesting it: %s", async (location) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(resolveProfileUsername(shortLink.url)).rejects.toMatchObject({ code: "SHORT_LINK_INVALID", field: "username" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([200, 403, 429, 503])("reports blocked or unavailable resolution (%s) without parsing HTML or retrying", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("<html>blocked</html>", { status, headers: { "retry-after": "120" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(resolveProfileUsername(shortLink.url)).rejects.toMatchObject({ code: "SHORT_LINK_UNAVAILABLE", retryAfter: 120 });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("honors its timeout and the generation cancellation signal", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation((_url: URL, options: RequestInit) => new Promise((_, reject) => options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true })));
    vi.stubGlobal("fetch", fetcher);
    const pending = expect(resolveProfileUsername(shortLink.url)).rejects.toMatchObject({ code: "SHORT_LINK_TIMEOUT", status: 504 });
    await vi.advanceTimersByTimeAsync(LIMITS.shortLinkTimeoutMs);
    await pending;
    fetcher.mockClear();
    await expect(resolveProfileUsername(shortLink.url, AbortSignal.abort())).rejects.toMatchObject({ code: "SHORT_LINK_TIMEOUT" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("never trusts a response that has already followed a redirect", async () => {
    const response = new Response(null, { status: 302, headers: { location: shortLink.location } });
    Object.defineProperty(response, "url", { value: "https://evil.test/" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(resolveProfileUsername(shortLink.url)).rejects.toMatchObject({ code: "SHORT_LINK_INVALID" });
  });
  it("returns the resolved username and requests only its constructed RSS URL", async () => {
    const fetcher = vi.fn(async (url: URL) => {
      if (url.href === shortLink.url) return new Response(null, { status: 302, headers: { location: shortLink.location } });
      expect(url.href).toBe(`${shortLink.location}rss/`);
      return new Response("<rss><channel/></rss>", { headers: { "content-type": "application/rss+xml" } });
    });
    vi.stubGlobal("fetch", fetcher);
    const params = new URLSearchParams({ username: shortLink.url, start: "2026-09-01", end: "2026-09-12", grid: "3" });
    const response = await collageRoute(new Request(`http://localhost/api/collage?${params}`, { headers: { cookie: "private=value" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ username: "apontadorroxo", displayedCount: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects missing links at the field and skips external calls for invalid input", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetcher);
    const params = new URLSearchParams({ username: shortLink.url, start: "2026-09-01", end: "2026-09-12", grid: "3" });
    const response = await collageRoute(new Request(`http://localhost/api/collage?${params}`));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "SHORT_LINK_INVALID", field: "username" } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    fetcher.mockClear();
    params.set("start", "2026-09-13");
    expect((await collageRoute(new Request(`http://localhost/api/collage?${params}`))).status).toBe(400);
    await expect(resolveProfileUsername("https://boxd.it.evil.test/4WZNB")).rejects.toMatchObject({ code: "INVALID_USERNAME" });
    await expect(resolveProfileUsername("https://letterboxd.com/DAVE/")).resolves.toBe("dave");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("RSS failures are not empty profiles", () => {
  it.each([403, 429, 404, 500])("reports HTTP %s as integration failure", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("blocked", { status })));
    await expect(fetchRss("dave")).rejects.toMatchObject({ status: 502 });
  });
  it("rejects HTML returned as a success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>challenge</html>", { headers: { "content-type": "text/html" } })));
    await expect(fetchRss("dave")).rejects.toMatchObject({ code: "RSS_BLOCKED" });
  });
  it("rejects a large XML before parsing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(LIMITS.xmlBytes + 1), { headers: { "content-type": "application/rss+xml" } })));
    await expect(fetchRss("dave")).rejects.toMatchObject({ code: "RSS_TOO_LARGE" });
  });
  it("accepts a real-shaped feed and discards unneeded content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(rss, { headers: { "content-type": "application/rss+xml;charset=utf-8" } })));
    const entries = await fetchRss("dave");
    expect(entries).toHaveLength(3);
    expect(JSON.stringify(entries)).not.toContain("pubDate");
  });
});

describe("TMDB configuration, partial failures and concurrency", () => {
  it("requires a token only when selected movies need enrichment", async () => {
    vi.stubEnv("TMDB_READ_ACCESS_TOKEN", "");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(enrichMovies([], signal())).resolves.toEqual({ movies: [], warnings: [] });
    await expect(enrichMovies(selected(), signal())).rejects.toMatchObject({ code: "TMDB_NOT_CONFIGURED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 403])("does not turn authentication HTTP %s into placeholders", async (status) => {
    vi.stubEnv("TMDB_READ_ACCESS_TOKEN", "test-secret");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("sensitive upstream body", { status })));
    await expect(enrichMovies(selected(8), signal())).rejects.toMatchObject({ code: "TMDB_AUTH_FAILED", status: 500 });
  });
  it("keeps at most four network calls active and authenticates through headers", async () => {
    vi.stubEnv("TMDB_READ_ACCESS_TOKEN", "test-secret");
    let active = 0, peak = 0;
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      expect(init.headers).toMatchObject({ Authorization: "Bearer test-secret" });
      expect(url.href).not.toContain("test-secret");
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 3));
      active--;
      return json(movieMetadata(Number(url.pathname.split("/").pop())));
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await enrichMovies(selected(25), signal());
    expect(result.movies).toHaveLength(25);
    expect(peak).toBe(4);
    expect(fetcher).toHaveBeenCalledTimes(25);
    expect(cacheCalls.every((call) => call.revalidate === 86_400 && !call.keys.join().includes("test-secret"))).toBe(true);
  });
  it("keeps successful movies alongside a temporary failure", async () => {
    vi.stubEnv("TMDB_READ_ACCESS_TOKEN", "test-secret");
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => url.pathname.endsWith("/1") ? json(movieMetadata(1)) : new Response(null, { status: 503 })));
    const result = await enrichMovies(selected(2), signal());
    expect(result.movies[0]?.poster.kind).toBe("image");
    expect(result.movies[1]?.poster.kind).toBe("placeholder");
    expect(result.warnings.map((warning) => warning.code)).toContain("TMDB_TEMPORARY");
  });
  it("returns a general error for total temporary unavailability", async () => {
    vi.stubEnv("TMDB_READ_ACCESS_TOKEN", "test-secret");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 503 }))));
    await expect(enrichMovies(selected(5), signal())).rejects.toMatchObject({ code: "TMDB_UNAVAILABLE", status: 503 });
  });
  it("stops new requests after a 429 and never retries", async () => {
    vi.stubEnv("TMDB_READ_ACCESS_TOKEN", "test-secret");
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 429, headers: { "retry-after": "120" } })));
    vi.stubGlobal("fetch", fetcher);
    await expect(enrichMovies(selected(25), signal())).rejects.toMatchObject({ code: "TMDB_RATE_LIMITED", retryAfter: 120 });
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(4);
  });
  it("does not start work after the total budget expires", async () => {
    vi.stubEnv("TMDB_READ_ACCESS_TOKEN", "test-secret");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(enrichMovies(selected(5), AbortSignal.abort())).rejects.toMatchObject({ status: 504 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("API contracts and image response protection", () => {
  it("filters before enriching and distinguishes entry and unique counts", async () => {
    vi.stubEnv("TMDB_READ_ACCESS_TOKEN", "test-secret");
    const fetcher = vi.fn(async (url: URL) => url.host === "letterboxd.com"
      ? new Response(rss, { headers: { "content-type": "application/rss+xml" } })
      : json(movieMetadata(Number(url.pathname.split("/").pop()))));
    vi.stubGlobal("fetch", fetcher);
    const response = await collageRoute(new Request("http://localhost/api/collage?username=DAVE&start=2026-09-06&end=2026-09-12&grid=3"));
    const result = await response.json() as CollageResponse;
    expect(response.status).toBe(200);
    expect(result).toMatchObject({ username: "dave", entriesInPeriod: 1, uniqueFilmsInPeriod: 1, displayedCount: 1 });
    expect(result.movies[0]?.poster).toEqual({ kind: "image", url: "/api/poster?poster_path=%2Fabc.jpg" });
    expect(result.movies[0]?.rating).toBe(4);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(cacheCalls[0]).toMatchObject({ keys: ["cinegrid-rss-v2", "dave"], revalidate: 600 });
    expect(result.warnings[0]?.code).toBe("RSS_LIMITED");
  });
  it("accepts a wide custom range with one RSS call and rejects reversed dates without external calls", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("<rss><channel/></rss>", { headers: { "content-type": "application/rss+xml" } }));
    vi.stubGlobal("fetch", fetcher);
    const allowed = await collageRoute(new Request("http://localhost/api/collage?username=dave&start=2025-01-01&end=2026-09-12&grid=3"));
    expect(allowed.status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockClear();
    const rejected = await collageRoute(new Request("http://localhost/api/collage?username=dave&start=2026-09-12&end=2026-03-16&grid=3"));
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).error.code).toBe("INVALID_DATES");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns stable errors without a secret or upstream response body", async () => {
    vi.stubEnv("TMDB_READ_ACCESS_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(rss, { headers: { "content-type": "application/rss+xml" } })));
    const response = await collageRoute(new Request("http://localhost/api/collage?username=dave&start=2026-09-01&end=2026-09-12&grid=3"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("TMDB_NOT_CONFIGURED");
    expect(body.error.stack).toBeUndefined();
  });
  it("rejects malformed requests without external calls", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const response = await collageRoute(new Request("http://localhost/api/collage?username=https://evil.test&start=x&end=x&grid=3"));
    expect(response.status).toBe(400);
    const poster = await posterRoute(new Request("http://localhost/api/poster?poster_path=https://evil.test/a.jpg"));
    expect(poster.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("passes through WebP bytes served on a .jpg path without visitor cookies", async () => {
    const webp = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80, 0]);
    const fetcher = vi.fn().mockResolvedValue(new Response(webp, { headers: { "content-type": "image/webp" } }));
    vi.stubGlobal("fetch", fetcher);
    const response = await posterRoute(new Request("http://localhost/api/poster?poster_path=%2Fabc.jpg", { headers: { cookie: "private=value" } }));
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("s-maxage=86400");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(webp);
    expect(fetcher.mock.calls[0]?.[1].headers).not.toHaveProperty("cookie");
  });
  it.each(["text/html", "image/svg+xml", "image/jpeg"])("rejects SVG or misleading MIME %s", async (type) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<svg></svg>", { headers: { "content-type": type } })));
    await expect(fetchPoster("/abc.jpg")).rejects.toMatchObject({ code: "POSTER_INVALID" });
  });
  it("does not cache oversized image errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(LIMITS.posterBytes + 1), { headers: { "content-type": "image/jpeg" } })));
    const response = await posterRoute(new Request("http://localhost/api/poster?poster_path=%2Fabc.jpg"));
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
