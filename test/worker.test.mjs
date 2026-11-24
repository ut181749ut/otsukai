// 外部API(Claude・楽天)を偽物に差し替えて、買い物の流れを確かめる
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const ITEM = { itemCode: "shop:123", itemName: "コーヒー豆 1kg", itemPrice: 1800, postageFlag: 0, shopName: "珈琲屋", reviewAverage: 4.5, reviewCount: 120, itemUrl: "https://item.rakuten.co.jp/shop/123/", affiliateUrl: "https://hb.afl.rakuten.co.jp/x", mediumImageUrls: ["https://img/1.jpg"] };
let claudeScript = [], calls = [], items = [ITEM];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
  const res = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
  if (url.includes("api.anthropic.com")) return res(claudeScript.shift());
  if (url.includes("openapi.rakuten.co.jp")) return res({ Items: items });
  throw new Error("unexpected " + url);
};
const env = { ANTHROPIC_API_KEY: "x", RAKUTEN_APP_ID: "a", RAKUTEN_ACCESS_KEY: "k", ASSETS: { fetch: () => new Response("html") } };
const post = async (b) => (await worker.fetch(new Request("https://t/api/chat", { method: "POST", body: JSON.stringify(b) }), env)).json();
const tool = (name, input) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t" + Math.random(), name, input }] });
const text = (t) => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });

// 1. 登録なしでそのまま使える。検索 → 商品カード
claudeScript = [tool("search_products", { keyword: "コーヒー豆", max_price: 2000 }), text("3つ見つけました")];
let r = await post({ messages: [{ role: "user", content: "2000円以内でコーヒー豆" }] });
assert.equal(r.events[0].type, "products");
assert.equal(r.events[0].items[0].price, 1800);
assert.equal(r.events[0].items[0].url, ITEM.affiliateUrl); // アフィリエイトリンク
assert.equal(r.messages.length, 3);

// 2. 決めたら注文ボタン。値段はAIの言い値でなく楽天の価格×個数
claudeScript = [tool("show_checkout", { item_code: "shop:123", quantity: 2 }), text("注文ボタンを用意しました")];
r = await post({ messages: [{ role: "user", content: "それ2つ" }] });
const co = r.events.at(-1);
assert.equal(co.type, "checkout");
assert.equal(co.amount, 3600);
assert.equal(co.url, ITEM.affiliateUrl);

// 3. 売り切れ(商品が引けない)なら注文ボタンは出ない
items = [];
claudeScript = [tool("show_checkout", { item_code: "shop:123" }), text("売り切れでした")];
r = await post({ messages: [{ role: "user", content: "それ" }] });
assert.ok(!r.events.some((e) => e.type === "checkout"));
items = [ITEM];

// 4. 写真: base64 の画像はAIに届き、URL参照の画像は捨てられる
calls = [];
claudeScript = [text("これは〇〇の洗剤だと思います")];
const img = { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } };
const bad = { type: "image", source: { type: "url", url: "https://evil.example/x.png" } };
await post({ messages: [{ role: "user", content: [img, bad, { type: "text", text: "この写真のものを探して" }] }] });
const sent = calls.find((c) => c.url.includes("anthropic")).body.messages[0].content;
assert.equal(sent.length, 2);
assert.equal(sent[0].source.type, "base64");

// 5. 他のサービスには一切つながない
assert.ok(calls.every((c) => /api\.anthropic\.com|openapi\.rakuten\.co\.jp/.test(c.url))); // Amazon未設定なら楽天だけ

console.log("ok: 5 scenarios passed");

// 6. スマホアプリ(https://localhost)からの呼び出しにCORSを返す。他のサイトには返さない
const pre = await worker.fetch(new Request("https://t/api/chat", { method: "OPTIONS", headers: { origin: "https://localhost" } }), env);
assert.equal(pre.status, 204);
assert.equal(pre.headers.get("access-control-allow-origin"), "https://localhost");
claudeScript = [text("はい")];
const ok = await worker.fetch(new Request("https://t/api/chat", { method: "POST", headers: { origin: "https://localhost" }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) }), env);
assert.equal(ok.headers.get("access-control-allow-origin"), "https://localhost");
claudeScript = [text("はい")];
const evil = await worker.fetch(new Request("https://t/api/chat", { method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) }), env);
assert.equal(evil.headers.get("access-control-allow-origin"), null);
console.log("ok: app CORS");

// 7. 使いすぎ防止: 同じIPは上限を超えたら429、AIは呼ばない
let used = 0;
const limited = { ...env, LIMITER: { limit: async ({ key }) => ({ success: key === "chat:1.2.3.4" && ++used <= 2 }) } };
const send = (ip) => worker.fetch(new Request("https://t/api/chat", { method: "POST", headers: { "cf-connecting-ip": ip }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) }), limited);
claudeScript = [text("はい"), text("はい")];
assert.equal((await send("1.2.3.4")).status, 200);
assert.equal((await send("1.2.3.4")).status, 200);
calls = [];
const over = await send("1.2.3.4");
assert.equal(over.status, 429);
assert.equal((await over.json()).error, "rate_limited");
assert.equal(calls.length, 0);
console.log("ok: rate limit");
