# ecommerce-platform-scraper

[English](README.md) · [简体中文](README.zh-Hans.md) · **繁體中文**

按**平台**組織的電子商務店面抓取工具組。

大多數店面並不是跑在客製化的程式碼上，而是跑在某套電商 SaaS
上。共用同一套引擎的網站，URL 形式、CDN
樣式、網站地圖結構與圖庫標記都是相通的。本工具組把這套引擎當成重用單元：你宣告某個網站跑在哪個平台上，繼承該平台的預設值，只覆寫真正不一樣的部分。

它與應用領域無關。這裡沒有任何東西知道你在擷取什麼——角色詞彙表、擷取結構與輸出模型全都由你決定。

## 它為什麼可能對你有用

- **平台轉接器，而不是逐站腳本。**
  把一個跑在已支援引擎上的網站接進來，寫的是一份宣告，而不是一個新的剖析器。
- **多模態、多模型。**
  法規與規格資訊常常藏在*影像*裡——包裝盒背面的一張照片——而不在 HTML
  裡。本工具組把文字導向一個模型，把影像導向另一個獨立的視覺模型，一律走任何
  OpenAI 相容的端點。換供應商或換模型是改環境設定，不是改程式碼。
- **明確表達「沒有」。** 能力欄位是必填但可為 null：`null`
  的意思是「刻意不提供，而且已經審核過」。往契約裡新增一項能力，會讓所有漏掉它的來源編譯失敗，因此不會有東西被默默跳過。
- **明顯地失敗。**
  候選清單為空時會丟出例外，而不是什麼都沒抓到就結束——否則這種失敗模式會讓你白跑完一整輪才發現。

## 安裝

