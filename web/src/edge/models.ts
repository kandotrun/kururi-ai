export interface ModelObjectHead {
  size: number;
  httpEtag: string;
}

export interface ModelObject extends ModelObjectHead {
  body: ReadableStream;
}

export interface ModelBucket {
  get(key: string): Promise<ModelObject | null>;
  head(key: string): Promise<ModelObjectHead | null>;
}

interface FixedLengthStreamConstructor {
  new (length: number): TransformStream<Uint8Array, Uint8Array>;
}

export const MODEL_ROUTE = "/models/";
export const PART_BYTES = 200 * 1024 * 1024;

const RELEASE = "v2.0.0";

function single(name: string): [string, readonly string[]] {
  const key = `${RELEASE}/${name}`;
  return [key, [key]];
}

function split(name: string, parts: number): [string, readonly string[]] {
  const key = `${RELEASE}/${name}`;
  return [key, Array.from({ length: parts }, (_, index) => `${key}.part${index}`)];
}

export const PUBLISHED: ReadonlyMap<string, readonly string[]> = new Map([
  single("ensemble.json"),
  single("convnext-base-224.onnx"),
  split("convnext-base-224.onnx.data", 2),
  single("convnext-small-288.onnx"),
  single("convnext-small-288.onnx.data"),
  single("convnext-small-224.onnx"),
  single("convnext-small-224.onnx.data"),
]);

const CACHE_CONTROL = "public, max-age=31536000, immutable";

function headersFor(key: string, size: number, etag: string): Headers {
  return new Headers({
    "content-type": key.endsWith(".json")
      ? "application/json; charset=utf-8"
      : "application/octet-stream",
    "content-length": String(size),
    etag,
    "cache-control": CACHE_CONTROL,
  });
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

function lengthStream(length: number): TransformStream<Uint8Array, Uint8Array> {
  const fixed = (globalThis as { FixedLengthStream?: FixedLengthStreamConstructor })
    .FixedLengthStream;
  return fixed ? new fixed(length) : new TransformStream<Uint8Array, Uint8Array>();
}

async function describe(
  bucket: ModelBucket,
  parts: readonly string[],
): Promise<{ size: number; etag: string } | null> {
  const heads = await Promise.all(parts.map((part) => bucket.head(part)));
  let size = 0;
  const tags: string[] = [];
  for (const head of heads) {
    if (!head) {
      return null;
    }
    size += head.size;
    tags.push(head.httpEtag.replace(/^"|"$/g, ""));
  }
  return { size, etag: `"${tags.join("+")}"` };
}

function joinParts(
  bucket: ModelBucket,
  parts: readonly string[],
  size: number,
): ReadableStream<Uint8Array> {
  const { readable, writable } = lengthStream(size);
  void (async () => {
    try {
      for (const part of parts) {
        const object = await bucket.get(part);
        if (!object) {
          throw new Error(`Missing part ${part}`);
        }
        await object.body.pipeTo(writable, { preventClose: true });
      }
      await writable.close();
    } catch (error) {
      await writable.abort(error).catch(() => {});
    }
  })();
  return readable;
}

export async function serveModel(
  request: Request,
  bucket: ModelBucket,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }
  const { pathname } = new URL(request.url);
  const key = pathname.startsWith(MODEL_ROUTE)
    ? pathname.slice(MODEL_ROUTE.length)
    : "";
  const parts = PUBLISHED.get(key);
  if (!parts) {
    return notFound();
  }
  const ifNoneMatch = request.headers.get("if-none-match");
  if (request.method === "HEAD" || ifNoneMatch !== null || parts.length > 1) {
    const info = await describe(bucket, parts);
    if (!info) {
      return notFound();
    }
    const headers = headersFor(key, info.size, info.etag);
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    if (ifNoneMatch === info.etag) {
      return new Response(null, { status: 304, headers });
    }
    if (parts.length > 1) {
      return new Response(joinParts(bucket, parts, info.size), {
        status: 200,
        headers,
      });
    }
  }
  const object = await bucket.get(parts[0]!);
  if (!object) {
    return notFound();
  }
  return new Response(object.body, {
    status: 200,
    headers: headersFor(key, object.size, object.httpEtag),
  });
}
