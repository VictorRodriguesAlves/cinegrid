import type { CollageRequest, ErrorCode } from "@/types/collage";
import { isCalendarDate, isValidRange } from "./dates";

export class InputError extends Error {
  constructor(public code: ErrorCode, message: string, public field?: "username" | "dates" | "grid") {
    super(message);
    this.name = "InputError";
  }
}

const USERNAME = /^[a-z0-9_-]{1,40}$/i;

export function normalizeUsername(input: string): string {
  const value = input.trim();
  if (USERNAME.test(value)) return value.toLowerCase();
  // Match the original string: URL() would silently normalize traversal and ports.
  const profile = /^https:\/\/letterboxd\.com\/([a-z0-9_-]{1,40})\/?$/i.exec(value);
  if (profile?.[1]) return profile[1].toLowerCase();
  throw new InputError("INVALID_USERNAME", "Informe um usuário, uma URL de perfil do Letterboxd ou um link curto como https://boxd.it/codigo.", "username");
}

export function shortLinkCode(input: string): string | null {
  // Codes are case-sensitive; only the scheme and official host ignore case.
  return /^https:\/\/boxd\.it\/([a-z0-9]{1,32})\/?$/i.exec(input.trim())?.[1] ?? null;
}

export function normalizeProfileInput(input: string): string {
  const code = shortLinkCode(input);
  return code ? `https://boxd.it/${code}` : normalizeUsername(input);
}

export function validateQueryKeys(params: URLSearchParams, keys: readonly string[]): void {
  if ([...params.keys()].some((key) => !keys.includes(key)) || keys.some((key) => params.getAll(key).length !== 1)) {
    throw new InputError("INVALID_QUERY", "Parâmetros ausentes, repetidos ou desconhecidos.");
  }
}

export function validateDateRange(start: string, end: string): void {
  if (isValidRange(start, end)) return;
  if (isCalendarDate(start) && isCalendarDate(end) && start > end) throw new InputError("INVALID_DATES", "A data inicial deve ser anterior ou igual à data final.", "dates");
  throw new InputError("INVALID_DATES", "Preencha uma data inicial e uma data final válidas.", "dates");
}

export function parseCollageRequest(params: URLSearchParams): CollageRequest {
  validateQueryKeys(params, ["username", "start", "end", "grid"]);
  const username = normalizeProfileInput(params.get("username") ?? "");
  const start = params.get("start") ?? "";
  const end = params.get("end") ?? "";
  validateDateRange(start, end);
  const grid = params.get("grid");
  if (grid !== "3" && grid !== "4" && grid !== "5") throw new InputError("INVALID_GRID", "Escolha uma grade 3 × 3, 4 × 4 ou 5 × 5.", "grid");
  return { username, start, end, grid: grid === "3" ? 3 : grid === "4" ? 4 : 5 };
}

export function validPosterPath(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && /^\/[A-Za-z0-9]{1,128}\.(?:jpg|jpeg|png|webp)$/.test(value);
}

export function validEntryUrl(value: unknown, username: string): string | null {
  if (typeof value !== "string" || value.length > 512 || value !== value.trim()) return null;
  const match = /^https:\/\/letterboxd\.com\/([a-z0-9_-]{1,40})\/film\/[a-z0-9-]+\/(?:\d+\/)?$/.exec(value);
  return match?.[1] === username ? value : null;
}

export function normalizeTitle(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}
