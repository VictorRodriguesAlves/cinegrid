import "server-only";
import { createHash } from "node:crypto";
import { unstable_cache } from "next/cache";
import type { CollageWarning, Movie, PlaceholderReason, SelectedMovie } from "@/types/collage";
import { LIMITS } from "@/lib/constants";
import { createLimiter, mapLimit } from "@/lib/concurrency";
import { normalizeTitle, validPosterPath } from "@/lib/validation";
import { AppError } from "./errors";
import { FetchFailure, safeFetch, waitForSignal } from "./safe-fetch";

interface TmdbMovie { id: number; title: string; original_title: string; release_date: string; poster_path: string | null }
interface Resolution { tmdbId: number | null; posterPath: string | null; reason: PlaceholderReason }
class MovieNotFound extends Error {}

function asMovie(value: unknown): TmdbMovie | null {
  if (!value || typeof value !== "object") return null;
  const movie = value as Record<string, unknown>;
  if (!Number.isSafeInteger(movie.id) || Number(movie.id) <= 0 || typeof movie.title !== "string" || typeof movie.original_title !== "string") return null;
  return {
    id: Number(movie.id), title: movie.title, original_title: movie.original_title,
    release_date: typeof movie.release_date === "string" ? movie.release_date : "",
    poster_path: validPosterPath(movie.poster_path) ? movie.poster_path : null,
  };
}

export function matchSearchResult(data: unknown, title: string, year: number | null): Resolution {
  if (!data || typeof data !== "object") throw new AppError("TMDB_UNAVAILABLE", 503, "O TMDB retornou dados inválidos. Tente novamente mais tarde.");
  const response = data as Record<string, unknown>;
  if (!Array.isArray(response.results) || !Number.isSafeInteger(response.total_pages) || Number(response.total_pages) < 0) {
    throw new AppError("TMDB_UNAVAILABLE", 503, "O TMDB retornou dados inválidos. Tente novamente mais tarde.");
  }
  const wanted = normalizeTitle(title);
  const matches = response.results.map(asMovie).filter((movie): movie is TmdbMovie => movie !== null)
    .filter((movie) => (normalizeTitle(movie.title) === wanted || normalizeTitle(movie.original_title) === wanted)
      && (year === null || /^\d{4}-\d{2}-\d{2}$/.test(movie.release_date) && Number(movie.release_date.slice(0, 4)) === year));
  if (Number(response.total_pages) > 1 || matches.length > 1) return { tmdbId: null, posterPath: null, reason: "ambiguous" };
  const match = matches[0];
  if (!match) return { tmdbId: null, posterPath: null, reason: "not_found" };
  return { tmdbId: match.id, posterPath: match.poster_path, reason: "no_poster" };
}

async function fetchMetadata(url: string, token: string, signal: AbortSignal): Promise<unknown> {
  try {
    const { bytes, contentType } = await safeFetch(url, {
      host: "api.themoviedb.org", accept: "application/json", token, signal,
      maxBytes: LIMITS.metadataBytes, timeoutMs: LIMITS.metadataTimeoutMs,
    });
    if (contentType !== "application/json") throw new Error("Invalid metadata type");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof FetchFailure) {
      if (error.status === 401 || error.status === 403) throw new AppError("TMDB_AUTH_FAILED", 500, "A credencial do TMDB foi recusada. O responsável pelo site precisa revisar a configuração.");
      if (error.status === 404) throw new MovieNotFound();
      if (error.status === 429) throw new AppError("TMDB_RATE_LIMITED", 503, "O TMDB limitou as consultas. Aguarde antes de gerar novamente.", error.retryAfter);
    }
    throw new AppError("TMDB_UNAVAILABLE", 503, "O TMDB está temporariamente indisponível. Tente novamente mais tarde.");
  }
}

