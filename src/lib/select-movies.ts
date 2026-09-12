import type { DiaryEntry, Grid, SelectedMovie } from "@/types/collage";
import { normalizeTitle } from "./validation";

function fallbackKey(entry: DiaryEntry): string {
  return JSON.stringify([normalizeTitle(entry.title), entry.year]);
}

export function selectMovies(entries: DiaryEntry[], start: string, end: string, grid: Grid) {
  const filtered = entries.filter((entry) => entry.watchedDate >= start && entry.watchedDate <= end);
  filtered.sort((a, b) => b.watchedDate.localeCompare(a.watchedDate)
    || (a.entryId < b.entryId ? -1 : a.entryId > b.entryId ? 1 : 0)
    || a.sourceIndex - b.sourceIndex);

  // Reconcile an ID-less rewatch only when title/year maps to exactly one known ID.
  const idsByTitle = new Map<string, Set<number>>();
  for (const entry of filtered) {
    if (entry.tmdbId !== null) {
      const key = fallbackKey(entry);
      const ids = idsByTitle.get(key) ?? new Set<number>();
      ids.add(entry.tmdbId);
      idsByTitle.set(key, ids);
    }
  }
  const unique = new Map<string, SelectedMovie>();
  for (const entry of filtered) {
    const fallback = fallbackKey(entry);
    const knownIds = idsByTitle.get(fallback);
    const tmdbId = entry.tmdbId ?? (knownIds?.size === 1 ? [...knownIds][0] ?? null : null);
    const key = tmdbId === null ? `title:${fallback}` : `tmdb:${tmdbId}`;
    if (!unique.has(key)) {
      unique.set(key, { key, title: entry.title, year: entry.year, watchedDate: entry.watchedDate, rating: entry.rating, tmdbId, entryUrl: entry.entryUrl });
    }
  }
  const movies = [...unique.values()].slice(0, grid * grid);
  return { entriesInPeriod: filtered.length, uniqueFilmsInPeriod: unique.size, displayedCount: movies.length, movies };
}
