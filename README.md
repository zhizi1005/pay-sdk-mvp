# Pay SDK MVP

An embeddable browser JS SDK that runs a full **Google Pay / Apple Pay** payment
flow for merchants: wallet authorize → pay → poll status (create-order is done by
the merchant server). Works when loaded via `<script>` in a browser or an app WebView.

Written in **TypeScript**; bundled to a single IIFE file with Vite.

商户参数说明见 [output/PARAMETERS.md](output/PARAMETERS.md)（与
[docs/PARAMETERS.md](docs/PARAMETERS.md) 对齐）。接口契约见
[docs/pay-api/](docs/pay-api/)。内部未完成功能 / 后续迭代见
[docs/BACKLOG.md](docs/BACKLOG.md)。版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## Build

```bash
npm install
npm run build      # type-check, minify dist/pay.min.js, copy to output/ + output/ramp-pay/v1/
npm run typecheck  # type-check only
npm run demo       # build + serve demos at http://localhost:5173/
npm run format     # prettier write
```

## Demos

| 文件                                               | 说明                                                    |
| -------------------------------------------------- | ------------------------------------------------------- |
| [demo/index.html](demo/index.html)                 | 创建订单（demo 签名）；成功后跳确认页                   |
| [demo/confirm.html](demo/confirm.html)             | 查一次 order/detail → 挂载 SDK → 确认支付；终态跳结果页 |
| [demo/result.html](demo/result.html)               | 展示订单状态与金额等信息；可再来一单                    |
| [demo/3ds-challenge.html](demo/3ds-challenge.html) | App 二级 WebView 的 3DS Challenge 参考壳页              |
| [demo/3ds-method.html](demo/3ds-method.html)       | App 二级 WebView 的 3DS Method 参考壳页                 |
| [demo/redirectUrl.html](demo/redirectUrl.html)     | 二级页回跳 `redirectUrl` 落地页示例                     |
| [demo/callBackUrl.html](demo/callBackUrl.html)     | 二级页回跳 `callbackUrl` 落地页示例                     |

主流程三页右下角带 **vConsole**。共享凭据与签名见 [`demo/config.js`](demo/config.js)、[`demo/signed-api.js`](demo/signed-api.js)（仅 demo；生产勿用）。

## Usage

```html
<div id="pay-container"></div>
<script src="https://static.alchemypay.org/ramp-pay/v1/pay.min.js"></script>
<script>
  // Merchant server already created the order (signed). Pass response data here.
  const order = {
    orderNo: 'ord_xxx',
    token: 'payment-hub-token-from-create-order',
    paymentScript: {/* Google PaymentDataRequest from create-order */},
    risk: {/* optional */}
  }

  const sdk = RampPay.init({
    container: '#pay-container',
    order: order,
    api: {
      pollIntervalMs: 2000,
      pollTimeoutMs: 300000
    },
    onAction(action) {
      console.log(action)
    },
    onComplete(result) {
      console.log('flow complete', result.order?.orderState)
    },
    onSuccess(result) {
      console.log(result.orderNo, result.order?.orderState)
    },
    onError(error) {
      console.error(error)
    },
    onCancel() {
      console.log('cancelled')
    }
  })

  sdk.ready().then(() => sdk.mount())
</script>
```

**Create-order** is performed by the merchant server (API Sign). Pass the response
(including `token`) to `RampPay.init({ order })`. The SDK does **not** sign and does
**not** call create-order; verify / pay / detail requests send header
`payment-hub-token: <token>`.

Default API host is production (`api.alchemypay.org`; see [`src/endpoints.ts`](src/endpoints.ts)).
Omit `api` URLs unless you need a proxy override.

The create-order response selects Google Pay or Apple Pay and supplies wallet
`paymentScript`, `risk`, and `token`. Risk collection starts in `ready()` for
`enabled` vendors; the pay request awaits or reuses that result.

Secondary actions (`webUrl` / 3DS / method / `s3dsUrl`) trigger **`onAction` only**
(SDK does not auto-open). In App WebView, open a secondary WebView via Native
Bridge — see [output/WEBVIEW.md](output/WEBVIEW.md). Do **not** navigate the
cashier WebView to `webUrl` / `s3ds`.

## API

| Method                 | Description                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `RampPay.init(config)` | Validates `order` (+ optional `api`) and returns an SDK instance. `RampPay.version` matches `package.json` (see [CHANGELOG.md](CHANGELOG.md)). |
| `sdk.ready()`          | Uses the passed create-order response, starts risk prefetch, loads the selected wallet, checks availability.                                   |
| `sdk.mount()`          | Renders the wallet button. May be called before `ready()`; preparation then runs automatically.                                                |
| `sdk.pay()`            | Starts wallet authorize in the user-gesture stack (custom button). Call after `ready()` resolves.                                              |
| `sdk.openAction()`     | Uses the built-in action opener for a previously received secondary action.                                                                    |
| `sdk.getLastTraceId()` | Returns the last openapi `traceId` for troubleshooting.                                                                                        |
| `sdk.getBridgeName()`  | Resolved JS Bridge mount name (`NativeBridge` if `bridgeName` omitted).                                                                        |
| `sdk.getBridge()`      | `window[sdk.getBridgeName()]`, or `undefined` if the App did not inject it.                                                                    |
| `sdk.destroy()`        | Clears the button, payment-action iframe and active order polling timer.                                                                       |

## Result shape (`onSuccess` / `onComplete`)

```js
{
  orderNo: 'ord_xxx',
  order: { /* poll result when present; see orderState */ }
}
```

## Docs

- [output/](output/) — **商户最终版交付包**（SDK 文件、接入文档、WebView、3DS 壳页）
- [output/SDK.md](output/SDK.md) — merchant H5 / SDK
- [output/WEBVIEW.md](output/WEBVIEW.md) — App WebView / Bridge
- [output/GOOGLE_PAY_ANDROID.md](output/GOOGLE_PAY_ANDROID.md) — Android Production（`OR_BIBED_11` / `13` / `15` 与官方链接）
- [output/APPLE_PAY_IOS.md](output/APPLE_PAY_IOS.md) — iOS `WKWebView` / H5 Apple Pay 要点
- [output/PARAMETERS.md](output/PARAMETERS.md) — merchant `RampPay.init` parameters
- [self-wallet/](self-wallet/) — merchants that cannot load `pay.min.js` and need to self-integrate Google Pay / Apple Pay
- [docs/pay-api/](docs/pay-api/) — internal API contracts（详细类型）
- [docs/PARAMETERS.md](docs/PARAMETERS.md) — same parameter surface as output/PARAMETERS.md