需要 [Deno](https://deno.com/) 2.x。

```ts
import {
  defineShoplineSource,
  PoliteFetcher,
} from "jsr:@casys/ecommerce-platform-scraper";
```

## 快速開始

在支援的平台上宣告一個來源：

```ts
import { defineShoplineSource } from "./src/platforms/shopline.ts";

export const source = defineShoplineSource({
  name: "example",
  rawHost: "shop.example.test",
  productUrlRegex: /^https:\/\/shop\.example\.test\/products\/([^/?#]+)/u,
  imageCandidateSelector: null,
  projectionProviders: { artifactContext: null, structuredFacts: null },
  pipelineFns: { download: { siteUrl: "https://shop.example.test" } },
});
```

Shopline 的預設值——雙 CDN 影像提示、OCR 前置的影像選擇器、在 `/sitemap.xml`
進行網站地圖探索——都已經填好。你覆寫的值優先於預設值。

有禮貌地爬取，順手也檢查一下 `robots.txt`：

```ts
import { isDisallowed, parseRobotsTxt, PoliteFetcher } from "./src/mod.ts";

const fetcher = new PoliteFetcher({
  // Identify yourself and leave a way to be reached. Reachable operators get
  // blocked far less often than anonymous ones.
  userAgent: "acme-bot/1.0 (+https://acme.example/bot)",
  minIntervalMs: 1_000,
});

const rules = parseRobotsTxt(await (await fetch(robotsUrl)).text());
if (!isDisallowed(rules, "/products/")) {
  const page = await fetcher.fetchText(productUrl);
}
```

## 為新來源產生骨架

`deno task scaffold` 會問你幾個問題，然後寫出一份 `SourceModule`
骨架——每個欄位都在，並且逐一註明了該處該用的原語。

```
deno task scaffold --out sources/example/mod.ts
```

答案也可以用命令列旗標傳進去，所以同一道命令也能無人看顧地跑起來：

```
deno task scaffold --yes --name example --host shop.example.test \
  --platform shopline --out sources/example/mod.ts
```

它產出的形態有兩種。在**已知引擎**上，你拿到的是一次對該引擎工廠函式的呼叫，只宣告引擎推斷不出來的部分。在
**custom**
上，你拿到的是完整契約的逐項攤開，因為沒有引擎可以繼承，也沒有任何東西能替你填好。

注意它和工廠函式的差別：骨架產生器產生出程式碼，之後由你去改；而工廠函式藏起來的是你永遠不必寫的程式碼。對於沒有共用引擎的網站，沒有什麼可藏的，所以骨架會把每一項都攤開來給你看。它做不到的是猜出你的網站的
HTML 怎麼產出一件商品——這部分仍然是你的工作。

## 平台支援

| 平台         | 提供什麼                                                                       | 成熟度                                                                       |
| ------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| **SHOPLINE** | `defineShoplineSource()`——引擎預設值，含一個共用的 OCR 前置影像選擇器          | 支援最完整。覆蓋範圍遙遙領先：SHOPLINE 的商家遍布亞太乃至更廣的區域。        |
| **BV SHOP**  | `defineBvShopSource()`，外加 `item/query` 這個搭配的 JSON 端點及其 cookie 處理 | 穩固，但只是一個規模不大、僅限台灣的平台。除非你要抓那邊的網站，否則很小眾。 |
| **CYBERBIZ** | `defineCyberbizSource()`，外加基於標記上下文的影像分類                         | 良好。影像選擇是刻意留給各個來源自己決定——見下文。                           |

**為什麼 CYBERBIZ 不替影像選擇器設預設值。**
在這套引擎上，頁面內文出自富文字編輯器，而各家商店往裡面塞多少行銷圖片差異極大。沒有任何一條保留／捨棄規則能通用於所有商店，所以
`imageCandidateSelector`
維持必填，各個來源用模組裡的輔助函式自己組一套。給它一個預設值等於掩蓋店面之間真實存在的差異，那比要求呼叫方自己決定更糟。SHOPLINE
的標記一致到同一個問題有一個共用答案，所以它的工廠函式*確實*帶了預設值。

## 架構

```
kernel/          source contract, discovery, sitemap, HTTP, raw storage,
                 image candidates, artifact context
  llm/           multi-model client, text/vision routing, typed errors
  ocr/           OcrProvider interface + Apple Vision implementation
platforms/       shopline · bvshop · cyberbiz
presets/         reusable strategies, named by shape not by site
locales/         zh-TW OCR quality checks
cli/             scaffold: renders a SourceModule skeleton
```

整個設計由兩個想法撐起來。

**角色由你定，機制由我們管。** _artifact_ 是從頁面上擷取下來的一個片段；_role_
說明它是做什麼用的。抓保健食品需要一個「營養標示」角色，抓電子元件需要「規格書」。所以核心負責分類、挑選與備援，詞彙表由你提供：

```ts
const vocabulary = defineRoleVocabulary({
  roles: [...BASE_ARTIFACT_ROLES, "datasheet"],
  preferences: { specs: ["html", "datasheet", "product-description"] },
});
```

**凡是外部的東西都是介面。** 候選商品來自
`CandidateSource`，所以工具組本身不帶任何資料庫 schema。OCR 來自
`OcrProvider`，所以沒有哪個引擎享有特權。LLM 客戶端可以對接任何 OpenAI
相容的端點。隨部署而異的東西是注入進來的，不是預設假定的。

## 設定

複製 `.env.example`。四個 LLM 變數全部必填——包括
`LLM_BASE_URL`，它**故意沒有預設值**：默默套用的備援值可能把你的資料送到一個你從未選擇的供應商。

## 已知限制

直說，因為這些會是你最先撞上的問題。

- **OCR 只內建一個引擎，而且需要 macOS。** Apple Vision 藏在 `OcrProvider`
  介面後面，但它目前是唯一的實作，而且需要裝有 Xcode 命令列工具的 macOS。在
  Linux 或 Windows 上，`available()` 會回傳
  `false`，你必須自行提供自己的實作。跨平台引擎是這個儲存庫最需要的貢獻。
- **預設策略給你的是骨架，不是剖析器。** 對於沒有可用 JSON-LD 的網站，DOM
  剖析的成本仍然由你承擔。這裡沒有任何東西能替你省掉。
- **速率限制是固定間隔。** 沒有隨機抖動，沒有指數退避，也不理會
  `Retry-After`。對不做限速的網站夠用；在把它指向會回應 429
  的網站之前，請先強化這一塊。

## 適用範圍

本工具組抓取公開可存取的頁面並把它們結構化。它內建速率限制與 `robots.txt`
剖析，因為抓取不屬於自己的東西時，這些是最低要求——遵守網站的服務條款、其爬取指示以及適用法律，是操作者的責任。

綜合型購物平台刻意不在範圍內：在那裡，頁面樣板屬於平台而不是賣家，所以有用的單元會是每個平台一個轉接器，而不是每家商店一個。

## 授權

MIT——見 [LICENSE](LICENSE)。
