// スクショや写真を「共有」から受け取れるよう、AndroidManifest.xml に受け口を足す(何度実行しても1回分だけ)
import { readFileSync, writeFileSync } from "node:fs";

const path = "android/app/src/main/AndroidManifest.xml";
let xml = readFileSync(path, "utf8");
const MARK = "<!-- otsukai:share -->";
if (xml.includes(MARK)) { console.log("共有の受け口は設定済み"); process.exit(0); }
const filters = `
            ${MARK}
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="image/*" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>`;
const i = xml.indexOf("</activity>");
if (i < 0) { console.error("AndroidManifest.xml に <activity> が見つかりません"); process.exit(1); }
xml = xml.slice(0, i) + filters.trimEnd() + "\n        " + xml.slice(i);
writeFileSync(path, xml);
console.log("共有の受け口を AndroidManifest.xml に足しました");
