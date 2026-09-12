import { LIMITS } from "@/lib/constants";
import { InputError, validateQueryKeys, validPosterPath } from "@/lib/validation";
import { errorResponse } from "@/lib/server/errors";
import { fetchPoster } from "@/lib/server/poster";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    validateQueryKeys(params, ["poster_path"]);
    const path = params.get("poster_path");
    if (!validPosterPath(path)) throw new InputError("INVALID_POSTER_PATH", "Caminho de pôster inválido.");
    const { bytes, contentType } = await fetchPoster(path, request.signal);
    return new Response(Buffer.from(bytes), { headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": `public, max-age=${LIMITS.posterCacheSeconds}, s-maxage=${LIMITS.posterCacheSeconds}`,
    } });
  } catch (error) { return errorResponse(error); }
}
