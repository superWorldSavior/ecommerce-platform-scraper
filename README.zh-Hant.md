# ecommerce-platform-scraper

[English](README.md) · [简体中文](README.zh-Hans.md) · **繁體中文**

按**平台**組織的電子商務店面抓取工具組。

大多數店面並不是跑在客製化的程式碼上，而是跑在某套電商 SaaS
上。共用同一套引擎的網站，URL 形式、CDN
樣式、網站地圖結構與圖庫標記都是相通的。本工具組把這套引擎當成重用單元：你宣告某個網站跑在哪個平台上，繼承該平台的預設值，只覆寫真正不一樣的部分。

它**與應用領域無關**。這裡沒有任何東西知道你在擷取什麼——角色詞彙表、擷取結構與輸出模型全都由你決定。

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

尚未發布到任何套件登錄中心——請自行 clone 下來，直接從原始碼匯入：

```bash
git clone <this-repo> ecommerce-platform-scraper
cd ecommerce-platform-scraper
deno task check   # fmt, lint, type-check, tests
```

```ts
import { defineShoplineSource, PoliteFetcher } from "./src/mod.ts";
```

發布之後，匯入指定字串會變成
`jsr:@casys/ecommerce-platform-scraper`；骨架產生器已經直接產出這個形式，可以用
`--import` 覆寫。

## 快速開始

在支援的平台上宣告一個來源：

```ts
import { defineShoplineSource } from "./src/mod.ts";

export const source = defineShoplineSource({
  name: "example",
  rawHost: "shop.example.test",
  productUrlRegex: /^https:\/\/shop\.example\.test\/products\/([^/?#]+)/u,
  // imageCandidateSelector omitted on purpose: omitting it takes the engine
  // default. Passing `null` would mean "deliberately no selection".
  projectionProviders: { artifactContext: null, structuredFacts: null },
  pipelineFns: { download: { siteUrl: "https://shop.example.test" } },
});
```

SHOPLINE 的預設值——雙 CDN 影像提示、OCR 前置的影像選擇器、在 `/sitemap.xml`
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

// Same fetcher for robots.txt as for the pages: the courtesy applies to both.
const rules = parseRobotsTxt(
  await fetcher.fetchText("https://shop.example.test/robots.txt"),
);

const path = "/products/thing";
if (!isDisallowed(rules, path)) {
  const html = await fetcher.fetchText(`https://shop.example.test${path}`);
}
```

## 新增一個來源

三道命令，依序執行。每一道都回答了一個問題；少了它，下一道就只能靠你猜。

### 1. 看一眼真實頁面

```
deno task inspect https://shop.example.test/products/thing
```

它會回報這個頁面實際包含什麼：是哪套電商引擎（從影像主機判斷）、有沒有 Product
JSON-LD
區塊、商品路徑的形式、延遲載入的影像數量、看起來像法規標示的檔名。最後它會印出這些觀察結果所對應的
`scaffold` 命令。

它印出來的每一項都是附帶明確理由的觀察結果——絕不是猜測。某個訊號不存在時，它會直說，而不是替你補上一個看似合理的預設值。傳入
`--file page.html --url <url>` 可以分析你已經存下來的頁面，`--json`
則輸出機器可讀的格式。

在把某個提示定下來之前，先拿第二個商品頁面確認一次。一個頁面構不成規律。

### 2. 先問問已經有什麼

```
deno task primitives                    # everything, grouped by axis
deno task primitives --axis images      # one axis
deno task primitives --search robots    # substring over names and summaries
```

在自己動手寫任何東西之前先跑這道命令。它存在的目的是防止這種失誤：重新實作一個早就存在的原語——而這種事之所以發生，是因為文件被一目十行地掃過去，不是因為誰真的做了這個決定。

有一項測試會斷言目錄與公開匯出描述的是完全相同的一組符號，所以新增了匯出卻沒有把它登錄進目錄，測試就會失敗。正是這一點讓這份答案值得信任。

### 3. 產生骨架

如果你信得過第 1 步找到的結果，就別再複製貼上了——`inspect` 可以直接交棒：

```
deno task inspect <url> --scaffold --name example --out sources/example/mod.ts
```

一道命令，從一個 URL 直接到一份編譯得過的骨架。`--name`
是它唯一不會自己編出來的東西：這個識別字該由你決定，而從主機名稱猜出來的名字，你拿到手馬上就會改掉。

想先檢視這些答案，或是不做任何檢視就直接產生骨架，那就單獨執行它。它會問你幾個問題，然後寫出同樣的骨架——每個欄位都在，並且逐一註明了該處該用的原語：

```
deno task scaffold --out sources/example/mod.ts
```

每個答案也都有對應的旗標，所以同一道命令也能在腳本裡無人看顧地跑起來：

```
deno task scaffold --yes --name example --host shop.example.test \
  --platform shopline --out sources/example/mod.ts
