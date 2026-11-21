import { createECDH, createHmac, createDecipheriv, createPublicKey, randomBytes, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  b64url,
  fromB64url,
  encryptPayload,
  generateVapidKeys,
  vapidAuthorization,
  buildPushRequest,
} from "./web-push";

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** RFC 8291 receiver side, written independently of the sender code. */
function decrypt(body: Buffer, uaPrivate: Buffer, uaPublic: Buffer, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  expect(rs).toBe(4096);
  expect(idlen).toBe(65);

  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(tag);
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  // Last record: content then a 0x02 delimiter, then optional zero padding.
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  expect(padded[end]).toBe(2);
  return padded.subarray(0, end).toString("utf8");
}

function browserKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { priv: ecdh.getPrivateKey(), pub: ecdh.getPublicKey(), auth: randomBytes(16) };
}

describe("encryptPayload (RFC 8291 aes128gcm)", () => {
  it("round-trips through an independent receiver", () => {
    const ua = browserKeys();
    const body = encryptPayload("{\"title\":\"Needs you\"}", {
      p256dh: b64url(ua.pub),
      auth: b64url(ua.auth),
    });
    expect(decrypt(body, ua.priv, ua.pub, ua.auth)).toBe("{\"title\":\"Needs you\"}");
  });

  it("uses a fresh salt and sender key per message", () => {
    const ua = browserKeys();
    const keys = { p256dh: b64url(ua.pub), auth: b64url(ua.auth) };
    const a = encryptPayload("x", keys);
    const b = encryptPayload("x", keys);
    expect(a.subarray(0, 16).equals(b.subarray(0, 16))).toBe(false);
    expect(a.subarray(21, 86).equals(b.subarray(21, 86))).toBe(false);
  });

  it("rejects a malformed browser key", () => {
    expect(() => encryptPayload("x", { p256dh: b64url(Buffer.alloc(10)), auth: b64url(randomBytes(16)) })).toThrow();
  });
});

describe("VAPID (RFC 8292)", () => {
  it("signs an ES256 JWT for the endpoint origin that verifies with the public key", () => {
    const keys = generateVapidKeys();
    const now = 1_800_000_000_000;
    const header = vapidAuthorization({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      vapid: { ...keys, subject: "mailto:ops@example.com" },
      now,
    });
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, jwt, k] = match!;
    expect(k).toBe(keys.publicKey);

    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(fromB64url(h).toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(fromB64url(p).toString());
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:ops@example.com");
    expect(claims.exp).toBe(now / 1000 + 12 * 3600);

    const pub = fromB64url(keys.publicKey);
    const key = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) },
      format: "jwk",
    });
    const ok = verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, fromB64url(s));
    expect(ok).toBe(true);
  });
});

describe("buildPushRequest", () => {
  it("sets the aes128gcm headers, TTL and VAPID authorization", () => {
    const ua = browserKeys();
    const keys = generateVapidKeys();
    const req = buildPushRequest(
      { endpoint: "https://updates.push.services.mozilla.com/wpush/v2/x", p256dh: b64url(ua.pub), auth: b64url(ua.auth) },
      "hello",
      { vapid: { ...keys, subject: "mailto:a@b.c" }, ttlSeconds: 3600 },
    );
    expect(req.url).toBe("https://updates.push.services.mozilla.com/wpush/v2/x");
    expect(req.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(req.headers["Content-Type"]).toBe("application/octet-stream");
    expect(req.headers.TTL).toBe("3600");
    expect(req.headers.Urgency).toBe("high");
    expect(req.headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(decrypt(req.body, ua.priv, ua.pub, ua.auth)).toBe("hello");
  });
});
