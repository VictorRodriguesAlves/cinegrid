"use client";

import { useEffect, useRef } from "react";
import type { CollageResponse } from "@/types/collage";
import { displayDate, displayRange } from "@/lib/dates";
import { ratingLabel, ratingStars } from "@/lib/ratings";

export interface ReadyCollage { result: CollageResponse; canvas: HTMLCanvasElement; blob: Blob; failedPosters: string[] }

export function CollagePreview({ collage, downloading, onDownload }: { collage: ReadyCollage; downloading: boolean; onDownload: () => void }) {
  const preview = useRef<HTMLCanvasElement>(null);
  const { result, failedPosters } = collage;
  useEffect(() => {
    const canvas = preview.current;
    if (!canvas) return;
    canvas.width = collage.canvas.width;
    canvas.height = collage.canvas.height;
    canvas.getContext("2d")?.drawImage(collage.canvas, 0, 0);
  }, [collage]);
  return <div className="result-content">
    <div className="result-heading"><div><p className="eyebrow">Sua seleção</p><h2>@{result.username}</h2></div><span className="format-badge">{result.grid} × {result.grid}</span></div>
    <p className="result-dates">{displayRange(result.start, result.end)}</p>
    <p className="result-count"><strong>{result.uniqueFilmsInPeriod} {result.uniqueFilmsInPeriod === 1 ? "filme único encontrado" : "filmes únicos encontrados"}</strong> no feed para o período, em {result.entriesInPeriod} {result.entriesInPeriod === 1 ? "entrada do diário" : "entradas do diário"}.</p>
    {result.uniqueFilmsInPeriod > result.displayedCount && <p className="cut-notice">A grade exibe os {result.displayedCount} filmes mais recentes.</p>}
    <canvas ref={preview} className="collage-canvas" width={collage.canvas.width} height={collage.canvas.height} role="img" aria-label={`Colagem de ${result.displayedCount} filmes de ${result.username}. Títulos disponíveis na lista abaixo.`} />
    <button className="primary download-button" onClick={onDownload} disabled={downloading}>
      <span aria-hidden="true">↓</span> {downloading ? "Preparando download…" : "Baixar PNG"}
    </button>
    <p className="download-caption">1080 × {collage.canvas.height} px · PNG · Gerado no seu navegador</p>
    <div className="result-warnings" role="status">
      {result.warnings.filter((warning) => warning.code !== "RSS_LIMITED").map((warning) => <p key={warning.code}>{warning.message}</p>)}
      {failedPosters.length > 0 && <p>{failedPosters.length} {failedPosters.length === 1 ? "pôster falhou" : "pôsteres falharam"} no carregamento. Os títulos foram mantidos na imagem.</p>}
    </div>
    <details className="movie-list"><summary>Filmes na colagem <span>{result.displayedCount}</span></summary>
      <ol>{result.movies.map((movie) => <li key={movie.key}>
        <div>{movie.entryUrl ? <a href={movie.entryUrl} target="_blank" rel="noreferrer">{movie.title}</a> : <span>{movie.title}</span>}{movie.year && <span className="movie-year"> ({movie.year})</span>}</div>
        <div className="movie-rating">{movie.rating != null
          ? <><span aria-hidden="true">{ratingStars(movie.rating)} </span><span>{ratingLabel(movie.rating)}</span></>
          : <small>Avaliação não informada no RSS</small>}</div>
        <small>Visto em {displayDate(movie.watchedDate)}{(movie.poster.kind === "placeholder" || failedPosters.includes(movie.key)) && " · Pôster indisponível"}</small>
      </li>)}</ol>
    </details>
  </div>;
}
