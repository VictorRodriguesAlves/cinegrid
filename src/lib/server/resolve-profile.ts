import "server-only";
import { unstable_cache } from "next/cache";
import { LIMITS } from "@/lib/constants";
import { InputError, normalizeUsername, shortLinkCode } from "@/lib/validation";
import { AppError } from "./errors";
import { parseRetryAfter, waitForSignal } from "./safe-fetch";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RESOURCE_PATHS = new Set(["film", "films", "list", "lists", "members", "journal", "search", "about", "news", "reviews"]);
const invalidLink = () => new InputError("SHORT_LINK_INVALID", "Use um link curto de perfil do Letterboxd. Links de filmes, reviews ou listas não são aceitos.", "username");
const timedOut = () => new AppError("SHORT_LINK_TIMEOUT", 504, "O link curto demorou demais para responder. Tente novamente ou informe o nome de usuário.");

async function fetchShortProfile(code: string, parentSignal?: AbortSignal): Promise<string> {
  const target = new URL(`https://boxd.it/${code}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.shortLinkTimeoutMs);
  const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
  try {
    // HEAD reads only headers. Never fetch the redirect destination or parse HTML.
    const response = await waitForSignal(() => fetch(target, {
      method: "HEAD", redirect: "manual", cache: "no-store", credentials: "omit", signal,
    }), signal);
    await waitForSignal(() => response.body?.cancel() ?? Promise.resolve(), signal);
    if (response.url && response.url !== target.href) throw invalidLink();
    if (response.status === 404 || response.status === 410) throw invalidLink();
    if (!REDIRECT_STATUSES.has(response.status)) {
      const limited = response.status === 403 || response.status === 429;
      throw new AppError("SHORT_LINK_UNAVAILABLE", response.status === 429 ? 503 : 502,
        limited ? "O Letterboxd bloqueou ou limitou a consulta ao link curto. Tente mais tarde ou informe o nome de usuário."
          : "Não foi possível resolver o link curto. Tente novamente ou informe o nome de usuário.",
        parseRetryAfter(response.headers.get("retry-after")));
    }
    const location = response.headers.get("location");
    // Check the original Location string before URL normalization can hide paths,
    // ports or credentials. A second short link is not followed either.
    if (!location || location !== location.trim() || !/^https:\/\/letterboxd\.com\/[a-z0-9_-]{1,40}\/?$/i.test(location)) throw invalidLink();
    const username = normalizeUsername(location);
    if (RESOURCE_PATHS.has(username)) throw invalidLink();
    return username;
  } catch (error) {
    if (signal.aborted) throw timedOut();
    if (error instanceof InputError || error instanceof AppError) throw error;
    throw new AppError("SHORT_LINK_UNAVAILABLE", 502, "Não foi possível resolver o link curto. Confira sua conexão ou informe o nome de usuário.");
  } finally { clearTimeout(timer); }
}

export async function resolveProfileUsername(input: string, signal?: AbortSignal): Promise<string> {
  const code = shortLinkCode(input);
  if (!code) return normalizeUsername(input);
  const cached = unstable_cache(() => fetchShortProfile(code, signal), ["cinegrid-profile-link-v1", code], { revalidate: LIMITS.shortLinkCacheSeconds });
  try { return await (signal ? waitForSignal(cached, signal) : cached()); }
  catch (error) {
    if (signal?.aborted) throw timedOut();
    throw error;
  }
}
