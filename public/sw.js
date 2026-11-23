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

// 財布番で承認・却下されたら届く通知(写真つき)。中身は空なのでサーバーへ取りにいく
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let notices = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sub.endpoint));
      const ep = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
      notices = (await (await fetch("/api/notice?ep=" + ep)).json()).notices || [];
    } catch {}
    if (!notices.length) notices = [{ title: "おつかいAI", body: "財布番の結果が届きました。タップして確認してください", url: "/" }];
    await Promise.all(notices.map((n) => self.registration.showNotification(n.title, {
      body: n.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      ...(n.image && n.image.startsWith("https://") ? { image: n.image } : {}),
      tag: n.tag || "otsukai",
      renotify: true,
      data: { url: n.url || "/" },
    })));
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/";
  // お店のページ(楽天)か、おつかいAI自身だけを開く
  const ok = url.startsWith("/") || /^https:\/\/([a-z0-9-]+\.)*(rakuten\.co\.jp|rakuten\.com)\//.test(url) || url.startsWith("https://hb.afl.rakuten.co.jp/");
  e.waitUntil(self.clients.openWindow(ok ? url : "/"));
});
