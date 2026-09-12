import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeUsername, normalizeProfileInput, parseCollageRequest, validateDateRange, validEntryUrl, validPosterPath } from "@/lib/validation";
import { getDateRange, isCalendarDate, isValidRange } from "@/lib/dates";
import { parseRss } from "@/lib/server/letterboxd";
import { selectMovies } from "@/lib/select-movies";
import { collageLayout } from "@/lib/render-collage";
import { matchSearchResult } from "@/lib/server/tmdb";
import { parseRating, ratingLabel, ratingStars } from "@/lib/ratings";
import type { DiaryEntry, Grid } from "@/types/collage";
import tmdbFixture from "./fixtures/tmdb-search.json";

const real = readFileSync(new URL("./fixtures/letterboxd-real.xml", import.meta.url), "utf8");
const mixed = readFileSync(new URL("./fixtures/mixed.xml", import.meta.url), "utf8");
const entry = (patch: Partial<DiaryEntry> = {}): DiaryEntry => ({ entryId: "a", sourceIndex: 0, title: "Film", year: 2020, tmdbId: 1, watchedDate: "2026-09-08", rating: null, entryUrl: null, ...patch });

describe("input boundaries", () => {
  it.each(["dave", " Dave_1 ", "https://letterboxd.com/Dave/", "https://letterboxd.com/dave"])("normalizes %s", (value) => expect(normalizeUsername(value)).toBe(value.includes("_") ? "dave_1" : "dave"));
  it.each(["", "@dave", "../dave", "https://letterboxd.com.evil.test/dave/", "https://evil-letterboxd.com/dave/", "https://letterboxd.com@evil.test/dave/", "https://user:pass@letterboxd.com/dave/", "https://letterboxd.com:443/dave/", "http://letterboxd.com/dave/", "https://letterboxd.com/a/../dave/", "https://letterboxd.com/%64ave/", "https://letterboxd.com/dave/films/", "https://letterboxd.com/dave/?x=1", "https://letterboxd.com/dave/#x", "https://letterboxd.com\\@evil.test/dave/", "a".repeat(41)])("rejects %s", (value) => expect(() => normalizeUsername(value)).toThrow());
  it("validates grid, ranges and repeated parameters", () => {
    const valid = "username=dave&start=2026-09-01&end=2026-09-12&grid=3";
    expect(parseCollageRequest(new URLSearchParams(valid)).grid).toBe(3);
    for (const value of [valid + "&grid=4", valid + "&url=evil", valid.replace("grid=3", "grid=9"), valid.replace("09-01", "02-30")]) expect(() => parseCollageRequest(new URLSearchParams(value))).toThrow();
  });
  it("accepts the official short-link format without lowercasing its code", () => {
    expect(normalizeProfileInput(" HTTPS://BOXD.IT/4WZNB/ ")).toBe("https://boxd.it/4WZNB");
    expect(normalizeProfileInput("https://boxd.it/4wznb")).toBe("https://boxd.it/4wznb");
    expect(normalizeProfileInput("https://letterboxd.com/DAVE/")).toBe("dave");
    expect(parseCollageRequest(new URLSearchParams({ username: "https://boxd.it/4WZNB", start: "2026-09-01", end: "2026-09-12", grid: "3" })).username).toBe("https://boxd.it/4WZNB");
  });
  it.each([
    "https://boxd.it.evil.test/4WZNB", "https://evil-boxd.it/4WZNB", "https://boxd.it@evil.test/4WZNB",
    "https://user:pass@boxd.it/4WZNB", "https://boxd.it:443/4WZNB", "http://boxd.it/4WZNB",
    "https://boxd.it/a/../4WZNB", "https://boxd.it/%34WZNB", "https://boxd.it/4WZNB?next=x",
    "https://boxd.it/4WZNB#x", "https://boxd.it/", `https://boxd.it/${"a".repeat(33)}`,
    "https://boxd.it/4WZNB/film/test", "https://boxd.it\\@evil.test/4WZNB",
  ])("rejects unsafe short link %s", (value) => expect(() => normalizeProfileInput(value)).toThrow());
  it.each(["/abc.jpg", "/abc123.png", "/ABC.webp", "/abc.jpeg"])("accepts raster path %s", (path) => expect(validPosterPath(path)).toBe(true));
  it.each(["https://image.tmdb.org/a.jpg", "//evil.test/a.jpg", "/../a.jpg", "/a/b.jpg", "/a.jpg?x=1", "/a.svg", "/%2e%2e/a.jpg", "/a%252ejpg", "/a.jpg#x", "/a\\b.jpg", "/a.jpg\n"])("rejects poster path %s", (path) => expect(validPosterPath(path)).toBe(false));
  it("validates entry links independently", () => {
    expect(validEntryUrl("https://letterboxd.com/dave/film/test/2/", "dave")).not.toBeNull();
    expect(validEntryUrl("https://letterboxd.com/other/film/test/", "dave")).toBeNull();
    expect(validEntryUrl("javascript:alert(1)", "dave")).toBeNull();
  });
});

