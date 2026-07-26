# ecommerce-platform-scraper

[English](README.md) · **简体中文** · [繁體中文](README.zh-Hant.md)

按**平台**组织的电子商务店面抓取工具包。

多数店面并不是跑在定制代码上，而是跑在某个电商 SaaS 上。共用同一套引擎的站点，其
URL 形态、CDN
规律、站点地图结构和图库标记都是相通的。本工具包把这套引擎当作复用单元：你声明某个站点跑在哪个平台上，继承该平台的默认值，只覆盖真正有差异的部分。

它**与业务领域无关**。这里没有任何东西知道你在提取什么——角色词汇表、提取结构和输出模型全都由你定义。

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

目前还没有发布到包仓库——请克隆下来，从源码导入：

```bash
git clone <this-repo> ecommerce-platform-scraper
cd ecommerce-platform-scraper
deno task check   # fmt, lint, type-check, tests
```

```ts
import { defineShoplineSource, PoliteFetcher } from "./src/mod.ts";
```

一旦发布，说明符就会变成
`jsr:@casys/ecommerce-platform-scraper`；脚手架生成出来的已经是这种形式，可以用
`--import` 覆盖。

## 快速开始

在受支持的平台上声明一个来源：

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

SHOPLINE 的默认值——双 CDN 图像提示、OCR 前置的图像选择器、在 `/sitemap.xml`
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

// Same fetcher for robots.txt as for the pages: the courtesy applies to both.
const rules = parseRobotsTxt(
  await fetcher.fetchText("https://shop.example.test/robots.txt"),
);

const path = "/products/thing";
if (!isDisallowed(rules, path)) {
  const html = await fetcher.fetchText(`https://shop.example.test${path}`);
}
```

## 添加一个来源

三条命令，按顺序来。每一条都回答一个问题——否则下一条就得让你去猜。

### 1. 看一眼真实的页面

```
deno task inspect https://shop.example.test/products/thing
```

它会报告页面实际包含什么：跑的是哪个电商引擎（从图像主机名看出来）、有没有
Product JSON-LD
块、商品路径的形态、懒加载图像的数量、看起来像法规标签的文件名。最后它会把这些观察结果所指向的
`scaffold` 命令打印出来。

它打印出来的每一项都是带明确理由的观察结果——绝不是猜测。如果某个信号不存在，它就说它不存在，而不是拿一个看似合理的默认值把它填上。传
`--file page.html --url <url>` 可以分析你已经保存下来的页面，`--json`
则输出机器可读的格式。

在把某个提示定下来之前，先拿第二个商品页面确认一遍。一个页面还称不上一种规律。

### 2. 问一问已经有什么

```
deno task primitives                    # everything, grouped by axis
deno task primitives --axis images      # one axis
deno task primitives --search robots    # substring over names and summaries
```

在动手写任何本地代码之前先跑这个。它要防的失败是：把一个本来就已经存在的原语重新实现一遍——这种事之所以发生，是因为文档被人一眼扫过，而不是因为谁真的决定这么干。

有一个测试会断言：目录和公开导出描述的是完全相同的一组符号，所以只加导出而不把它登进目录，整套测试就会失败。正是这一点让这个答案值得信任。

### 3. 生成骨架

如果你信得过第 1 步查出来的东西，那就跳过复制粘贴——`inspect`
可以直接把结果交接过去：

```
deno task inspect <url> --scaffold --name example --out sources/example/mod.ts
```

一条命令，从一个 URL 直接得到一份能编译通过的骨架。`--name`
是它唯一不会替你臆造的东西：这个标识符由你自己定，从主机名猜出来的名字，你马上就会想改掉。

想先过一遍答案，或者想在完全不做检查的情况下生成脚手架，就单独跑它。它会问你几个问题，然后写出同样的骨架——每个字段都在，并且逐个标注了本该放在那里的原语：

```
deno task scaffold --out sources/example/mod.ts
```

每个答案同时也是一个命令行标志，所以同一条命令放进脚本里也能无人值守地跑起来：

```
deno task scaffold --yes --name example --host shop.example.test \
  --platform shopline --out sources/example/mod.ts
```

它产出的形态有两种。在**已知引擎**上，你拿到的是一次对该引擎工厂函数的调用，只声明引擎推断不出来的部分。在
**custom**
上，你拿到的是完整契约的逐项展开，因为没有引擎可以继承，也没有任何东西能替你填好。

注意它和工厂函数的区别：脚手架生成的是代码，之后由你去改；而工厂函数藏起来的是你永远不用写的代码。对于没有共用引擎的站点，没有什么可藏的，所以骨架会把每一项都摆出来。它做不到的是猜出你那个站点的
HTML 怎么产出一件商品——这部分仍然归你。

生成出来的骨架在每个能力字段里都填着
`null`，那是一个有效的答案，而不是占位符。**[选择原语](docs/choosing-primitives.md)**
讲的就是怎么决定该往那里放什么，以及什么时候把 `null` 留着才是对的。

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

整个设计由两个想法支撑。

**角色由你定，机制由我们管。** _artifact_ 是从页面上捕获的一个片段；_role_
说明它是干什么用的。抓保健品需要一个“营养标签”角色，抓电子元件需要“规格书”。所以内核负责分类、选择和回退，词汇表由你提供：

```ts
import { BASE_ARTIFACT_ROLES, defineRoleVocabulary } from "./src/mod.ts";

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

把 `.env.example` 复制成 `.env`。没有任何东西会替你加载它——请给 `deno run` 传
`--env-file=.env`，或者自己把这些变量 export 出去——因为一个悄悄读取 dotenv
文件的库，会让嵌入它的进程措手不及。

有四个变量是必填的——`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL`、`LLM_VISION_MODEL`——缺了其中任何一个，会在启动时就失败，而不是跑到一半才失败。`LLM_REQUEST_TIMEOUT_MS`
是唯一可选的那个。

**本地还是托管，代码都一样。** `LLM_BASE_URL` 指向任意 OpenAI 兼容
API，所以本地运行时（`http://localhost:11434/v1`）、自建服务器、托管服务商，对工具包来说都是一回事。在它们之间迁移只需要改一个环境变量。

**两个模型槽位，自动路由。** `LLM_MODEL` 负责文本，`LLM_VISION_MODEL`
负责带图像的调用，客户端按一次调用里有没有图像在两者之间做选择。把它们分开，是为了改动其中一个不会悄悄影响另一个。

两者都是在构造客户端时从环境里读取的，所以单个进程同一时间只跑一个服务商、一对模型。想并排跑两个服务商，或者按调用点各自挑一个更便宜的模型，就得把配置作为参数传进来，而不是从环境里读——在你围绕它做规划之前，这一点值得先知道。

`LLM_BASE_URL`
**故意不设默认值**。一个静默的回退值可能把你的数据发给一个你从未选择的服务商，那比第一次调用时收到一条错误信息更糟。

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
