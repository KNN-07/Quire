import ky from "ky";
import { createPublicKey, verify } from "node:crypto";
import { Envelope, Feed, Package, UpdateError, digest } from "./model";
import type { SignedRelease, ReleasePackage, UpdateConfig } from "./model";

function allowedUrl(raw: string, config: UpdateConfig): URL {
  const url = new URL(raw);
  const local = config.allowLoopbackHttp && ["127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.hash || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
    throw new UpdateError("UNTRUSTED_RELEASE_URL");
  }
  if (url.origin !== new URL(config.feedUrl).origin) throw new UpdateError("RELEASE_ORIGIN_MISMATCH");
  return url;
}
async function download(url: URL, limit: number): Promise<Uint8Array> {
  const response = await ky.get(url, { retry: 0, timeout: 30_000, redirect: "error" });
  const body = response.body;
  if (!body) throw new UpdateError("EMPTY_DOWNLOAD");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const deadline = setTimeout(() => { void reader.cancel("download deadline"); }, 30_000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new UpdateError("DOWNLOAD_TOO_LARGE");
      chunks.push(value);
    }
  } finally { clearTimeout(deadline); await reader.cancel(); reader.releaseLock(); }
  return Buffer.concat(chunks);
}
export async function discover(config: UpdateConfig, now: string): Promise<readonly SignedRelease[]> {
  const raw = await download(allowedUrl(config.feedUrl, config), 4_000_000);
  const envelope = Envelope.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
  const payload = Buffer.from(envelope.payload, "base64");
  const key = createPublicKey(config.trustKeyPem);
  if (key.asymmetricKeyType !== "ed25519" || !verify(null, payload, key, Buffer.from(envelope.signature, "base64"))) {
    throw new UpdateError("SIGNATURE_INVALID");
  }
  const feed = Feed.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)));
  if (Date.parse(feed.expiresAt) <= Date.parse(now)) throw new UpdateError("FEED_EXPIRED");
  const ids = new Set<string>(); const sequences = new Set<number>();
  return feed.releases.map((release) => {
    allowedUrl(release.packageUrl, config);
    if (ids.has(release.id) || sequences.has(release.sequence)) throw new UpdateError("DUPLICATE_RELEASE");
    ids.add(release.id); sequences.add(release.sequence);
    if (Date.parse(release.expiresAt) <= Date.parse(now)) throw new UpdateError("RELEASE_EXPIRED");
    return { ...release, manifestDigest: digest(JSON.stringify(release)) };
  });
}
export async function fetchPackage(config: UpdateConfig, release: SignedRelease): Promise<ReleasePackage> {
  const bytes = await download(allowedUrl(release.packageUrl, config), release.packageBytes);
  if (bytes.byteLength !== release.packageBytes || digest(bytes) !== release.packageDigest) {
    throw new UpdateError("PACKAGE_DIGEST_MISMATCH");
  }
  const pack = Package.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  const names = new Set<string>();
  for (const file of pack.files) {
    if (file.path.split("/").some((part) => part === "." || part === "..") || names.has(file.path)) {
      throw new UpdateError("UNSAFE_PACKAGE_PATH");
    }
    names.add(file.path);
  }
  if (!pack.files.some((file) => file.path === pack.entrypoint && file.executable)) {
    throw new UpdateError("PACKAGE_ENTRYPOINT_MISSING");
  }
  return pack;
}
