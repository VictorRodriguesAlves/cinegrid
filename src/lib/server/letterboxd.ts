import "server-only";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { unstable_cache } from "next/cache";
import type { DiaryEntry } from "@/types/collage";
import { LIMITS } from "@/lib/constants";
import { isCalendarDate } from "@/lib/dates";
import { validEntryUrl } from "@/lib/validation";
import { parseRating } from "@/lib/ratings";
import { AppError } from "./errors";
import { FetchFailure, safeFetch, waitForSignal } from "./safe-fetch";

type XmlObject = Record<string, unknown>;
function object(value: unknown): XmlObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as XmlObject : null;
}
function scalar(value: unknown): string | null {
  if (typeof value === "string") return value.trim();
  const nested = object(value)?.["#text"];
  return typeof nested === "string" ? nested.trim() : null;
}

function field(item: XmlObject, namespaces: XmlObject, uri: string, name: string): string | null {
  for (const key of Object.keys(item)) {
    const [prefix, local] = key.split(":");
    if (local === name && namespaces[`@_xmlns:${prefix}`] === uri) return scalar(item[key]);
  }
  return null;
}

export function parseRss(xml: string, username: string): DiaryEntry[] {
  const invalid = () => new AppError("RSS_INVALID", 502, "O Letterboxd não retornou um RSS válido. Tente novamente mais tarde.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw invalid();
  let parsed: unknown;
  try {
    parsed = new XMLParser({
      ignoreAttributes: false, removeNSPrefix: false, parseTagValue: false,
      // This parser version gates numeric XML references behind htmlEntities.
      // DTD/input entity declarations are rejected before reaching the parser.
      parseAttributeValue: false, processEntities: true, htmlEntities: true,
    }).parse(xml);
  } catch { throw invalid(); }
  const rss = object(object(parsed)?.rss);
  const channel = rss?.channel === "" ? {} : object(rss?.channel);
  if (!rss || !channel) throw invalid();
  const rawItems = channel.item === undefined ? [] : Array.isArray(channel.item) ? channel.item : [channel.item];
  const entries: DiaryEntry[] = [];
  rawItems.forEach((raw, sourceIndex) => {
    const item = object(raw);
    if (!item) return;
    const namespaces = { ...rss, ...channel, ...item };
    const title = field(item, namespaces, "https://letterboxd.com", "filmTitle");
    const watchedDate = field(item, namespaces, "https://letterboxd.com", "watchedDate");
    const rating = parseRating(field(item, namespaces, "https://letterboxd.com", "memberRating"));
    const rawLink = scalar(item.link);
    // A list or a TV record is never a diary film, even with stray movie fields.
    if (rawLink?.includes("/list/") || Object.keys(item).some((key) => /:tvId$/.test(key))) return;
    if (!title || title.length > 500 || !watchedDate || !isCalendarDate(watchedDate)) return;
    const rawYear = field(item, namespaces, "https://letterboxd.com", "filmYear");
    const year = rawYear && /^[1-9]\d{3}$/.test(rawYear) ? Number(rawYear) : null;
    const rawId = field(item, namespaces, "https://themoviedb.org", "movieId");
    const tmdbId = rawId && /^[1-9]\d{0,9}$/.test(rawId) ? Number(rawId) : null;
    const entryUrl = validEntryUrl(rawLink, username);
    const guid = scalar(item.guid);
    entries.push({ title, watchedDate, rating, year, tmdbId, entryUrl, entryId: guid?.slice(0, 512) || entryUrl || `index:${sourceIndex}`, sourceIndex });
  });
  return entries;
}

export async function fetchRss(username: string, signal?: AbortSignal): Promise<DiaryEntry[]> {
  try {
    const { bytes, contentType } = await safeFetch(`https://letterboxd.com/${username}/rss/`, {
      host: "letterboxd.com", accept: "application/rss+xml, application/xml, text/xml",
      timeoutMs: LIMITS.rssTimeoutMs, maxBytes: LIMITS.xmlBytes, signal,
    });
    if (!["application/rss+xml", "application/xml", "text/xml"].includes(contentType)) {
      throw new AppError("RSS_BLOCKED", 502, "O Letterboxd retornou uma página em vez do RSS. A integração pode estar temporariamente bloqueada.");
    }
    let xml: string;
    try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new AppError("RSS_INVALID", 502, "O RSS recebido não pôde ser interpretado."); }
    return parseRss(xml, username);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof FetchFailure) {
      if (error.kind === "too_large") throw new AppError("RSS_TOO_LARGE", 502, "O RSS excedeu o limite de tamanho desta aplicação.");
      if (error.kind === "timeout" || error.kind === "aborted") throw new AppError("RSS_TIMEOUT", 504, "O Letterboxd demorou demais para responder. Tente novamente.");
      if (error.status === 403 || error.status === 429) throw new AppError("RSS_BLOCKED", 502, "O Letterboxd bloqueou ou limitou a consulta ao RSS. Tente novamente mais tarde.", error.retryAfter);
    }
    throw new AppError("RSS_UNAVAILABLE", 502, "Não foi possível consultar o RSS do Letterboxd. Confira o usuário e tente novamente mais tarde.");
  }
}

export async function getRss(username: string, signal?: AbortSignal): Promise<DiaryEntry[]> {
  const cached = unstable_cache(() => fetchRss(username, signal), ["cinegrid-rss-v2", username], { revalidate: LIMITS.rssCacheSeconds });
  try { return await (signal ? waitForSignal(cached, signal) : cached()); }
  catch (error) {
    if (signal?.aborted) throw new AppError("RSS_TIMEOUT", 504, "A consulta ao RSS excedeu o limite de tempo. Tente novamente.");
    throw error;
  }
}
