// 通知用の VAPID 鍵を作る。出てきた2行を wrangler secret put で登録する
const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
const b64url = (b) => Buffer.from(b).toString("base64url");
const jwk = await crypto.subtle.exportKey("jwk", privateKey);
console.log("VAPID_PUBLIC_KEY=" + b64url(raw));
console.log("VAPID_PRIVATE_JWK=" + JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }));
