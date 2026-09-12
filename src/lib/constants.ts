export const LIMITS = {
  xmlBytes: 1024 * 1024,
  metadataBytes: 1024 * 1024,
  posterBytes: 1024 * 1024,
  rssTimeoutMs: 8_000,
  shortLinkTimeoutMs: 4_000,
  metadataTimeoutMs: 4_000,
  posterTimeoutMs: 8_000,
  collageBudgetMs: 25_000,
  clientQueryTimeoutMs: 32_000,
  clientPostersBudgetMs: 60_000,
  tmdbConcurrency: 4,
  posterConcurrency: 4,
  maxMovies: 25,
  rssCacheSeconds: 600,
  shortLinkCacheSeconds: 600,
  metadataCacheSeconds: 86_400,
  posterCacheSeconds: 86_400,
} as const;

export const RSS_WARNING = "O RSS mostra apenas atividades recentes disponibilizadas pelo Letterboxd. Alguns filmes do período podem não aparecer.";
export const EMPTY_MESSAGE = "Nenhum filme com data de visualização foi encontrado no RSS para este período.";
