// Amazon(Creators API)と楽天をまとめて探す流れを、偽のAPIで確かめる
import assert from "node:assert/strict";
import worker, { searchAll } from "../src/worker.js";

const RAK = { itemCode: "shop:1", itemName: "洗剤 詰め替え 楽天", itemPrice: 498, postageFlag: 1, shopName: "ドラッグ屋", itemUrl: "https://item.rakuten.co.jp/shop/1/", mediumImageUrls: ["https://r/1.jpg"] };
const AMZ = {
  asin: "B0TEST1234", detailPageURL: "https://www.amazon.co.jp/dp/B0TEST1234?tag=mytag-22",
  itemInfo: { title: { displayValue: "洗剤 詰め替え Amazon" } },
  images: { primary: { medium: { url: "https://m.media-amazon.com/images/I/x.jpg" } } },
  offersV2: { listings: [{ price: { money: { amount: 455, currency: "JPY", displayAmount: "￥455" } } }] },
};
let calls = [], tokenCalls = 0, amazonDown = false, claude = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const body = init.body && typeof init.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init.body;
  calls.push({ url, init, body });
  const res = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
  if (url === "https://api.amazon.co.jp/auth/o2/token") { tokenCalls++; return res({ access_token: "tok", token_type: "bearer", expires_in: 3600 }); }
  if (url.startsWith("https://creatorsapi.amazon/catalog/v1/")) {
    if (amazonDown) return res({ errors: [{ message: "TooManyRequests" }] }, 429);
    return url.endsWith("/searchItems") ? res({ searchResult: { items: [AMZ] } }) : res({ itemsResult: { items: [AMZ] } });
  }
  if (url.includes("openapi.rakuten.co.jp")) return res({ Items: [RAK] });
  if (url.includes("api.anthropic.com")) return res(claude.shift());
  throw new Error("unexpected " + url);
};
const env = {
  RAKUTEN_APP_ID: "a", RAKUTEN_ACCESS_KEY: "k",
  AMAZON_CREDENTIAL_ID: "cid", AMAZON_CREDENTIAL_SECRET: "sec", AMAZON_PARTNER_TAG: "mytag-22",
  ANTHROPIC_API_KEY: "x", ASSETS: { fetch: () => new Response("") },
};

// 1. 両方の店から出る。Amazonは送料「不明」、値段は円
let items = await searchAll(env, { keyword: "洗剤 詰め替え", max_price: 1000 });
assert.deepEqual(items.map((i) => i.store).sort(), ["Amazon", "楽天市場"]);
const a = items.find((i) => i.store === "Amazon");
assert.equal(a.item_code, "amazon:B0TEST1234");
assert.equal(a.price, 455);
assert.equal(a.postage_included, null);
assert.equal(a.url, AMZ.detailPageURL);

// 2. Amazonへの依頼の中身: トークン、日本のマーケットプレイス、パートナータグ、価格は円のまま
const tokenReq = calls.find((c) => c.url.includes("/auth/o2/token"));
assert.equal(tokenReq.init.headers.authorization, "Basic " + btoa("cid:sec"));
assert.match(String(tokenReq.body), /scope=creatorsapi%3A%3Adefault/);
const s = calls.find((c) => c.url.endsWith("/searchItems"));
assert.equal(s.init.headers.authorization, "Bearer tok");
assert.equal(s.init.headers["x-marketplace"], "www.amazon.co.jp");
assert.equal(s.body.partnerTag, "mytag-22");
assert.equal(s.body.maxPrice, 1000);

// 3. トークンは使い回す
await searchAll(env, { keyword: "x" });
assert.equal(tokenCalls, 1);

// 4. 店を指定できる
assert.ok((await searchAll(env, { keyword: "x", store: "amazon" })).every((i) => i.store === "Amazon"));
assert.ok((await searchAll(env, { keyword: "x", store: "rakuten" })).every((i) => i.store === "楽天市場"));

// 5. Amazonが落ちていても楽天の結果は出る
amazonDown = true;
items = await searchAll(env, { keyword: "x" });
assert.deepEqual(items.map((i) => i.store), ["楽天市場"]);
amazonDown = false;

// 6. Amazonの注文ボタン: 値段とリンクはAmazonから取り直す
claude = [
  { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "show_checkout", input: { item_code: "amazon:B0TEST1234", quantity: 2 } }] },
  { stop_reason: "end_turn", content: [{ type: "text", text: "注文ボタンを用意しました" }] },
];
const r = await (await worker.fetch(new Request("https://t/api/chat", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "Amazonの方を2つ" }] }) }), env)).json();
const co = r.events.at(-1);
assert.equal(co.type, "checkout");
assert.equal(co.amount, 910);
assert.equal(co.item.store, "Amazon");
assert.ok(calls.some((c) => c.url.endsWith("/getItems") && c.body.itemIds[0] === "B0TEST1234"));

// 7. Amazonの鍵がなければ楽天だけで動く
const rakOnly = { ...env, AMAZON_CREDENTIAL_ID: "" };
assert.ok((await searchAll(rakOnly, { keyword: "x" })).every((i) => i.store === "楽天市場"));

console.log("ok: Amazon + 楽天");
