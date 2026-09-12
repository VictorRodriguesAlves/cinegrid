import "server-only";
import { LIMITS } from "@/lib/constants";
import { validPosterPath } from "@/lib/validation";
import { AppError } from "./errors";
import { FetchFailure, safeFetch } from "./safe-fetch";

export function rasterType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length >= 8 && png.every((byte, index) => bytes[index] === byte)) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function fetchPoster(path: string, signal?: AbortSignal) {
  if (!validPosterPath(path)) throw new AppError("INVALID_POSTER_PATH", 400, "Caminho de pôster inválido.");
  try {
    const result = await safeFetch(`https://image.tmdb.org/t/p/w500${path}`, {
      host: "image.tmdb.org", accept: "image/jpeg, image/png, image/webp",
      timeoutMs: LIMITS.posterTimeoutMs, maxBytes: LIMITS.posterBytes, signal,
    });
    const type = rasterType(result.bytes);
    if (!type || type !== result.contentType) throw new AppError("POSTER_INVALID", 502, "O provedor não retornou uma imagem compatível.");
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof FetchFailure) {
      if (error.kind === "too_large") throw new AppError("POSTER_TOO_LARGE", 502, "O pôster excedeu o limite de tamanho.");
      if (error.kind === "timeout" || error.kind === "aborted") throw new AppError("POSTER_TIMEOUT", 504, "O pôster demorou demais para carregar.");
      if (error.status === 404) throw new AppError("POSTER_UNAVAILABLE", 404, "Pôster indisponível.");
      if (error.status === 429) throw new AppError("POSTER_UNAVAILABLE", 503, "O provedor limitou o carregamento de pôsteres.", error.retryAfter);
    }
    throw new AppError("POSTER_UNAVAILABLE", 502, "Não foi possível carregar este pôster.");
  }
}
