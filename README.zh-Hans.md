# ecommerce-platform-scraper

[English](README.md) · **简体中文** · [繁體中文](README.zh-Hant.md)

按**平台**组织的电子商务店面抓取工具包。

多数店面并不是跑在定制代码上，而是跑在某个电商 SaaS 上。共用同一套引擎的站点，其
URL 形态、CDN
规律、站点地图结构和图库标记都是相通的。本工具包把这套引擎当作复用单元：你声明某个站点跑在哪个平台上，继承该平台的默认值，只覆盖真正有差异的部分。

它与业务领域无关。这里没有任何东西知道你在提取什么——角色词汇表、提取结构和输出模型全都由你定义。

## 它为什么可能对你有用

- **平台适配器，而不是逐站脚本。**
  把一个跑在已支持引擎上的站点接进来，写的是一份声明，而不是一个新的解析器。
- **多模态、多模型。**
  法规和规格信息往往藏在*图像*里——包装盒背面的一张照片——而不在 HTML
  中。工具包把文本路由给一个模型，把图像路由给另一个独立的视觉模型，走的都是任意
  OpenAI 兼容端点。换服务商或换模型是改环境配置，不是改代码。
- **显式表达“没有”。** 能力字段是必填但可为 null 的：`null`
  的含义是“刻意缺省，且已审核过”。往契约里加一项新能力，会让所有漏掉它的来源编译失败，因此不会有任何东西被悄悄跳过。
- **大声失败。**
  候选列表为空时会抛异常，而不是什么都没抓到就结束——否则这种失败模式要等你跑完一整轮才会被发现。

## 安装

需要 [Deno](https://deno.com/) 2.x。

```ts
import {
  defineShoplineSource,
  PoliteFetcher,
} from "jsr:@casys/ecommerce-platform-scraper";
```

## 快速开始

在受支持的平台上声明一个来源：

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

Shopline 的默认值——双 CDN 图像提示、OCR 前置的图像选择器、在 `/sitemap.xml`
上做站点地图发现——都已经填好。你写的覆盖值优先于默认值。

礼貌地爬取，顺手把 `robots.txt` 也检查一下：

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

## 为新来源生成脚手架

`deno task scaffold` 会问你几个问题，然后写出一份 `SourceModule`
骨架——每个字段都在，并且逐个标注了本该放在那里的原语。

```
deno task scaffold --out sources/example/mod.ts
```

答案也可以用命令行标志传进去，所以同一条命令也能无人值守地跑起来：

```
deno task scaffold --yes --name example --host shop.example.test \
  --platform shopline --out sources/example/mod.ts
```

它产出的形态有两种。在**已知引擎**上，你拿到的是一次对该引擎工厂函数的调用，只声明引擎推断不出来的部分。在
**custom**
上，你拿到的是完整契约的逐项展开，因为没有引擎可以继承，也没有任何东西能替你填好。

注意它和工厂函数的区别：脚手架生成的是代码，之后由你去改；而工厂函数藏起来的是你永远不用写的代码。对于没有共用引擎的站点，没有什么可藏的，所以骨架会把每一项都摆出来。它做不到的是猜出你那个站点的
HTML 怎么产出一件商品——这部分仍然归你。

## 平台支持

| 平台         | 提供了什么                                                                   | 成熟度                                                                       |
| ------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **SHOPLINE** | `defineShoplineSource()`——引擎默认值，含一个共享的 OCR 前置图像选择器        | 支持最完善。覆盖面遥遥领先：SHOPLINE 服务的商家遍布亚太乃至更广的地区。      |
| **BV SHOP**  | `defineBvShopSource()`，外加 `item/query` 这个配套 JSON 端点及其 cookie 处理 | 扎实，但只是一个规模不大、仅限台湾的平台。除非你要抓那边的站点，否则很小众。 |
| **CYBERBIZ** | `defineCyberbizSource()`，外加基于标记上下文的图像分类                       | 良好。图像选择是刻意留给各个来源自己决定的——见下文。                         |

**为什么 CYBERBIZ 不给图像选择器设默认值。**
在这个引擎上，页面正文出自富文本编辑器，而各家店铺往里塞多少营销图片差别极大。没有哪一条留/弃规则能通吃所有店铺，所以
`imageCandidateSelector`
保持必填，各个来源用模块里的辅助函数自己组一套。给它一个默认值等于掩盖店面之间真实存在的差异，那比让调用方自己决定更糟。SHOPLINE
的标记足够统一，同一个问题有一个共享答案，所以它的工厂函数*确实*带了默认值。

## 架构

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

整个设计由两个想法支撑。

**角色由你定，机制由我们管。** _artifact_ 是从页面上捕获的一个片段；_role_
说明它是干什么用的。抓保健品需要一个“营养标签”角色，抓电子元件需要“规格书”。所以内核负责分类、选择和回退，词汇表由你提供：

```ts
const vocabulary = defineRoleVocabulary({
  roles: [...BASE_ARTIFACT_ROLES, "datasheet"],
  preferences: { specs: ["html", "datasheet", "product-description"] },
});
```

**凡是外部的东西都是接口。** 候选商品来自
`CandidateSource`，所以工具包本身不带任何数据库 schema。OCR 来自
`OcrProvider`，所以没有哪个引擎享有特权。LLM 客户端可以对接任意 OpenAI
兼容端点。随部署而变的东西是注入进来的，不是假定出来的。

## 配置

复制 `.env.example`。四个 LLM 变量全部必填——包括
`LLM_BASE_URL`，它**故意不设默认值**：一个静默的兜底值可能把你的数据发给一个你从未选择的服务商。

## 已知限制

直说，因为这些会是你最先撞上的东西。

- **OCR 只自带一个引擎，而且需要 macOS。** Apple Vision 位于 `OcrProvider`
  接口之后，但它目前是唯一的实现，并且需要装有 Xcode 命令行工具的 macOS。在
  Linux 或 Windows 上，`available()` 返回
  `false`，你必须自行提供自己的实现。一个跨平台引擎是本仓库最需要的贡献。
- **预设策略给你的是脚手架，不是解析器。** 对于没有可用 JSON-LD 的站点，DOM
  解析的成本仍然由你承担。这里没有任何东西能替你省掉它。
- **限流是固定间隔的。** 没有抖动，没有指数退避，也不遵守
  `Retry-After`。对不做限速的站点够用；在把它对准会返回 429
  的站点之前，先把这部分加固。

## 适用范围

本工具包抓取公开可访问的页面并把它们结构化。它自带限流和 `robots.txt`
解析，因为抓取不属于自己的东西时，这些是底线——遵守站点的服务条款、其爬取指令以及适用法律，是操作者的责任。

综合型交易平台被刻意排除在范围之外：在那里，页面模板属于平台而不属于卖家，所以有用的单元会是每个平台一个适配器，而不是每家店一个。

## 许可证

MIT——见 [LICENSE](LICENSE)。
