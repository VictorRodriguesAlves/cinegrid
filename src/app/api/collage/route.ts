import type { CollageResponse } from "@/types/collage";
import { LIMITS, RSS_WARNING } from "@/lib/constants";
import { parseCollageRequest } from "@/lib/validation";
import { selectMovies } from "@/lib/select-movies";
import { errorResponse } from "@/lib/server/errors";
import { getRss } from "@/lib/server/letterboxd";
import { enrichMovies } from "@/lib/server/tmdb";
import { resolveProfileUsername } from "@/lib/server/resolve-profile";

export const runtime = "nodejs";
// Next requires a statically analyzable literal; internal budget is LIMITS.collageBudgetMs.
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  try {
    const parsed = parseCollageRequest(new URL(request.url).searchParams);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(LIMITS.collageBudgetMs)]);
    const input = { ...parsed, username: await resolveProfileUsername(parsed.username, signal) };
    const entries = await getRss(input.username, signal);
    const selection = selectMovies(entries, input.start, input.end, input.grid);
    const enriched = await enrichMovies(selection.movies, signal);
    const result: CollageResponse = {
      ...input, ...selection, movies: enriched.movies,
      warnings: [{ code: "RSS_LIMITED", message: RSS_WARNING }, ...enriched.warnings],
    };
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
