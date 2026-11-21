import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign,
} from "node:crypto";

// Web Push sender with node:crypto only (no `web-push` dependency):
// payload encryption per RFC 8291 (aes128gcm, RFC 8188) and VAPID per RFC 8292.

export type VapidKeys = {
  /** Uncompressed P-256 public key, base64url (65 bytes). Also the browser's applicationServerKey. */
  publicKey: string;
  /** P-256 private scalar, base64url (32 bytes). */
  privateKey: string;
};

export type VapidConfig = VapidKeys & {
  /** `mailto:` or `https:` contact the push service can reach. */
  subject: string;
};

export type PushTarget = {
  endpoint: string;
  /** Browser ECDH public key, base64url. */
  p256dh: string;
  /** Browser auth secret, base64url. */
  auth: string;
};

const RECORD_SIZE = 4096;
const VAPID_TTL_SECONDS = 12 * 3600;

export function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

export function fromB64url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** HKDF-SHA256 with a single expand block (every length here is <= 32). */
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = hmac(salt, ikm);
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);
}

/** `node -e` friendly: a fresh VAPID key pair for `.env`. */
export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

/**
 * Encrypts one payload for one browser subscription (RFC 8291). The body is
 * a single aes128gcm record: header (salt, record size, sender key) then the
 * ciphertext of `payload || 0x02`.
 */
export function encryptPayload(payload: string, keys: Pick<PushTarget, "p256dh" | "auth">): Buffer {
  const uaPublic = fromB64url(keys.p256dh);
  const authSecret = fromB64url(keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
    throw new Error("Invalid p256dh key");
  }
  if (authSecret.length !== 16) throw new Error("Invalid auth secret");

  const sender = createECDH("prime256v1");
  sender.generateKeys();
  const asPublic = sender.getPublicKey();
  const shared = sender.computeSecret(uaPublic);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hkdf(authSecret, shared, keyInfo, 32);
  const salt = randomBytes(16);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);

  const plaintext = Buffer.concat([Buffer.from(payload, "utf8"), Buffer.from([2])]);
  if (plaintext.length + 16 > RECORD_SIZE - 86) throw new Error("Push payload too large");
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, ciphertext]);
}

/** `Authorization: vapid t=<ES256 JWT>, k=<public key>` for one endpoint. */
export function vapidAuthorization(args: { endpoint: string; vapid: VapidConfig; now?: number }): string {
  const { vapid } = args;
  const pub = fromB64url(vapid.publicKey);
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
      d: vapid.privateKey,
    },
    format: "jwk",
  });
  const exp = Math.floor((args.now ?? Date.now()) / 1000) + VAPID_TTL_SECONDS;
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(
    Buffer.from(JSON.stringify({ aud: new URL(args.endpoint).origin, exp, sub: vapid.subject })),
  );
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), {
    key,
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${vapid.publicKey}`;
}

export type PushRequest = {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
};

export function buildPushRequest(
  target: PushTarget,
  payload: string,
  opts: { vapid: VapidConfig; ttlSeconds?: number },
): PushRequest {
  return {
    url: target.endpoint,
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(opts.ttlSeconds ?? 24 * 3600),
      Urgency: "high",
      Authorization: vapidAuthorization({ endpoint: target.endpoint, vapid: opts.vapid }),
    },
    body: encryptPayload(payload, target),
  };
}

export type PushSendResult =
  | { ok: true }
  /** `gone`: the push service dropped the subscription (404/410); delete it. */
  | { ok: false; gone: boolean; status: number | null };

/** POSTs one encrypted message to the browser's push service. */
export async function sendWebPush(
  target: PushTarget,
  payload: string,
  opts: { vapid: VapidConfig; ttlSeconds?: number; fetchImpl?: typeof fetch },
): Promise<PushSendResult> {
  const req = buildPushRequest(target, payload, opts);
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: new Uint8Array(req.body),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true };
    return { ok: false, gone: res.status === 404 || res.status === 410, status: res.status };
  } catch {
    return { ok: false, gone: false, status: null };
  }
}
