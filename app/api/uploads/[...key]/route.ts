import { env } from "cloudflare:workers";

type RuntimeEnv = { UPLOADS?: R2Bucket };

export async function GET(_request: Request, context: { params: Promise<{ key: string[] }> }) {
  const bucket = (env as RuntimeEnv).UPLOADS;
  if (!bucket) return new Response("Storage unavailable", { status: 503 });
  const { key } = await context.params;
  const object = await bucket.get(key.map(decodeURIComponent).join("/"));
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
