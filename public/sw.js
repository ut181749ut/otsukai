// おつかいAI のサービスワーカー
// スマホの「共有」からスクショや写真を受け取り、アプリの画面に渡す。
const SHARE_CACHE = "otsukai-share";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname === "/share" && e.request.method === "POST") {
    e.respondWith(receiveShare(e.request));
  }
});

async function receiveShare(req) {
  try {
    const form = await req.formData();
    const file = form.get("photo");
    const text = [form.get("title"), form.get("text"), form.get("url")].filter(Boolean).join(" ").trim();
    const cache = await caches.open(SHARE_CACHE);
    if (file && typeof file !== "string" && file.type.startsWith("image/")) {
      await cache.put("/shared/photo", new Response(file, { headers: { "content-type": file.type } }));
    }
    if (text) await cache.put("/shared/text", new Response(text));
  } catch (err) {
    // 受け取れなくてもアプリは開く
  }
  return Response.redirect(new URL("/?shared=1", req.url).href, 303);
}

