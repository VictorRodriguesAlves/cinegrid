import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import type { CollageResponse, Grid } from "../../src/types/collage";
import { RSS_WARNING } from "../../src/lib/constants";

function fixture(username: string, grid: Grid, start: string, end: string): CollageResponse {
  return {
    username, grid, start, end, entriesInPeriod: 4, uniqueFilmsInPeriod: 3, displayedCount: 3,
    warnings: [{ code: "RSS_LIMITED", message: RSS_WARNING }, { code: "POSTERS_PARTIAL", message: "Alguns pôsteres estão indisponíveis." }],
    movies: [
      { key: "fixture:1", title: "Filme de teste com pôster", year: 2020, watchedDate: end, rating: 3.5, tmdbId: 1, entryUrl: null, poster: { kind: "image", url: "/api/poster?poster_path=%2Ffixture.png" } },
      { key: "fixture:2", title: "Filme de teste sem pôster", year: null, watchedDate: end, rating: 5, tmdbId: null, entryUrl: null, poster: { kind: "placeholder", reason: "not_found" } },
      { key: "fixture:3", title: "Filme de teste com falha de imagem", year: 2021, watchedDate: start, rating: null, tmdbId: 3, entryUrl: null, poster: { kind: "image", url: "/api/poster?poster_path=%2Fbroken.jpg" } },
    ],
  };
}

async function prepare(page: Page) {
  await page.clock.setFixedTime(new Date("2026-09-12T15:00:00-03:00"));
  await page.goto("/");
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 500; canvas.height = 750;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#4260b6"; ctx.fillRect(0, 0, 500, 750);
    ctx.fillStyle = "#dbc06a"; ctx.fillRect(0, 0, 500, 150);
    ctx.font = "40px sans-serif"; ctx.fillStyle = "white"; ctx.fillText("TESTE", 60, 400);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.route("**/api/poster?*", (route) => route.request().url().includes("broken")
    ? route.fulfill({ status: 502, json: { error: { code: "POSTER_UNAVAILABLE", message: "Fixture" } } })
    : route.fulfill({ contentType: "image/png", body: Buffer.from(bytes) }));
}

async function mockCollage(page: Page) {
  await page.route("**/api/collage?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    await route.fulfill({ json: fixture(params.get("username")!, Number(params.get("grid")) as Grid, params.get("start")!, params.get("end")!) });
  });
}

