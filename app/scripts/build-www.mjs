// ../public の画面をアプリ用に www/ へコピーし、サーバー(Cloudflare Worker)のURLを埋め込む
// 使い方: OTSUKAI_API=https://otsukai-ai.xxxx.workers.dev npm run build
import { cpSync, rmSync, readFileSync, writeFileSync } from "node:fs";

const api = (process.env.OTSUKAI_API || "").replace(/\/$/, "");
if (!/^https:\/\/[^/]+$/.test(api)) {
  console.error("OTSUKAI_API に公開したおつかいAIのURL(https://…)を入れてください");
  process.exit(1);
}
rmSync("www", { recursive: true, force: true });
cpSync("../public", "www", { recursive: true });
rmSync("www/sw.js", { force: true }); // アプリでは共有をネイティブで受けるので不要
const html = readFileSync("www/index.html", "utf8").replace(
  '<meta name="otsukai-api" content="">',
  `<meta name="otsukai-api" content="${api}">`,
);
if (!html.includes(api)) { console.error("index.html に API の埋め込み場所が見つかりません"); process.exit(1); }
writeFileSync("www/index.html", html);
console.log("www/ を作りました(API: " + api + ")");
