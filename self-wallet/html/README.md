# 自对接参考 HTML

本目录页面**不加载** Alchemy `pay.min.js`。钱包页只加载 Google / Apple 官方脚本；对接细节见官方文档与上级 [`WALLET_API.md`](../WALLET_API.md)。

| 文件                                         | 用途                                                      |
| -------------------------------------------- | --------------------------------------------------------- |
| [`google-pay.html`](./google-pay.html)       | Google Pay 参考页（可 iframe / 二级 WebView）             |
| [`apple-pay.html`](./apple-pay.html)         | Apple Pay 参考页                                          |
| [`worldpay-ddc.html`](./worldpay-ddc.html)   | WorldPay / Cardinal DDC 隐藏采集页                        |
| [`3ds-challenge.html`](./3ds-challenge.html) | 支付返回 `MD`+`JWT`+`action` 时的 Challenge 壳页          |
| [`3ds-method.html`](./3ds-method.html)       | 支付返回 `threeDSMethodData`+`methodUrl` 时的 Method 壳页 |

---

## 1. 钱包页（google-pay / apple-pay）

### 父页传入创单数据

子页加载后，父页（或 Native）通过 `postMessage` 发送：

```js
iframe.contentWindow.postMessage(
  {
    type: 'self-wallet:init',
    apiBase: 'https://api-test.alchemytech.cc', // 或生产根域名
    order: {
      /* 创建订单响应 data：orderNo, paymentScript, token, environment, risk, validateMerchantUrl? */
    }
  },
  targetOrigin // 建议写死子页 origin，勿用 '*'
)
```

子页在用户点击后唤起钱包，调支付 /（Apple）域名校验 / 可选查单，再回传：

```js
parent.postMessage(
  {
    type: 'self-wallet:result',
    status: 'success' | 'error' | 'action'
    // success: 可带 payResponse
    // error: message
    // action: { kind: 'webUrl'|'threeDS'|'threeDSMethod', ...fields }
  },
  parentOrigin
)
```

### 注意

- **不要**在这些页引入 `pay.min.js`。
- Google / Apple API 用法以官方文档为准（页内注释已附链接）。
- Apple Pay 页面 **HTTPS origin 须已在 Apple 登记**；若与 merchant session 的 `domainName` 不一致，校验会失败。
- 风控脚本采集（Fingerprint / Forter / Checkout）可在父页完成，经 `order` 旁路字段传入，或在子页按 `risk` 自行采集；参考页对风控仅做注释占位，避免强绑第三方脚本。

---

## 2. WorldPay DDC（worldpay-ddc.html）

隐藏 1×1 iframe 加载本页后，父页：

```js
iframe.contentWindow.postMessage(
  {
    action: 'submitForm',
    Bin: binOrEmpty,
    JWT: worldPayJwt,
    actionUrl: 'https://centinelapi.cardinalcommerce.com/V1/Cruise/Collect'
  },
  targetOrigin
)
```

监听 Cardinal 回传，解析 `SessionId`，写入支付请求顶层 `sessionId`。仅当创单 `risk.worldPay.enabled === true` 且下发了 `jwt` 时需要。

---

## 3. 3DS 壳页

与收银台 SDK 壳页行为一致，便于自对接复用。

| 文件                 | 全局函数                         | 参数                               |
| -------------------- | -------------------------------- | ---------------------------------- |
| `3ds-challenge.html` | `window.__paySdkRenderChallenge` | `{ MD, JWT, action }`              |
| `3ds-method.html`    | `window.__paySdkRenderMethod`    | `{ threeDSMethodData, methodUrl }` |

典型用法：

1. 打开壳页 URL（自托管）。
2. 页加载完成后注入并调用上述函数（App 可用 `evaluateJavascript`；Web 可同页 `postMessage` 再调用）。
3. Challenge：向 `action` POST `MD`/`JWT`，目标为页内 iframe。
4. Method：隐藏 iframe POST `threeDSMethodData`；同时对订单详情接口轮询。

托管示例：

```text
https://merchant.example/self-wallet/html/3ds-challenge.html
https://merchant.example/self-wallet/html/3ds-method.html
```
