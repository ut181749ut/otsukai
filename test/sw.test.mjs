// 共有されたスクショをサービスワーカーが受け取り、画面に渡せる形で保存するか
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const store = new Map(); const listeners = {};
globalThis.caches = { open: async () => ({ put: async (k, r) => store.set(k, r), match: async (k) => store.get(k), delete: async (k) => store.delete(k) }) };
globalThis.self = { addEventListener: (t, f) => (listeners[t] = f), skipWaiting() {}, clients: { claim() {} } };
new Function(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"))();
const fd = new FormData();
fd.append("photo", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "shot.png");
fd.append("text", "これ欲しい");
let res;
listeners.fetch({ request: new Request("https://x/share", { method: "POST", body: fd }), respondWith: (p) => (res = p) });
res = await res;
assert.equal(res.status, 303);
assert.ok(res.headers.get("location").endsWith("/?shared=1"));
assert.equal((await store.get("/shared/photo").blob()).size, 3);
assert.equal(await store.get("/shared/text").text(), "これ欲しい");
console.log("ok: share target");
