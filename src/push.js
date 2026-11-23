// Web Push(VAPID)。本文は暗号化が要らない「空のプッシュ」で送り、
// 通知の中身はサービスワーカーが /api/notice から取りにくる。

const enc = new TextEncoder();

export const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function sha256hex(s) {
  const h = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// VAPID の署名つきヘッダー。env.VAPID_PRIVATE_JWK は P-256 の秘密鍵(JWK の JSON 文字列)
export async function vapidAuth(env, endpoint) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey("jwk", { ...jwk, key_ops: ["sign"] }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || "mailto:admin@example.com",
  })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// 送れたら true。購読が切れていたら "gone"
export async function sendEmptyPush(env, subscription) {
  const endpoint = subscription?.endpoint;
  if (!endpoint || !/^https:\/\//.test(endpoint)) return false;
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: await vapidAuth(env, endpoint), TTL: "3600", Urgency: "high", "Content-Length": "0" },
    });
    if (r.status === 404 || r.status === 410) return "gone";
    return r.ok;
  } catch {
    return false;
  }
}
