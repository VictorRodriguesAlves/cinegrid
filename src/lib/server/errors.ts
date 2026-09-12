import "server-only";
import type { ApiErrorBody, ErrorCode } from "@/types/collage";
import { InputError } from "@/lib/validation";

export class AppError extends Error {
  constructor(public code: ErrorCode, public status: number, message: string, public retryAfter?: number) {
    super(message);
    this.name = "AppError";
  }
}

export function errorResponse(error: unknown): Response {
  const body: ApiErrorBody = { error: { code: "INTERNAL_ERROR", message: "Não foi possível concluir a solicitação. Tente novamente." } };
  let status = 500;
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (error instanceof InputError) {
    status = 400;
    body.error = { code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}) };
  } else if (error instanceof AppError) {
    status = error.status;
    body.error = { code: error.code, message: error.message };
    if (error.retryAfter) headers["Retry-After"] = String(error.retryAfter);
  }
  if (status >= 500) console.error("[cinegrid]", JSON.stringify({ category: body.error.code, status }));
  return Response.json(body, { status, headers });
}
