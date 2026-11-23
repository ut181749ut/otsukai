// 外部API(Claude・楽天・財布番)をすべて偽物に差し替えて、買い物の流れを確かめる
import assert from "node:assert/strict";
import worker, { parseKey } from "../src/worker.js";

const KEY = "sbk_" + "a".repeat(48);
const ITEM = { itemCode: "shop:123", itemName: "コーヒー豆 1kg", itemPrice: 1800, postageFlag: 0, shopName: "珈琲屋", reviewAverage: 4.5, reviewCount: 120, itemUrl: "https://item.rakuten.co.jp/shop/123/", mediumImageUrls: ["https://img/1.jpg"] };

let claudeScript = [], saifubanReply, redeemReply, calls = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url, body });
  const res = (d, s = 200) => new Response(JSON.stringify(d), { status: s });
  if (url.includes("api.anthropic.com")) return res(claudeScript.shift());
  if (url.includes("openapi.rakuten.co.jp")) return res({ Items: [ITEM] });
  if (url.includes("saifuban-mcp")) return res({ jsonrpc: "2.0", id: 1, result: { structuredContent: saifubanReply(body.params) } });
  if (url.includes("/redeem")) return res(redeemReply(body));
  throw new Error("unexpected " + url);
};
const env = { ANTHROPIC_API_KEY: "x", RAKUTEN_APP_ID: "a", RAKUTEN_ACCESS_KEY: "k", ASSETS: { fetch: () => new Response("html") } };
const post = async (path, b) => (await worker.fetch(new Request("https://t" + path, { method: "POST", body: JSON.stringify(b) }), env)).json();
const tool = (name, input) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t" + Math.random(), name, input }] });
const text = (t) => ({ stop_reason: "end_turn", content: [{ type: "text", text: t }] });

// 0. キーの読み取り
assert.equal(parseKey("https://x/functions/v1/saifuban-mcp/" + KEY), KEY);
assert.equal(parseKey("sbk_short"), "");

// 1. 財布番キーなしは断る
assert.equal((await post("/api/chat", { messages: [{ role: "user", content: "hi" }] })).error, "no_saifuban_key");

// 2. 検索 → 商品カード
claudeScript = [tool("search_products", { keyword: "コーヒー豆", max_price: 2000 }), text("3つ見つけました")];
let r = await post("/api/chat", { saifubanKey: KEY, conversationId: "c1", messages: [{ role: "user", content: "2000円以内でコーヒー豆" }] });
assert.equal(r.events[0].type, "products");
assert.equal(r.events[0].items[0].price, 1800);
assert.equal(r.messages.length, 3);

// 3. 承認 → 許可証を使用済みにしてから購入ボタン。金額はAIの言い値でなく楽天の価格×個数
saifubanReply = (p) => ({ status: "approved", request_id: 7, payment_token: "sbt_x" });
redeemReply = (b) => ({ valid: b.amount === 3600 && b.merchant === "楽天市場 珈琲屋", consumed: true });
calls = [];
claudeScript = [tool("request_payment", { item_code: "shop:123", quantity: 2, reason: "毎朝飲む" }), text("購入ボタンを用意しました")];
r = await post("/api/chat", { saifubanKey: KEY, conversationId: "c1", messages: [{ role: "user", content: "それ2つ" }] });
const req = calls.find((c) => c.url.includes("saifuban-mcp")).body.params;
assert.equal(req.name, "request_payment");
assert.equal(req.arguments.amount, 3600);
assert.equal(r.events.at(-1).type, "checkout");
assert.equal(r.events.at(-1).url, ITEM.itemUrl);

// 4. 許可証の確認に失敗したら購入ボタンは出ない
redeemReply = () => ({ valid: false, error: "amount_exceeds_approval" });
claudeScript = [tool("request_payment", { item_code: "shop:123", reason: "x" }), text("買えませんでした")];
r = await post("/api/chat", { saifubanKey: KEY, messages: [{ role: "user", content: "買って" }] });
assert.ok(!r.events.some((e) => e.type === "checkout"));
assert.equal(r.events.at(-1).status, "denied");

// 5. スマホ承認待ち → ボタンなし、request_id を画面に渡す
saifubanReply = () => ({ status: "pending_approval", request_id: 9 });
claudeScript = [tool("request_payment", { item_code: "shop:123", reason: "x" }), text("スマホで承認してください")];
r = await post("/api/chat", { saifubanKey: KEY, messages: [{ role: "user", content: "買って" }] });
assert.equal(r.events.at(-1).status, "pending_approval");
assert.equal(r.events.at(-1).request_id, 9);
assert.ok(!r.events.some((e) => e.type === "checkout"));

// 6. 却下
saifubanReply = () => ({ status: "denied", reason: "1日の予算を超えます" });
claudeScript = [tool("request_payment", { item_code: "shop:123", reason: "x" }), text("予算オーバーでした")];
r = await post("/api/chat", { saifubanKey: KEY, messages: [{ role: "user", content: "買って" }] });
assert.equal(r.events.at(-1).reason, "1日の予算を超えます");

// 7. 承認状況の確認API
saifubanReply = () => ({ status: "approved" });
assert.equal((await post("/api/status", { saifubanKey: KEY, request_id: 9 })).status, "approved");

console.log("ok: 7 scenarios passed");
