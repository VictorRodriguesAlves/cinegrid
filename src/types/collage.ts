export type Grid = 3 | 4 | 5;
export type Period = "week" | "30days" | "custom";

export type PlaceholderReason = "not_found" | "ambiguous" | "no_poster" | "unavailable";
export type Poster =
  | { kind: "image"; url: string }
  | { kind: "placeholder"; reason: PlaceholderReason };

export interface DiaryEntry {
  entryId: string;
  sourceIndex: number;
  title: string;
  year: number | null;
  watchedDate: string;
  /** Member's rating on this diary entry, in half-star steps from 0.5 to 5. */
  rating: number | null;
  tmdbId: number | null;
  entryUrl: string | null;
}

export interface SelectedMovie extends Omit<DiaryEntry, "entryId" | "sourceIndex"> {
  key: string;
}

export interface Movie extends SelectedMovie {
  poster: Poster;
}

export type WarningCode = "RSS_LIMITED" | "POSTERS_PARTIAL" | "TMDB_TEMPORARY" | "TIME_BUDGET";
export interface CollageWarning {
  code: WarningCode;
  message: string;
}

export interface CollageRequest {
  username: string;
  start: string;
  end: string;
  grid: Grid;
}

export interface CollageResponse extends CollageRequest {
  entriesInPeriod: number;
  uniqueFilmsInPeriod: number;
  displayedCount: number;
  warnings: CollageWarning[];
  movies: Movie[];
}

export type ErrorCode =
  | "INVALID_USERNAME" | "INVALID_DATES" | "INVALID_GRID" | "INVALID_QUERY"
  | "SHORT_LINK_INVALID" | "SHORT_LINK_UNAVAILABLE" | "SHORT_LINK_TIMEOUT"
  | "INVALID_POSTER_PATH" | "RSS_BLOCKED" | "RSS_UNAVAILABLE" | "RSS_INVALID"
  | "RSS_TOO_LARGE" | "RSS_TIMEOUT" | "TMDB_NOT_CONFIGURED" | "TMDB_AUTH_FAILED"
  | "TMDB_UNAVAILABLE" | "TMDB_RATE_LIMITED" | "POSTER_UNAVAILABLE" | "POSTER_INVALID"
  | "POSTER_TOO_LARGE" | "POSTER_TIMEOUT" | "INTERNAL_ERROR";

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; field?: "username" | "dates" | "grid" };
}