```

它產出的形態有兩種。在**已知引擎**上，你拿到的是一次對該引擎工廠函式的呼叫，只宣告引擎推斷不出來的部分。在
**custom**
上，你拿到的是完整契約的逐項攤開，因為沒有引擎可以繼承，也沒有任何東西能替你填好。

注意它和工廠函式的差別：骨架產生器產生出程式碼，之後由你去改；而工廠函式藏起來的是你永遠不必寫的程式碼。對於沒有共用引擎的網站，沒有什麼可藏的，所以骨架會把每一項都攤開來給你看。它做不到的是猜出你的網站的
HTML 怎麼產出一件商品——這部分仍然是你的工作。

產出的骨架在每個能力欄位都填著
`null`，那是一個有效的答案，不是佔位符。**[選擇原語](docs/choosing-primitives.md)**
告訴你該在那裡放什麼，以及什麼時候留著 `null` 才是對的選擇。

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
src/
  kernel/        source contract, discovery, sitemap, HTTP, raw storage,
                 image candidates, artifact context
    llm/         multi-model client, text/vision routing, typed errors
    ocr/         OcrProvider interface + Apple Vision implementation
  platforms/     shopline · bvshop · cyberbiz
  presets/       reusable strategies, named by shape not by site
  locales/       zh-TW OCR quality checks
  cli/           inspect · primitives · scaffold
docs/            choosing-primitives: filling in the skeleton
tests/
```

整個設計由兩個想法撐起來。

**角色由你定，機制由我們管。** _artifact_ 是從頁面上擷取下來的一個片段；_role_
說明它是做什麼用的。抓保健食品需要一個「營養標示」角色，抓電子元件需要「規格書」。所以核心負責分類、挑選與備援，詞彙表由你提供：

```ts
import { BASE_ARTIFACT_ROLES, defineRoleVocabulary } from "./src/mod.ts";

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

把 `.env.example` 複製成 `.env`。沒有任何東西會替你載入它——請在 `deno run` 加上
`--env-file=.env`，或是自己 export 這些變數——因為一個會默默讀取 dotenv
檔的函式庫，會讓嵌入它的程序措手不及。

有四個變數是必填的——`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`LLM_VISION_MODEL`——少了任何一個，會在啟動時就失敗，而不是跑到一半才失敗。`LLM_REQUEST_TIMEOUT_MS`
是唯一可選的。

**本機或雲端，同一份程式碼。** `LLM_BASE_URL` 指向任何 OpenAI 相容的
API，所以本機執行環境（`http://localhost:11434/v1`）、自架伺服器，或是雲端供應商，對本工具組來說都是一樣的。在它們之間搬移就是改一個環境變數的事。

**兩個模型槽位，自動路由。** `LLM_MODEL` 負責文字，`LLM_VISION_MODEL`
負責帶有影像的呼叫，客戶端則依這次呼叫有沒有帶影像在兩者之間挑選。它們之所以分開，是為了讓改動其中一個不會默默影響到另一個。

兩者都是在建構客戶端時從環境變數讀進來的，所以單一程序在同一時間只跑一個供應商、一組模型。想並行兩個供應商，或是在不同呼叫點各挑一個比較便宜的模型，就得改成把設定傳進去，而不是從環境變數讀——在你據此做規劃之前，這一點值得先知道。

`LLM_BASE_URL`
刻意**沒有預設值**。默默套用的備援值可能把你的資料送到一個你從未選擇的供應商，那個結果比第一次呼叫就看到一則錯誤訊息還糟。

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
