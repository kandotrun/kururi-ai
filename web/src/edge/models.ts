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
const BINARY = "application/octet-stream";
const JSON_TYPE = "application/json; charset=utf-8";
const MARKDOWN = "text/markdown; charset=utf-8";
const PLAIN_TEXT = "text/plain; charset=utf-8";
const WEIGHTS_CACHE = "public, max-age=31536000, immutable";
const DOCUMENT_CACHE = "public, max-age=86400";
const APACHE_LICENSE = "licenses/Apache-2.0.txt";

export interface PublishedFile {
  readonly source: string;
  readonly parts: readonly string[];
  readonly contentType: string;
  readonly cacheControl: string;
}

function weights(name: string, contentType = BINARY): [string, PublishedFile] {
  const key = `${RELEASE}/${name}`;
  return [
    key,
    { source: name, parts: [key], contentType, cacheControl: WEIGHTS_CACHE },
  ];
}

function split(name: string, parts: number): [string, PublishedFile] {
  const key = `${RELEASE}/${name}`;
  return [
    key,
    {
      source: name,
      parts: Array.from({ length: parts }, (_, index) => `${key}.part${index}`),
      contentType: BINARY,
      cacheControl: WEIGHTS_CACHE,
    },
  ];
}

function documentFile(
  name: string,
  contentType: string,
  stored = name,
): [string, PublishedFile] {
  return [
    `${RELEASE}/${name}`,
    {
      source: stored,
      parts: [`${RELEASE}/${stored}`],
      contentType,
      cacheControl: DOCUMENT_CACHE,
    },
  ];
}

function upstreamCards(model: string): [string, PublishedFile][] {
  return [
    documentFile(`upstream/${model}/README.md`, MARKDOWN),
    documentFile(`upstream/${model}/config.json`, JSON_TYPE),
    documentFile(`upstream/${model}/provenance.json`, JSON_TYPE),
  ];
}

export const PUBLISHED: ReadonlyMap<string, PublishedFile> = new Map([
  weights("ensemble.json", JSON_TYPE),
  weights("convnext-base-224.onnx"),
  split("convnext-base-224.onnx.data", 2),
  weights("convnext-small-288.onnx"),
  weights("convnext-small-288.onnx.data"),
  weights("convnext-small-224.onnx"),
  weights("convnext-small-224.onnx.data"),
  documentFile("LICENSE", PLAIN_TEXT, APACHE_LICENSE),
  documentFile(APACHE_LICENSE, PLAIN_TEXT),
  documentFile("THIRD_PARTY_NOTICES.md", MARKDOWN),
  documentFile("MODEL_CARD.md", MARKDOWN),
  ...upstreamCards("convnext-base"),
  ...upstreamCards("convnext-small"),
]);

export function publishedFile(name: string): PublishedFile | undefined {
  return PUBLISHED.get(`${RELEASE}/${name}`);
}

function headersFor(file: PublishedFile, size: number, etag: string): Headers {
  return new Headers({
    "content-type": file.contentType,
    "content-length": String(size),
    etag,
    "cache-control": file.cacheControl,
    "x-content-type-options": "nosniff",
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
  const file = PUBLISHED.get(key);
  if (!file) {
    return notFound();
  }
  const { parts } = file;
  const ifNoneMatch = request.headers.get("if-none-match");
  if (request.method === "HEAD" || ifNoneMatch !== null || parts.length > 1) {
    const info = await describe(bucket, parts);
    if (!info) {
      return notFound();
    }
    const headers = headersFor(file, info.size, info.etag);
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
    headers: headersFor(file, object.size, object.httpEtag),
  });
}
