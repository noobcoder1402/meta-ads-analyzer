import { NextRequest } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

// Ad creatives are saved under data/ad-creatives/ outside public/, so Next can't
// serve them directly. This route reads one file, validates the name is safe,
// and streams it back. Filenames are <uuid>-<index>.<ext> from the scraper, so
// we only allow that shape — anything with slashes / dots / weird chars 404s.

export const runtime = "nodejs";

const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;
const ALLOWED_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ filename: string }> }
) {
  const { filename } = await ctx.params;

  if (!SAFE_FILENAME.test(filename) || filename.includes("..")) {
    return new Response("Not found", { status: 404 });
  }

  const ext = path.extname(filename).toLowerCase();
  const contentType = ALLOWED_EXT[ext];
  if (!contentType) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = path.join(process.cwd(), "data", "ad-creatives", filename);

  try {
    await stat(filePath);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const buf = await readFile(filePath);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": contentType,
      // Filenames are UUID-keyed and immutable per ad — safe to cache hard.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
