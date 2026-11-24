# おつかいAI

欲しいものを言うか、写真・スクショを送るだけで、AIが楽天市場とAmazonから探して注文画面まで案内する買い物アプリです。登録は要りません。

```
「2000円以内でコーヒー豆を買って」 / 📷 切れた洗剤の写真
  → AIが楽天とAmazonで探して、候補を3つ紹介(店・値段・送料・選んだ理由つき)
  → 「それにする」
  → 「楽天市場で注文する」/「Amazonで注文する」ボタン → お店の画面で注文
```

📷 **写真からも頼めます。** 撮って送ると、AIが何か特定して同じ物(なければ近い物)を探します。写真はブラウザで縮小してから送り、AIに一度見せたら履歴からは外します。

📸 **スクショからすぐ頼めます。**
- Android: おつかいAIをホーム画面に追加 → スクショを撮る → 「共有」→ おつかいAI。開いた瞬間にAIへ送られます
- パソコン: スクショを撮って画面で Ctrl+V(⌘V)
- iPhone: ホーム画面アプリへの共有はiOSが対応していないため、📷ボタンからスクショを選びます

📱 **スマホアプリ(Android)にもできます。** `app/` を参照。アプリならどのアプリからでも「共有 → おつかいAI」でスクショを送れます。

## 仕組み

- `src/worker.js` — Cloudflare Worker。Claude(ツール使用)+ 楽天市場商品検索API
- `src/amazon.js` — Amazon.co.jp の商品検索(Amazonアソシエイト Creators API。PA-API 5 は2026年に廃止)。鍵がなければ楽天だけで動きます
- `public/index.html` — チャット画面(1ファイル)。`public/sw.js` と `manifest.webmanifest` でホーム画面追加と共有に対応
- サーバーには何も保存しません。会話はブラウザに保存します
- 注文ボタンの値段と商品ページは、AIの言った値ではなく、サーバーが楽天からその場で取り直したものを使います
- 使いすぎ防止: 同じIPから1分に6回まで(Cloudflareのレート制限)。全体のAI代の上限は Anthropic の管理画面で設定する
- 注文の確定は利用者が楽天の画面で行います。カード番号やパスワードは扱いません

## 動かす

1. 楽天ウェブサービスでアプリ登録し、`applicationId`(UUID)と `accessKey`(pk_…)を取る。許可するWebサイトに公開URL(手元なら `http://localhost:8787`)を登録する
2. Amazonも探すなら、Amazonアソシエイトの「Creators API」画面でアプリと認証情報を作る(認証情報ID・シークレット・バージョン、トラッキングID)
3. `.dev.vars.example` を `.dev.vars` にコピーして値を入れる
4. `npm install` → `npm run dev`(手元) / `npm run deploy`(公開)
5. 公開時は `npx wrangler secret put ANTHROPIC_API_KEY` などで秘密の値を入れ、`wrangler.jsonc` の `SITE_URL` を公開URLにする

テスト(外部APIは偽物に差し替え): `npm test`

## お金

- **収入**: `RAKUTEN_AFFILIATE_ID` を入れると楽天アフィリエイト、Amazonは `AMAZON_PARTNER_TAG` 付きのリンクになります(画面に「PR」の表示が出ます)
- Amazonの紹介料は、スマホアプリ経由だと Amazon に承認されたアプリ(Approved Mobile Application)でないと対象外です。Web版はそのままで対象
- Amazonの検索回数の上限は最初の30日が1日8640回。その後はAmazon経由の売上に応じて増減します
- **費用**: Claude APIの料金。`MODEL` を `claude-haiku-5-5` にすると大きく下がります

## まだできないこと

- **注文確定の自動化**: 楽天・Amazonには外部から注文できる公開APIがありません
- **送料**: 送料別の商品は送料を含めずに表示します(「送料別」と出します)
- **Yahoo!ショッピング**: 検索元を足せば対応できます
- **Amazonのレビュー・送料**: Creators API では取れないので、カードに出しません
