# 商户自唤起 Google Pay / Apple Pay

本目录是给**有自对接能力**的商户的独立交付包（例如小程序环境不能引入第三方 JS）。

网页端 / App WebView 商户请继续使用仓库内 [`output/`](../output/)（`pay.min.js` + SDK 文档），**不要**用本目录替换那条路径。

## 适用对象

| 你的场景                                                   | 用哪个包                  |
| ---------------------------------------------------------- | ------------------------- |
| H5 / 浏览器收银台，可加载 `pay.min.js`                     | [`output/`](../output/)   |
| App 内嵌 WebView + Bridge                                  | [`output/`](../output/)   |
| 小程序或其它不能引入第三方 JS；要自己唤起官方 / 原生 GP/AP | **本目录 `self-wallet/`** |

## 阅读顺序

1. [`WALLET_API.md`](./WALLET_API.md) — 全流程、创单字段、支付 / 查单 / 域名校验契约、风控、默认值
2. [`html/README.md`](./html/README.md) — 参考 HTML（钱包页、WorldPay DDC、3DS 壳页）怎么用
3. Google Pay / Apple Pay **官方接入细节**见 `WALLET_API.md` 中的官方链接（本包不复述官方教程）

## 目录

```text
self-wallet/
  README.md
  WALLET_API.md
  html/
    README.md
    google-pay.html
    apple-pay.html
    worldpay-ddc.html
    3ds-challenge.html
    3ds-method.html
```

## 一句话流程

商户服务端签名**创建订单** → 拿到 `paymentScript` / `token` / `risk` → 按官方文档自己唤起 GP/AP →（Apple 再调域名校验）→ 拼装支付请求 → 如有二次动作则开壳页并轮询订单详情。
