"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiErrorBody, CollageResponse, Grid, Period } from "@/types/collage";
import { EMPTY_MESSAGE, LIMITS, RSS_WARNING } from "@/lib/constants";
import { getDateRange } from "@/lib/dates";
import { InputError, normalizeProfileInput, validateDateRange } from "@/lib/validation";
import { renderCollage } from "@/lib/render-collage";
import { CollagePreview, type ReadyCollage } from "./collage-preview";

type Status = "idle" | "loading" | "rendering" | "ready" | "empty" | "error";

export function CollageForm() {
  const [username, setUsername] = useState("");
  const [period, setPeriod] = useState<Period>("week");
  const [customRange, setCustomRange] = useState({ start: "", end: "" });
  const [grid, setGrid] = useState<Grid>(3);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [collage, setCollage] = useState<ReadyCollage | null>(null);
  const [changed, setChanged] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const currentRequest = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const downloadRef = useRef(false);
  const downloadUrls = useRef(new Set<string>());
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const busy = status === "loading" || status === "rendering";

  useEffect(() => {
    const urls = downloadUrls.current;
    return () => {
      currentRequest.current?.abort();
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  function invalidate() {
    currentRequest.current?.abort();
    generation.current++;
    busyRef.current = false;
    setChanged(status !== "idle" || changed);
    setStatus("idle");
    setCollage(null);
    setError(null);
    downloadUrls.current.forEach((url) => URL.revokeObjectURL(url));
    downloadUrls.current.clear();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    currentRequest.current?.abort();
    const id = ++generation.current;
    const controller = new AbortController();
    currentRequest.current = controller;
    setError(null);
    setCollage(null);
    setChanged(false);
    try {
      const normalized = normalizeProfileInput(username);
      const range = period === "custom" ? customRange : getDateRange(period);
      validateDateRange(range.start, range.end);
      busyRef.current = true;
      setStatus("loading");
      const params = new URLSearchParams({ username: normalized, ...range, grid: String(grid) });
      const response = await fetch(`/api/collage?${params}`, {
        cache: "no-store", credentials: "omit",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(LIMITS.clientQueryTimeoutMs)]),
      });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("O servidor não retornou uma resposta válida. Tente novamente mais tarde.");
      const data: CollageResponse | ApiErrorBody = await response.json();
      if (id !== generation.current || controller.signal.aborted) return;
      if (!response.ok || "error" in data) {
        if ("error" in data) { setError(data.error); setStatus("error"); return; }
        throw new Error("Não foi possível gerar a colagem. Tente novamente.");
      }
      if (data.movies.length === 0) { setStatus("empty"); resultHeading.current?.focus(); return; }
      setStatus("rendering");
      const canvas = document.createElement("canvas");
      const rendered = await renderCollage(canvas, data, controller.signal);
      if (id !== generation.current || controller.signal.aborted) return;
      setCollage({ result: data, canvas, ...rendered });
      setStatus("ready");
      resultHeading.current?.focus();
    } catch (caught) {
      if (id !== generation.current || controller.signal.aborted) return;
      const message = caught instanceof InputError ? caught.message
        : caught instanceof Error && caught.name === "TimeoutError" ? "A consulta demorou demais. Tente novamente."
        : caught instanceof TypeError ? "Não foi possível conectar ao servidor. Confira sua conexão e tente novamente."
        : caught instanceof SyntaxError ? "O servidor retornou uma resposta inválida. Tente novamente mais tarde."
        : caught instanceof Error ? caught.message : "Não foi possível gerar a colagem. Tente novamente.";
      setError({ message, field: caught instanceof InputError ? caught.field : undefined });
      setStatus("error");
    } finally { if (id === generation.current) busyRef.current = false; }
  }

  function download() {
    if (!collage || status !== "ready" || downloadRef.current) return;
    downloadRef.current = true;
    setDownloading(true);
    const url = URL.createObjectURL(collage.blob);
    downloadUrls.current.add(url);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cinegrid-${collage.result.username}-${collage.result.start}-${collage.result.end}.png`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      downloadUrls.current.delete(url);
      downloadRef.current = false;
      setDownloading(false);
    }, 1_000);
  }

  return <div className="workspace">
    <div className="controls-column">
      <form className="form-card" onSubmit={submit} noValidate>
        <div className="section-heading"><span className="step-number">01</span><h2>Monte sua seleção</h2></div>
        <div className="field-group">
          <label htmlFor="username">Seu usuário no Letterboxd</label>
          <input id="username" name="username" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={180}
            placeholder="usuário, URL do perfil ou boxd.it" value={username}
            aria-invalid={error?.field === "username"} aria-describedby={`username-help${error?.field === "username" ? " username-error" : ""}`}
            onChange={(event) => { invalidate(); setUsername(event.target.value); }} />
          <p className="field-help" id="username-help">Só precisamos do seu nome de usuário. Sem senha.</p>
          {error?.field === "username" && <p className="field-error" id="username-error" role="alert">{error.message}</p>}
        </div>
        <fieldset><legend>Período</legend><div className="segmented period-options">
          {([{ value: "week", label: "Últimos 7 dias" }, { value: "30days", label: "Últimos 30 dias" }, { value: "custom", label: "Personalizado" }] as const).map((option) => <label key={option.value}>
            <input type="radio" name="period" value={option.value} checked={period === option.value} onChange={() => {
              invalidate();
              if (option.value === "custom" && !customRange.start && !customRange.end) setCustomRange(getDateRange("30days"));
              setPeriod(option.value);
            }} />
            <span>{option.label}</span>
          </label>)}
        </div>
          {period === "custom" && <div className="custom-period">
            <div className="date-fields">
              <label htmlFor="start-date">Data inicial<input id="start-date" name="start" type="date" required min="0001-01-01" max="9999-12-31" value={customRange.start}
                aria-invalid={error?.field === "dates"} aria-describedby={`dates-help${error?.field === "dates" ? " dates-error" : ""}`}
                onChange={(event) => { invalidate(); setCustomRange({ ...customRange, start: event.target.value }); }} /></label>
              <label htmlFor="end-date">Data final<input id="end-date" name="end" type="date" required min="0001-01-01" max="9999-12-31" value={customRange.end}
                aria-invalid={error?.field === "dates"} aria-describedby={`dates-help${error?.field === "dates" ? " dates-error" : ""}`}
                onChange={(event) => { invalidate(); setCustomRange({ ...customRange, end: event.target.value }); }} /></label>
            </div>
            <p className="field-help" id="dates-help">As duas datas entram na seleção. A cobertura depende do RSS disponível.</p>
            {error?.field === "dates" && <p className="field-error" id="dates-error" role="alert">{error.message}</p>}
          </div>}
        </fieldset>
        <fieldset><legend>Tamanho da grade</legend><div className="segmented grid-options">
          {([3, 4, 5] as const).map((size) => <label key={size}>
            <input type="radio" name="grid" value={size} checked={grid === size} onChange={() => { invalidate(); setGrid(size); }} />
            <span><GridIcon size={size} /><strong>{size} × {size}</strong><small>até {size * size} filmes</small></span>
          </label>)}
        </div></fieldset>
        <button className="primary generate-button" type="submit" disabled={busy}>
          {busy ? <><span className="loading-dot" aria-hidden="true" /> {status === "rendering" ? "Montando sua imagem…" : "Consultando seu diário…"}</> : <>Gerar minha colagem <span aria-hidden="true">↗</span></>}
        </button>
      </form>
    </div>
    <section className={`preview-panel ${status === "ready" ? "has-result" : ""}`} aria-labelledby="preview-heading" aria-busy={busy}>
      <div className="preview-topline"><h2 id="preview-heading" ref={resultHeading} tabIndex={-1}>Sua colagem</h2><span className="preview-label">{status === "ready" ? "Pronta para guardar" : "Prévia"}</span></div>
      {status === "ready" && collage ? <CollagePreview collage={collage} downloading={downloading} onDownload={download} /> : <div className="preview-empty">
        {status === "idle" && <><div className="empty-grid" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <span key={i} />)}</div><h3>Seu próximo registro de cinema.</h3><p>{changed ? "As opções mudaram. Gere novamente para atualizar a imagem." : "Escolha o período e a grade. Seus filmes aparecem por aqui."}</p><span className="empty-format">PÔSTERES · DIÁRIO · PNG</span></>}
        {busy && <div className="status-message" role="status" aria-live="polite"><span className="status-symbol" aria-hidden="true">◌</span><h3>{status === "rendering" ? "Dando forma aos seus filmes" : "Consultando seu diário"}</h3><p>{status === "rendering" ? "Carregando pôsteres e preparando o PNG no navegador." : "Lendo as datas de visualização e encontrando os pôsteres."}</p></div>}
        {status === "empty" && <div className="status-message" role="status"><span className="status-symbol" aria-hidden="true">○</span><h3>Nenhum registro neste recorte</h3><p>{EMPTY_MESSAGE}</p><p>Você pode alterar o período e tentar novamente.</p></div>}
        {status === "error" && <div className="status-message error-message" role={error?.field === "username" || error?.field === "dates" ? undefined : "alert"}><span className="status-symbol" aria-hidden="true">!</span><h3>Não foi possível gerar</h3><p>{error?.field === "username" ? "Confira o nome de usuário informado no formulário." : error?.field === "dates" ? "Confira as datas informadas no formulário." : error?.message}</p></div>}
      </div>}
    </section>
    <aside className="coverage-note"><span aria-hidden="true" className="info-icon">i</span><div><h3>Um recorte do seu diário</h3><p>{RSS_WARNING}</p><p>Um período maior filtra o mesmo feed; não recupera registros que saíram dele.</p><p>Usamos a data de visualização e sua avaliação no diário, quando disponível, com os pôsteres padrão do TMDB.</p></div></aside>
  </div>;
}

function GridIcon({ size }: { size: Grid }) {
  return <svg width="28" height="28" viewBox="0 0 30 30" fill="currentColor" aria-hidden="true">{Array.from({ length: size * size }, (_, i) => {
    const pitch = 28 / size;
    return <rect key={i} x={1 + i % size * pitch} y={1 + Math.floor(i / size) * pitch} width={pitch - 2} height={pitch - 2} rx="0.5" />;
  })}</svg>;
}
