// Amazon.co.jp の商品検索(Amazonアソシエイト Creators API)
// PA-API 5 は2026年に廃止されたため、後継の Creators API を使う。
// 必要な値: AMAZON_CREDENTIAL_ID, AMAZON_CREDENTIAL_SECRET, AMAZON_PARTNER_TAG(例: yourtag-22)
// AMAZON_CREDENTIAL_VERSION は Creators API の画面に出る認証情報のバージョン(日本は 3.3 か 2.3)

const API = "https://creatorsapi.amazon/catalog/v1";
const MARKETPLACE = "www.amazon.co.jp";
const TOKEN_URL = {
  "3.3": "https://api.amazon.co.jp/auth/o2/token", // Login with Amazon(新しい認証情報)
  "2.3": "https://creatorsapi.auth.us-west-2.amazoncognito.com/oauth2/token", // Cognito(古い認証情報)
};
const RESOURCES = [
  "itemInfo.title",
  "images.primary.medium",
  "images.primary.large",
  "offersV2.listings.price",
  "offersV2.listings.availability",
];

export const amazonReady = (env) => Boolean(env.AMAZON_CREDENTIAL_ID && env.AMAZON_CREDENTIAL_SECRET && env.AMAZON_PARTNER_TAG);

// トークンは1時間有効。同じ Worker の中では使い回す
let cached = { token: null, until: 0, id: null };

async function token(env) {
  if (cached.token && cached.id === env.AMAZON_CREDENTIAL_ID && Date.now() < cached.until) return cached.token;
  const ver = env.AMAZON_CREDENTIAL_VERSION || "3.3";
  const url = TOKEN_URL[ver];
  if (!url) throw new Error("AMAZON_CREDENTIAL_VERSION は 3.3 か 2.3 にしてください");
  const scope = ver.startsWith("3.") ? "creatorsapi::default" : "creatorsapi/default";
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: "Basic " + btoa(`${env.AMAZON_CREDENTIAL_ID}:${env.AMAZON_CREDENTIAL_SECRET}`),
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error("Amazonの認証に失敗: " + (d.error_description || d.error || r.status));
  cached = { token: d.access_token, until: Date.now() + (Number(d.expires_in || 3600) - 120) * 1000, id: env.AMAZON_CREDENTIAL_ID };
  return d.access_token;
}

async function call(env, op, body) {
  const ver = env.AMAZON_CREDENTIAL_VERSION || "3.3";
  const t = await token(env);
  const r = await fetch(`${API}/${op}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: ver.startsWith("3.") ? `Bearer ${t}` : `Bearer ${t}, Version ${ver}`,
      "x-marketplace": MARKETPLACE,
    },
    body: JSON.stringify({ partnerTag: env.AMAZON_PARTNER_TAG, marketplace: MARKETPLACE, resources: RESOURCES, ...body }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { error: "amazon_error", message: d?.errors?.[0]?.message || d?.Errors?.[0]?.Message || d?.message || "HTTP " + r.status };
  return d;
}

// 項目名は PA-API 5 の名前を小文字始まりにしたもの。念のため大文字始まりも読む
const pick = (o, ...keys) => keys.reduce((v, k) => (v == null ? v : v[k] ?? v[k[0].toUpperCase() + k.slice(1)]), o);

export function normalizeAmazon(it) {
  const listing = pick(it, "offersV2", "listings")?.[0];
  const price = Number(pick(listing, "price", "money", "amount") ?? pick(listing, "price", "amount"));
  return {
    item_code: "amazon:" + pick(it, "asin"),
    store: "Amazon",
    name: pick(it, "itemInfo", "title", "displayValue") || "",
    price: Number.isFinite(price) ? Math.round(price) : 0,
    postage_included: null, // 送料はAmazonの注文画面で決まる
    shop: "Amazon.co.jp",
    review: null,
    url: pick(it, "detailPageURL") || pick(it, "detailPageUrl"),
    image: pick(it, "images", "primary", "medium", "url") || pick(it, "images", "primary", "large", "url"),
  };
}

const itemsOf = (d, key) => (pick(d, key, "items") || []).map(normalizeAmazon).filter((x) => x.url && x.price > 0);

export async function amazonSearch(env, input) {
  const body = { keywords: String(input.keyword || "").slice(0, 100), itemCount: 5, searchIndex: "All" };
  // 価格は「最小の通貨単位」で指定する。円には銭がないので、円のまま
  if (input.max_price) body.maxPrice = input.max_price | 0;
  if (input.min_price) body.minPrice = input.min_price | 0;
  if (input.sort === "+itemPrice") body.sortBy = "Price:LowToHigh";
  else if (input.sort === "-reviewAverage" || input.sort === "-reviewCount") body.sortBy = "AvgCustomerReviews";
  const d = await call(env, "searchItems", body);
  if (d.error) return d;
  return itemsOf(d, "searchResult");
}

export async function amazonItem(env, asin) {
  const d = await call(env, "getItems", { itemIds: [String(asin)] });
  if (d.error) return null;
  return itemsOf(d, "itemsResult")[0] || null;
}