for (const grid of [3, 4, 5] as const) {
  for (const width of [390, 1280]) {
    test(`real PNG rendering, grid ${grid}, viewport ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await prepare(page); await mockCollage(page);
      await page.getByLabel("Seu usuário no Letterboxd").fill("https://letterboxd.com/TESTE/");
      await page.getByText(`${grid} × ${grid}`, { exact: true }).click();
      await page.getByRole("button", { name: "Gerar minha colagem" }).click();
      const downloadButton = page.getByRole("button", { name: "Baixar PNG" });
      await expect(downloadButton).toBeEnabled();
      await expect(page.getByText("3 filmes únicos encontrados")).toBeVisible();
      await expect(page.getByText("1 pôster falhou no carregamento.", { exact: false })).toBeVisible();
      await expect(page.getByText(RSS_WARNING)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const downloadEvent = page.waitForEvent("download");
      await downloadButton.click();
      const download = await downloadEvent;
      expect(download.suggestedFilename()).toBe("cinegrid-teste-2026-09-06-2026-09-12.png");
      const path = testInfo.outputPath("collage.png"); await download.saveAs(path);
      const png = await readFile(path);
      expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(png.readUInt32BE(16)).toBe(1080);
      expect(png.readUInt32BE(20)).toBe({ 3: 1676, 4: 1672, 5: 1668 }[grid]);
      const differentPixels = await page.evaluate(async (bytes) => {
        const preview = document.querySelector("canvas")!;
        const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
        const decoded = document.createElement("canvas"); decoded.width = image.width; decoded.height = image.height;
        const context = decoded.getContext("2d")!; context.drawImage(image, 0, 0); image.close();
        const a = context.getImageData(0, 0, decoded.width, decoded.height).data;
        const b = preview.getContext("2d")!.getImageData(0, 0, preview.width, preview.height).data;
        let different = 0;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) different++;
        return different;
      }, [...png]);
      expect(differentPixels).toBe(0);
      // The fixture posters contain no accent green. Rated cells must have
      // actual star pixels; unrated and empty cells must not gain a rating.
      const ratingPixels = await page.evaluate((size) => {
        const canvas = document.querySelector("canvas")!;
        const cellWidth = (1080 - 48 - 8 * (size - 1)) / size;
        const cellHeight = cellWidth * 1.5;
        const counts = [0, 1, 2, 3].map((index) => {
          const x = Math.ceil(24 + index % size * (cellWidth + 8));
          const y = Math.ceil(112 + Math.floor(index / size) * (cellHeight + 8) + cellHeight - 62);
          const pixels = canvas.getContext("2d")!.getImageData(x, y, Math.floor(cellWidth), 55).data;
          let count = 0;
          for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 178 && pixels[i + 1] === 239 && pixels[i + 2] === 128) count++;
          return count;
        });
        // Just below the stars, the poster remains blue, with no dark backing.
        const background = [...canvas.getContext("2d")!.getImageData(Math.floor(24 + cellWidth / 2), Math.floor(112 + cellHeight - 12), 1, 1).data];
        return { counts, background };
      }, grid);
      expect(ratingPixels.counts[0]).toBeGreaterThan(10);
      expect(ratingPixels.counts[1]).toBeGreaterThan(10);
      expect(ratingPixels.counts.slice(2)).toEqual([0, 0]);
      expect(ratingPixels.background).toEqual([66, 96, 182, 255]);
      await page.getByText("Filmes na colagem", { exact: false }).click();
      await expect(page.getByText("Filme de teste sem pôster", { exact: true })).toBeVisible();
      await expect(page.getByText("Avaliação no Letterboxd: 3,5 de 5 estrelas", { exact: true })).toBeVisible();
      await expect(page.getByText("Avaliação no Letterboxd: 5 de 5 estrelas", { exact: true })).toBeVisible();
      await expect(page.getByText("Avaliação não informada no RSS", { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("result.png"), fullPage: true });
      await page.getByText("Últimos 30 dias", { exact: true }).click();
      await expect(page.getByRole("button", { name: "Baixar PNG" })).toHaveCount(0);
      await expect(page.locator("canvas")).toHaveCount(0);
      await expect(page.getByText("As opções mudaram.", { exact: false })).toBeVisible();
    });
  }
}

test("short profile link preserves its code and downloads using the resolved username", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/collage?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get("username")).toBe("https://boxd.it/4WZNB");
    await route.fulfill({ json: fixture("apontadorroxo", 3, params.get("start")!, params.get("end")!) });
  });
  const input = page.getByLabel("Seu usuário no Letterboxd");
  await input.fill("https://boxd.it/4WZNB");
  await page.getByRole("button", { name: "Gerar minha colagem" }).click();
  await expect(page.getByRole("heading", { name: "@apontadorroxo" })).toBeVisible();
  const button = page.getByRole("button", { name: "Baixar PNG" });
  await expect(button).toBeEnabled();
  const event = page.waitForEvent("download"); await button.click();
  expect((await event).suggestedFilename()).toBe("cinegrid-apontadorroxo-2026-09-06-2026-09-12.png");
  await input.fill("https://boxd.it/outro");
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(button).toHaveCount(0);
});

for (const start of ["2026-06-15", "2026-03-17", "2025-01-01"]) {
  test(`custom period starting ${start}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await prepare(page); await mockCollage(page);
    await page.getByLabel("Seu usuário no Letterboxd").fill("teste");
    await page.getByText("Personalizado", { exact: true }).click();
    await expect(page.getByLabel("Data inicial")).toHaveValue("2026-08-14");
    await expect(page.getByLabel("Data final")).toHaveValue("2026-09-12");
    await page.getByLabel("Data inicial").fill(start);
    await page.getByLabel("Data final").fill("2026-09-12");
    const request = page.waitForRequest("**/api/collage?*");
    await page.getByRole("button", { name: "Gerar minha colagem" }).click();
    const params = new URL((await request).url()).searchParams;
    expect(params.get("start")).toBe(start);
    expect(params.get("end")).toBe("2026-09-12");
    const button = page.getByRole("button", { name: "Baixar PNG" });
    await expect(button).toBeEnabled();
    const event = page.waitForEvent("download"); await button.click();
    expect((await event).suggestedFilename()).toBe(`cinegrid-teste-${start}-2026-09-12.png`);
    await expect(page.getByText("Um período maior filtra o mesmo feed; não recupera registros que saíram dele.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByLabel("Data final").fill("2026-09-11");
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(button).toHaveCount(0);
  });
}

test("custom date errors stay near the fields and prevent network requests", async ({ page }) => {
  await prepare(page); await mockCollage(page);
  let queries = 0;
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/collage") queries++; });
  await page.getByLabel("Seu usuário no Letterboxd").fill("teste");
  await page.getByText("Personalizado", { exact: true }).click();
  for (const [start, end, message] of [
    ["", "2026-09-12", "Preencha uma data inicial"],
    ["2026-09-12", "2026-09-11", "A data inicial deve ser anterior"],
    ["2026-09-01", "", "Preencha uma data inicial"],
  ]) {
    await page.getByLabel("Data inicial").fill(start!);
    await page.getByLabel("Data final").fill(end!);
    await page.getByRole("button", { name: "Gerar minha colagem" }).click();
    await expect(page.locator("#dates-error")).toContainText(message!);
    await expect(page.getByLabel("Data inicial")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("button", { name: "Baixar PNG" })).toHaveCount(0);
  }
  expect(queries).toBe(0);
  await page.getByText("Últimos 30 dias", { exact: true }).click();
  await expect(page.locator("#dates-error")).toHaveCount(0);
  await expect(page.getByLabel("Data inicial")).toHaveCount(0);
  await page.getByRole("button", { name: "Gerar minha colagem" }).click();
  await expect(page.getByRole("button", { name: "Baixar PNG" })).toBeEnabled();
  expect(queries).toBe(1);
});

test("empty RSS and integration failures have different accessible messages", async ({ page }) => {
  await prepare(page);
  await page.route("**/api/collage?*", (route) => route.fulfill({ json: { ...fixture("teste", 3, "2026-09-06", "2026-09-12"), movies: [], entriesInPeriod: 0, uniqueFilmsInPeriod: 0, displayedCount: 0 } }));
  await page.getByLabel("Seu usuário no Letterboxd").fill("teste");
  await page.getByRole("button", { name: "Gerar minha colagem" }).click();
  await expect(page.getByText("Nenhum filme com data de visualização foi encontrado no RSS para este período.")).toBeVisible();
  await page.unroute("**/api/collage?*");
  await page.route("**/api/collage?*", (route) => route.fulfill({ status: 502, json: { error: { code: "RSS_BLOCKED", message: "O Letterboxd bloqueou a consulta ao RSS." } } }));
  await page.getByRole("button", { name: "Gerar minha colagem" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "bloqueou a consulta" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Baixar PNG" })).toHaveCount(0);
});

test("obsolete requests and duplicate submissions cannot replace the current result", async ({ page }) => {
  await prepare(page);
  let release!: () => void;
  const oldRequest = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  await page.route("**/api/collage?*", async (route) => {
    calls++;
    const params = new URL(route.request().url()).searchParams;
    if (params.get("username") === "antigo") await oldRequest;
    await route.fulfill({ json: fixture(params.get("username")!, 3, params.get("start")!, params.get("end")!) }).catch(() => {});
  });
  const input = page.getByLabel("Seu usuário no Letterboxd");
  await input.fill("antigo");
  const started = page.waitForRequest("**/api/collage?*");
  await page.getByRole("button", { name: "Gerar minha colagem" }).click(); await started;
  await expect(page.getByRole("button", { name: "Consultando seu diário…" })).toBeDisabled();
  await input.press("Enter"); expect(calls).toBe(1);
  await input.fill("atual");
  await page.getByRole("button", { name: "Gerar minha colagem" }).click();
  await expect(page.getByRole("heading", { name: "@atual" })).toBeVisible();
  release();
  await expect(page.getByRole("heading", { name: "@antigo" })).toHaveCount(0);
  const event = page.waitForEvent("download"); await page.getByRole("button", { name: "Baixar PNG" }).click();
  expect((await event).suggestedFilename()).toContain("cinegrid-atual-");
});

test("local last-30-days dates, keyboard controls and field errors", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await prepare(page); await mockCollage(page);
  await page.getByRole("button", { name: "Gerar minha colagem" }).click();
  await expect(page.locator("#username-error")).toBeVisible();
  const input = page.getByLabel("Seu usuário no Letterboxd");
  await input.fill("teste");
  await input.press("Tab"); await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Últimos 30 dias" })).toBeChecked();
  const request = page.waitForRequest("**/api/collage?*");
  await page.getByRole("button", { name: "Gerar minha colagem" }).click();
  expect(new URL((await request).url()).searchParams.get("start")).toBe("2026-08-14");
  await expect(page.getByRole("button", { name: "Baixar PNG" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mobile-320.png"), fullPage: true });
});
