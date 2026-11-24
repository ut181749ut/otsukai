# おつかいAI スマホアプリ(Android)

WebのおつかいAI(`../public`)を Capacitor で包んだアプリです。AIと楽天検索は公開済みの Cloudflare Worker を呼びます。
アプリにすると、スクショや写真をどのアプリからでも「共有 → おつかいAI」で送れます。

## 作る

前提: Node.js 22 以上、Android Studio

```
cd app
npm install
OTSUKAI_API=https://otsukai-ai.xxxx.workers.dev npm run android:add   # 初回だけ
npm run open                                                          # Android Studio が開く → ▶ で実機に入れる
```

画面を直したあとは `OTSUKAI_API=… npm run sync`。

Windows の PowerShell では `$env:OTSUKAI_API="https://…"; npm run android:add` のように書きます。

## 確かめること(本番テスト)

1. 文字で頼む: 「2000円以内でコーヒー豆」→ 候補 → 「それ」→ 注文ボタン → 楽天の画面が開く
2. 写真で頼む: 📷 で洗剤を撮る → 何か当てて探す
3. 共有で頼む: スクショを撮る → 共有 → おつかいAI → 開いた瞬間に送られる