describe("calendar dates", () => {
  it.each([[2026, 0, 3, "2025-12-28"], [2026, 2, 2, "2026-02-24"], [2024, 2, 1, "2024-02-24"]])("uses six preceding local days", (year, month, day, start) => {
    expect(getDateRange("week", new Date(Number(year), Number(month), Number(day), 0, 5)).start).toBe(start);
  });
  it("uses today and the 29 previous days across month, year and leap-day boundaries", () => {
    expect(getDateRange("30days", new Date(2026, 8, 12, 23, 59))).toEqual({ start: "2026-08-14", end: "2026-09-12" });
    expect(getDateRange("30days", new Date(2026, 0, 3)).start).toBe("2025-12-05");
    expect(getDateRange("30days", new Date(2024, 2, 1)).start).toBe("2024-02-01");
    expect(getDateRange("30days", new Date(2026, 2, 1)).start).toBe("2026-01-31");
  });
  it("accepts custom periods across year and leap-day boundaries", () => {
    expect(isValidRange("2025-10-06", "2026-01-03")).toBe(true);
    expect(isValidRange("2023-12-03", "2024-03-01")).toBe(true);
    expect(() => validateDateRange("2026-06-15", "2026-09-12")).not.toThrow();
  });
  it("reports missing, impossible and reversed custom dates at the date fields", () => {
    for (const [start, end] of [["", "2026-09-12"], ["2026-09-01", ""], ["2026-02-30", "2026-03-01"], ["2026-09-12", "2026-09-11"]]) {
      expect(() => validateDateRange(start!, end!)).toThrow(expect.objectContaining({ code: "INVALID_DATES", field: "dates" }));
    }
  });
  it("checks leap years and accepts valid ranges without an arbitrary duration limit", () => {
    expect(isCalendarDate("2024-02-29")).toBe(true);
    for (const value of ["2026-02-29", "1900-02-29", "2026-04-31", "2026-9-01", "2026-09-01T00:00:00Z", "2026-09-01\n", "0000-01-01"]) expect(isCalendarDate(value)).toBe(false);
    expect(isValidRange("2026-08-13", "2026-09-12")).toBe(true);
    expect(isValidRange("2026-08-12", "2026-09-12")).toBe(true);
    expect(isValidRange("2026-03-17", "2026-09-12")).toBe(true);
    expect(isValidRange("2026-03-16", "2026-09-12")).toBe(true);
    expect(isValidRange("2025-01-01", "2026-09-12")).toBe(true);
    expect(isValidRange("0001-01-01", "9999-12-31")).toBe(true);
    expect(isValidRange("2026-09-12", "2026-09-11")).toBe(false);
    expect(isValidRange("0001-01-01", "0001-01-01")).toBe(true);
  });
});

