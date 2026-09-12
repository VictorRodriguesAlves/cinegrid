import type { CollageResponse, Grid, Movie } from "@/types/collage";
import { LIMITS } from "./constants";
import { mapLimit } from "./concurrency";
import { displayRange } from "./dates";
import { ratingStars } from "./ratings";

export function collageLayout(grid: Grid) {
  const width = 1080, margin = 24, gap = 8, gridTop = 112;
  const cellWidth = (width - margin * 2 - gap * (grid - 1)) / grid;
  const cellHeight = cellWidth * 1.5;
  return { width, height: Math.ceil(gridTop + grid * cellHeight + gap * (grid - 1) + margin), margin, gap, gridTop, cellWidth, cellHeight };
}

async function loadPoster(url: string, signal: AbortSignal): Promise<ImageBitmap | null> {
  let objectUrl: string | null = null;
  try {
    signal.throwIfAborted();
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(LIMITS.posterTimeoutMs + 2_000)]), credentials: "omit" });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size > LIMITS.posterBytes || !["image/jpeg", "image/png", "image/webp"].includes(blob.type)) return null;
    // decode() finishes before drawing; the bitmap can then be explicitly released.
    objectUrl = URL.createObjectURL(blob);
    const element = new Image();
    element.src = objectUrl;
    await element.decode();
    signal.throwIfAborted();
    return await createImageBitmap(element);
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  } finally { if (objectUrl) URL.revokeObjectURL(objectUrl); }
}

function wrapTitle(context: CanvasRenderingContext2D, title: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of title.trim().split(/\s+/u)) {
    if (line && context.measureText(`${line} ${word}`).width > width) {
      lines.push(line);
      line = "";
    }
    if (line) line += " ";
    // Prefer whole words, but allow an unusually long word to fit the cell.
    for (const character of Array.from(word)) {
      if (line && context.measureText(line + character).width > width) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
  }
  if (line) lines.push(line.trim());
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1] ?? "";
    while (last && context.measureText(`${last}…`).width > width) last = Array.from(last).slice(0, -1).join("");
    lines[maxLines - 1] = `${last.trim()}…`;
  }
  return lines;
}

function drawPlaceholder(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  context.save();
  context.fillStyle = "#252c2a";
  context.fillRect(x, y, width, height);
  context.textAlign = "center";
  context.font = "400 17px system-ui, sans-serif";
  context.fillStyle = "#a8b6ad";
  context.fillText("Pôster indisponível", x + width / 2, y + height / 2);
  context.restore();
}

function drawMovieCaption(context: CanvasRenderingContext2D, movie: Movie, x: number, y: number, width: number, height: number) {
  const inset = Math.round(Math.max(12, width * 0.05));
  const titleSize = Math.round(Math.max(18, width * 0.067));
  const ratingSize = Math.round(Math.max(22, width * 0.078));
  const lineHeight = Math.round(titleSize * 1.25);
  const bottom = y + height - 18;
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  // Outline only the glyphs, keeping the poster visible behind the caption.
  context.strokeStyle = "rgba(17, 23, 21, 0.8)";
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.font = `600 ${titleSize}px system-ui, sans-serif`;
  context.fillStyle = "#f4f6f2";
  const lines = wrapTitle(context, movie.title, width - inset * 2, 3);
  const titleBottom = bottom - (movie.rating == null ? 0 : ratingSize + 8);
  lines.forEach((line, index) => {
    const baseline = titleBottom - (lines.length - 1 - index) * lineHeight;
    context.strokeText(line, x + inset, baseline);
    context.fillText(line, x + inset, baseline);
  });
  if (movie.rating != null) {
    const stars = ratingStars(movie.rating);
    context.font = `600 ${ratingSize}px system-ui, sans-serif`;
    context.fillStyle = "#b2ef80";
    context.strokeText(stars, x + inset, bottom);
    context.fillText(stars, x + inset, bottom);
  }
  context.restore();
}

export async function renderCollage(canvas: HTMLCanvasElement, result: CollageResponse, signal: AbortSignal): Promise<{ blob: Blob; failedPosters: string[] }> {
  const bitmaps: ImageBitmap[] = [];
  try {
    await document.fonts.ready;
    signal.throwIfAborted();
    const imageSignal = AbortSignal.any([signal, AbortSignal.timeout(LIMITS.clientPostersBudgetMs)]);
    const images = await mapLimit(result.movies, LIMITS.posterConcurrency, async (movie) => {
      let bitmap: ImageBitmap | null = null;
      if (movie.poster.kind === "image" && !imageSignal.aborted) {
        try { bitmap = await loadPoster(movie.poster.url, imageSignal); }
        catch { /* The generation signal is checked before committing the canvas. */ }
      }
      if (bitmap) bitmaps.push(bitmap);
      return bitmap;
    });
    signal.throwIfAborted();
    const layout = collageLayout(result.grid);
    canvas.width = layout.width;
    canvas.height = layout.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Seu navegador não disponibilizou o Canvas 2D.");
    context.fillStyle = "#111715";
    context.fillRect(0, 0, layout.width, layout.height);
    context.textBaseline = "middle";
    context.fillStyle = "#b2ef80";
    context.font = "600 30px system-ui, sans-serif";
    context.fillText(`@${result.username}`, layout.margin, 38, layout.width - 190);
    context.fillStyle = "#b4bdb7";
    context.font = "400 22px system-ui, sans-serif";
    context.fillText(displayRange(result.start, result.end), layout.margin, 78);
    context.fillStyle = "#b4bdb7";
    context.textAlign = "right";
    context.font = "500 22px system-ui, sans-serif";
    context.fillText("CineGrid", layout.width - layout.margin, 38);
    context.textAlign = "left";
    const failedPosters: string[] = [];
    for (let index = 0; index < result.grid * result.grid; index++) {
      const x = layout.margin + (index % result.grid) * (layout.cellWidth + layout.gap);
      const y = layout.gridTop + Math.floor(index / result.grid) * (layout.cellHeight + layout.gap);
      const movie = result.movies[index];
      const bitmap = images[index];
      if (!movie) {
        context.fillStyle = "#19201c";
        context.fillRect(x, y, layout.cellWidth, layout.cellHeight);
      } else if (bitmap) {
        const scale = Math.max(layout.cellWidth / bitmap.width, layout.cellHeight / bitmap.height);
        const sourceWidth = layout.cellWidth / scale, sourceHeight = layout.cellHeight / scale;
        context.drawImage(bitmap, (bitmap.width - sourceWidth) / 2, (bitmap.height - sourceHeight) / 2, sourceWidth, sourceHeight, x, y, layout.cellWidth, layout.cellHeight);
      } else {
        drawPlaceholder(context, x, y, layout.cellWidth, layout.cellHeight);
        if (movie.poster.kind === "image") failedPosters.push(movie.key);
      }
      if (movie) drawMovieCaption(context, movie, x, y, layout.cellWidth, layout.cellHeight);
    }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Não foi possível exportar o PNG. Tente gerar novamente.")), "image/png"));
    signal.throwIfAborted();
    return { blob, failedPosters };
  } finally { bitmaps.forEach((bitmap) => bitmap.close()); }
}
