// Missing/zero/invalid ratings are not a zero-star review.
export function parseRating(value: string | null): number | null {
  if (!value || !/^[0-5](?:\.[05])?$/.test(value)) return null;
  const rating = Number(value);
  return rating >= 0.5 && rating <= 5 ? rating : null;
}

export function ratingStars(rating: number): string {
  return "★".repeat(Math.floor(rating)) + (Number.isInteger(rating) ? "" : "½");
}

export function ratingLabel(rating: number): string {
  return `Avaliação no Letterboxd: ${String(rating).replace(".", ",")} de 5 estrelas`;
}
