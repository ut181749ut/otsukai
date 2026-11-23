// 承認 → 1分ごとの見回り → 写真つき通知、の流れと VAPID 署名を確かめる
import assert from "node:assert/strict";
import worker, { sweep } from "../src/worker.js";
import { vapidAuth } from "../src/push.js";

// VAPID 鍵
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = Buffer.from(await crypto.subtle.exportKey("raw", kp.publicKey)).toString("base64url");
const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);

// 偽の KV
const kv = new Map();
const KV = {
  get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v), delete: async (k) => void kv.delete(k),
  list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
};
const env = { KV, VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_JWK: JSON.stringify(jwk), RAKUTEN_APP_ID: "a", RAKUTEN_ACCESS_KEY: "k", ASSETS: { fetch: () => new Response("") } };

// 1. 署名が公開鍵で検証できる
const auth = await vapidAuth(env, "https://fcm.googleapis.com/fcm/send/abc");
const [, t, k] = auth.match(/^vapid t=([^,]+), k=(.+)$/);
assert.equal(k, pub);
const [h, c, sig] = t.split(".");
assert.equal(JSON.parse(Buffer.from(c, "base64url")).aud, "https://fcm.googleapis.com");
assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, kp.publicKey, Buffer.from(sig, "base64url"), new TextEncoder().encode(`${h}.${c}`)));

// 偽の外部API
const KEY = "sbk_" + "b".repeat(48);
const ITEM = { itemCode: "shop:9", itemName: "洗剤 詰め替え", itemPrice: 498, postageFlag: 0, shopName: "ドラッグ屋", itemUrl: "https://item.rakuten.co.jp/shop/9/", mediumImageUrls: ["https://thumbnail.image.rakuten.co.jp/@0_mall/x.jpg?_ex=128x128"] };
let status = "pending_approval", redeems = 0, pushes = [], saifubanArgs = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const res = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
  if (url.includes("openapi.rakuten.co.jp")) return res({ Items: [ITEM] });
  if (url.includes("saifuban-mcp")) { const p = JSON.parse(init.body).params; saifubanArgs.push(p); return res({ result: { structuredContent: { status, request_id: 5, payment_token: "sbt_1" } } }); }
  if (url.includes("/redeem")) { redeems++; return res(redeems === 1 ? { valid: true } : { valid: false, error: "already_used" }); }
  if (url.startsWith("https://fcm.googleapis.com/")) { pushes.push(init.headers); return new Response(null, { status: 201 }); }
  throw new Error("unexpected " + url);
};
const call = async (path, body, method = "POST") => (await worker.fetch(new Request("https://t" + path, method === "GET" ? {} : { method, body: JSON.stringify(body) }), env)).json();

// 2. 設定APIが公開鍵を返す
assert.equal((await call("/api/config", null, "GET")).vapidPublicKey, pub);

// 3. 通知の予約 → 承認待ちのうちは何も送らない
const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: {} };
assert.ok((await call("/api/watch", { saifubanKey: KEY, request_id: 5, item_code: "shop:9", qty: 2, subscription: sub })).ok);
await sweep(env);
assert.equal(pushes.length, 0);

// 4. 承認 → 許可証を使用済みにして、写真つきの通知を送る
status = "approved";
await sweep(env);
assert.equal(redeems, 1);
assert.equal(pushes.length, 1);
assert.ok(pushes[0].Authorization.startsWith("vapid t="));
assert.equal([...kv.keys()].filter((k) => k.startsWith("w:")).length, 0); // 見回り終了
const ep = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sub.endpoint))).toString("hex");
const { notices } = await call("/api/notice?ep=" + ep, null, "GET");
assert.equal(notices.length, 1);
assert.match(notices[0].title, /承認されました ¥996/);
assert.equal(notices[0].url, ITEM.itemUrl);
assert.match(notices[0].image, /_ex=500x500/);
assert.equal((await call("/api/notice?ep=" + ep, null, "GET")).notices.length, 0); // 1回で消える

// 5. あとから画面でも確認 → 使用済みにした結果を覚えているので、そのまま購入ボタンが出る
const claude = [
  { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "check_payment_status", input: { request_id: 5, item_code: "shop:9", quantity: 2 } }] },
  { stop_reason: "end_turn", content: [{ type: "text", text: "購入ボタンを用意しました" }] },
];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => String(url).includes("anthropic") ? new Response(JSON.stringify(claude.shift())) : realFetch(url, init);
const r = await call("/api/chat", { saifubanKey: KEY, messages: [{ role: "user", content: "確認して" }] });
assert.equal(redeems, 1); // 覚えていたので2回目は使わない
assert.equal(r.events.at(-1).type, "checkout");

// 6. 財布番への申請に商品写真のURLが付く
saifubanArgs = []; status = "pending_approval";
claude.push(
  { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t2", name: "request_payment", input: { item_code: "shop:9", reason: "切れた" } }] },
  { stop_reason: "end_turn", content: [{ type: "text", text: "スマホで承認してください" }] },
);
await call("/api/chat", { saifubanKey: KEY, conversationId: "c", messages: [{ role: "user", content: "買って" }] });
assert.match(saifubanArgs.find((p) => p.name === "request_payment").arguments.image_url, /_ex=500x500/);

console.log("ok: push + photo notifications");