export async function enrichMovies(selected: SelectedMovie[], signal: AbortSignal): Promise<{ movies: Movie[]; warnings: CollageWarning[] }> {
  if (selected.length === 0) return { movies: [], warnings: [] };
  if (selected.length > LIMITS.maxMovies) throw new Error("Selected movie limit exceeded");
  const token = process.env.TMDB_READ_ACCESS_TOKEN?.trim();
  if (!token) throw new AppError("TMDB_NOT_CONFIGURED", 500, "O TMDB ainda não foi configurado. O responsável pelo site precisa definir TMDB_READ_ACCESS_TOKEN.");
  const authKey = createHash("sha256").update(token).digest("hex");
  const stop = new AbortController();
  const combined = AbortSignal.any([signal, stop.signal]);
  const limited = createLimiter(LIMITS.tmdbConcurrency);
  let fatal: AppError | null = null;
  let rateLimit: AppError | null = null;
  let validResponses = 0;
  let temporaryFailures = 0;

  const movies = await mapLimit(selected, LIMITS.tmdbConcurrency, async (movie): Promise<Movie> => {
    const placeholder: Movie = { ...movie, poster: { kind: "placeholder", reason: "unavailable" } };
    if (combined.aborted) { temporaryFailures++; return placeholder; }
    const key = movie.tmdbId !== null ? `id:${movie.tmdbId}` : JSON.stringify([normalizeTitle(movie.title), movie.year]);
    const lookup = unstable_cache(async (): Promise<Resolution> => limited(async () => {
      if (combined.aborted) throw new AppError("TMDB_UNAVAILABLE", 503, "Consulta interrompida.");
      if (movie.tmdbId !== null) {
        const value = asMovie(await fetchMetadata(`https://api.themoviedb.org/3/movie/${movie.tmdbId}?language=en-US`, token, combined));
        if (!value || value.id !== movie.tmdbId) throw new AppError("TMDB_UNAVAILABLE", 503, "O TMDB retornou dados inválidos.");
        return { tmdbId: value.id, posterPath: value.poster_path, reason: "no_poster" };
      }
      const params = new URLSearchParams({ query: movie.title, language: "en-US", page: "1", include_adult: "false" });
      if (movie.year !== null) params.set("primary_release_year", String(movie.year));
      return matchSearchResult(await fetchMetadata(`https://api.themoviedb.org/3/search/movie?${params}`, token, combined), movie.title, movie.year);
    }), ["cinegrid-tmdb-v1", authKey, key], { revalidate: LIMITS.metadataCacheSeconds });
    try {
      const result = await waitForSignal(lookup, combined);
      validResponses++;
      return { ...movie, tmdbId: result.tmdbId ?? movie.tmdbId, poster: result.posterPath
        ? { kind: "image", url: `/api/poster?${new URLSearchParams({ poster_path: result.posterPath })}` }
        : { kind: "placeholder", reason: result.reason } };
    } catch (error) {
      if (error instanceof MovieNotFound) {
        validResponses++;
        return { ...movie, poster: { kind: "placeholder", reason: "not_found" } };
      }
      temporaryFailures++;
      if (error instanceof AppError && error.code === "TMDB_AUTH_FAILED") { fatal = error; stop.abort(); }
      if (error instanceof AppError && error.code === "TMDB_RATE_LIMITED") { rateLimit = error; stop.abort(); }
      return placeholder;
    }
  });
  if (fatal) throw fatal;
  if (validResponses === 0 && temporaryFailures > 0) {
    throw rateLimit ?? new AppError("TMDB_UNAVAILABLE", signal.aborted ? 504 : 503, "Não foi possível consultar o TMDB nesta geração. Tente novamente mais tarde.");
  }
  const warnings: CollageWarning[] = [];
  if (temporaryFailures > 0) {
    console.error("[cinegrid]", JSON.stringify({ category: signal.aborted ? "TIME_BUDGET" : "TMDB_TEMPORARY", count: temporaryFailures }));
    warnings.push(signal.aborted
      ? { code: "TIME_BUDGET", message: "O limite de tempo foi atingido. Alguns filmes ficaram sem pôster; você pode tentar gerar novamente." }
      : { code: "TMDB_TEMPORARY", message: "O TMDB ficou indisponível ou limitou parte das consultas. Alguns filmes ficaram sem pôster; aguarde antes de tentar novamente." });
  }
  if (movies.some((movie) => movie.poster.kind === "placeholder")) {
    warnings.push({ code: "POSTERS_PARTIAL", message: "Alguns pôsteres não puderam ser identificados ou não estão disponíveis. Os títulos foram mantidos na colagem." });
  }
  return { movies, warnings };
}