describe("RSS and selection", () => {
  it("parses real observed namespaces and identifiers", () => {
    const entries = parseRss(real, "dave");
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ title: "Blue Heron", year: 2025, tmdbId: 1184941, watchedDate: "2026-09-08", rating: 4, entryId: "letterboxd-watch-1488031621" });
    expect(entries.map((movie) => movie.rating)).toEqual([4, 3, 4.5]);
    expect(selectMovies(entries, "2026-09-09", "2026-09-09", 3).movies).toHaveLength(0);
  });
  it("handles namespace aliases, CDATA, entities and filters non-diary items", () => {
    const entries = parseRss(mixed, "test");
    expect(entries).toHaveLength(2);
    expect(entries[0]?.title).toBe("Café & Cinema");
    expect(entries[0]?.rating).toBe(0.5);
    expect(entries[1]).toMatchObject({ title: "Safe title & other", entryUrl: null, year: null, tmdbId: null, rating: null });
    expect(selectMovies(entries, "2026-09-11", "2026-09-11", 3).movies).toHaveLength(0);
  });
  it("distinguishes a valid empty RSS from invalid XML or HTML", () => {
    expect(parseRss("<rss><channel><title>Empty</title></channel></rss>", "dave")).toEqual([]);
    expect(parseRss("<rss><channel/></rss>", "dave")).toEqual([]);
    for (const xml of ["", "<rss><channel></rss>", "<html><body>Blocked</body></html>", '<!DOCTYPE rss [<!ENTITY leak SYSTEM "file:///etc/passwd">]><rss><channel/></rss>']) expect(() => parseRss(xml, "dave")).toThrow();
  });
  it("decodes decimal and hexadecimal character references in film titles", () => {
    const encoded = mixed.replace("<![CDATA[Café & Cinema]]>", "Caf&#233; &amp; Cin&#xE9;ma");
    expect(parseRss(encoded, "test")[0]?.title).toBe("Café & Cinéma");
  });
  it("keeps the latest in-period rewatch, stable ties and conservative identities", () => {
    const entries = [entry({ entryId: "z", watchedDate: "2026-09-07" }), entry({ entryId: "b", watchedDate: "2026-09-08" }), entry({ entryId: "a", title: "Other", tmdbId: 2 }), entry({ watchedDate: "2026-09-12" })];
    const result = selectMovies(entries, "2026-09-01", "2026-09-10", 3);
    expect(result.entriesInPeriod).toBe(3);
    expect(result.uniqueFilmsInPeriod).toBe(2);
    expect(result.movies.map((movie) => movie.tmdbId)).toEqual([2, 1]);
    expect(result.movies[1]?.watchedDate).toBe("2026-09-08");
    expect(selectMovies([entry({ tmdbId: null, title: "  FILM  " }), entry({ watchedDate: "2026-09-07" })], "2026-09-01", "2026-09-12", 3).uniqueFilmsInPeriod).toBe(1);
    expect(selectMovies([entry({ tmdbId: null }), entry({ tmdbId: null, year: 2021 })], "2026-09-01", "2026-09-12", 3).uniqueFilmsInPeriod).toBe(2);
  });
  it("keeps the latest entry's rating even if it is absent, without using an older review", () => {
    const entries = [entry({ watchedDate: "2026-08-01", rating: 5 }), entry({ watchedDate: "2026-09-08", rating: 3.5 }), entry({ watchedDate: "2026-09-12", rating: 1 })];
    expect(selectMovies(entries, "2026-06-15", "2026-09-10", 3).movies[0]?.rating).toBe(3.5);
    entries[1] = entry({ watchedDate: "2026-09-08", rating: null });
    expect(selectMovies(entries, "2026-06-15", "2026-09-10", 3).movies[0]?.rating).toBeNull();
  });
  it("ignores an invalid rating or the same field in an unrelated namespace", () => {
    expect(parseRss(mixed.replace("<l:memberRating>0.5", "<l:memberRating>4.25"), "test")[0]?.rating).toBeNull();
    expect(parseRss(mixed.replaceAll("l:memberRating", "t:memberRating"), "test")[0]?.rating).toBeNull();
  });
  it.each([3, 4, 5] as Grid[])("limits a %s grid without duplicating sparse selections", (grid) => {
    const entries = Array.from({ length: 30 }, (_, index) => entry({ tmdbId: index + 1, entryId: String(index).padStart(2, "0") }));
    const result = selectMovies(entries, "2026-09-01", "2026-09-12", grid);
    expect(result.displayedCount).toBe(grid * grid);
    expect(result.uniqueFilmsInPeriod).toBe(30);
    expect(selectMovies(entries.slice(0, 2), "2026-09-01", "2026-09-12", grid).movies).toHaveLength(2);
    const layout = collageLayout(grid);
    expect(layout.width).toBe(1080);
    expect(layout.cellHeight / layout.cellWidth).toBe(1.5);
    expect(layout.height).toBe({ 3: 1676, 4: 1672, 5: 1668 }[grid]);
  });
});

describe("member ratings", () => {
  it("preserves each supported half-star value", () => {
    for (let rating = 0.5; rating <= 5; rating += 0.5) expect(parseRating(rating.toFixed(1))).toBe(rating);
    expect(parseRating("4")).toBe(4);
  });
  it.each([null, "", "0", "0.0", "-1", "5.5", "6", "NaN", "4.25", "4,5", "1e0"])("does not invent a rating from %s", (value) => expect(parseRating(value)).toBeNull());
  it("formats full and half stars with a readable numerical label", () => {
    expect(ratingStars(0.5)).toBe("½");
    expect(ratingStars(3.5)).toBe("★★★½");
    expect(ratingStars(5)).toBe("★★★★★");
    expect(ratingLabel(3.5)).toBe("Avaliação no Letterboxd: 3,5 de 5 estrelas");
  });
});

describe("conservative TMDB matching", () => {
  it("compares original title and year instead of selecting the first result", () => {
    expect(matchSearchResult(tmdbFixture, "A Film", 2021).tmdbId).toBe(101);
    expect(matchSearchResult(tmdbFixture, "um filme", 2020).tmdbId).toBe(100);
  });
  it("uses placeholders for ambiguity, unknown matches and missing posters", () => {
    expect(matchSearchResult(tmdbFixture, "A Film", null).reason).toBe("ambiguous");
    expect(matchSearchResult({ ...tmdbFixture, total_pages: 2 }, "A Film", 2020).reason).toBe("ambiguous");
    expect(matchSearchResult(tmdbFixture, "No match", 2020).reason).toBe("not_found");
    const noPoster = { ...tmdbFixture, results: [{ ...tmdbFixture.results[0], poster_path: null }] };
    expect(matchSearchResult(noPoster, "A Film", 2020)).toMatchObject({ tmdbId: 100, posterPath: null, reason: "no_poster" });
  });
});
