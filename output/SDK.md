# Pay SDK 接入文档（商户最终版）

本文说明商户如何在 **App WebView**（及同构收银台 H5）中接入 Pay SDK，完成 Google Pay / Apple Pay 支付。  
**App 内嵌须同时阅读** [WEBVIEW.md](./WEBVIEW.md)（Bridge / 底部抽屉 / 3DS 壳页）；服务端见 [SERVER.md](./SERVER.md)。

同目录 [`pay.min.js`](./pay.min.js) 为交付用 SDK 文件（上传 CDN 后用官方链接）。

---

## 1. 接入方式

推荐使用 **`<script>` 引入** 官方托管文件（IIFE，挂载到 `window.RampPay`）。

```html
<script src="https://static.alchemypay.org/ramp-pay/v1/pay.min.js"></script>
```

自托管可用同目录 `pay.min.js`：

```html
<script src="./pay.min.js"></script>
```

**环境要求：**

- 页面须 **HTTPS**
- Google Pay / Apple Pay 依赖官方脚本（SDK 运行时从 CDN 加载，无需商户再引）
- Apple Pay：Safari / 已校验域名；Google Pay：支持的浏览器与账号环境
- **App 内嵌**：Android **8.0+（API 26）**；iOS **16.0+** 且使用 **WKWebView**；主 WebView 与二级抽屉分离。详见 [WEBVIEW.md](./WEBVIEW.md)

---

## 2. 支付流程（SDK 已编排）

```text
商户服务端签名创建订单 → 拿到 data（含 paymentScript / risk / token）
  → 引入 SDK
  → RampPay.init({ order: 创建订单响应 })  // 用 mount 时再传 container
  → ready()：用传入订单选钱包 → 预采风控 → 检查可用（resolve = 可点击 / 可唤起）
  → 二选一唤起钱包：
       · mount()：在 container 渲染官方 Google / Apple Pay 按钮，用户点击官方按钮
       · 或商户自有按钮：ready 成功后启用按钮，用户点击时同步调用 pay()
  → 用户授权钱包
  → SDK 提交支付 / 查单（请求头 payment-hub-token = order.token；Fingerprint 走 fingerprint-id）
  → 若无二次动作：onSuccess / onComplete
  → 若有 webUrl / 3DS 等：始终 onAction；打开方式见 actionMode（§6）
       · 纯浏览器 auto：webUrl/s3ds 整页跳转（停 poll）；threeDS/Method 页内打开并继续 poll
       · App callback（默认）：Native 底部抽屉打开；原页继续 poll
       · 二级页命中 redirectUrl/callbackUrl → Native 关栏 → 主 WebView 调 __paySdkSecondaryReturn() 催查单
  → 轮询到成功/失败（或浏览器整页离开后由落地页处理）：onSuccess 或 onError / onComplete
```

商户须在**服务端**调用创建订单（按 [API Sign](https://alchemypay.readme.io/docs/api-sign) 签名），把响应（含 **`token`**）传入 `RampPay.init`。详见 [SERVER.md](./SERVER.md)。

SDK **不**调用创建订单、**不**签名、**不**需要 `appId` / `appSecret`；后续 domain/verify、alchemy-pay、order/detail 自动带请求头 **`payment-hub-token`**。

钱包类型、令牌化、Forter/Checkout/WorldPay 开关由**创建订单接口响应**决定。  
**Fingerprint** 由 SDK 在 `init` 时用内置默认自动采集，并通过请求头 `fingerprint-id` 带到支付相关 API。

**按钮两种用法：**

| 方式             | 做法                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------- |
| SDK 渲染官方按钮 | 传 `container`，`ready()` 后 `mount()`                                                        |
| 商户自定义按钮   | 可不传 `container`；以 `ready()` resolve 为「可点击」通知；在用户点击回调里**同步**调 `pay()` |

自定义 CTA 的 Google / Apple 品牌合规由商户自行负责。`pay()` 必须在点击事件的同步调用栈内执行（不可先 `await` 再唤起）。

---

## 3. 最小接入示例

### 3.1 SDK 渲染官方按钮（传 DOM）

```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pay</title>
  </head>
  <body>
    <div id="pay-container"></div>
    <script src="https://static.alchemypay.org/ramp-pay/v1/pay.min.js"></script>
    <script>
      // order = 商户服务端创建订单接口返回的 data（须含 token）
      const order = window.__CREATE_ORDER_DATA__

      const sdk = RampPay.init({
        container: '#pay-container',
        order: order,
        // 支付直接成功，或轮询查单到成功态
        onSuccess(result) {
          console.log('支付成功', result.orderNo, result.order && result.order.orderState)
        },
        // API / 钱包失败、查单失败态、超时等
        onError(error) {
          console.error(error.message)
        },
        // 用户关闭 Google / Apple Pay 钱包 sheet（未完成授权）
        onCancel() {
          console.log('用户取消')
        },
        // 需二次动作（webUrl / s3ds / threeDS / threeDSMethod）；SDK 不自动打开
        // App：在此调 Native Bridge，完整示例见 WEBVIEW.md
        onAction(action) {
          console.log('二次动作', action)
        }
      })

      sdk
        .ready()
        .then(function () {
          sdk.mount()
        })
        .catch(function (err) {
          console.warn('支付不可用', err.message)
        })
    </script>
  </body>
</html>
```

### 3.2 商户自定义按钮

```html
<button id="pay-now" disabled>加载中</button>
<script src="https://static.alchemypay.org/ramp-pay/v1/pay.min.js"></script>
<script>
  const order = window.__CREATE_ORDER_DATA__
  const btn = document.getElementById('pay-now')

  const sdk = RampPay.init({
    // 可不传 container
    order: order,
    onSuccess(result) {
      console.log('支付成功', result.orderNo)
    },
    onError(error) {
      console.error(error.message)
    },
    onCancel() {
      console.log('用户取消')
    },
    onAction(action) {
      console.log('二次动作', action)
    }
  })

  // ready() resolve = 通知商户「可点击」
  sdk
    .ready()
    .then(function () {
      btn.disabled = false
      btn.textContent = '确认'
    })
    .catch(function (err) {
      console.warn('支付不可用', err.message)
    })

  // 须在用户点击的同步栈内调用 pay()
  btn.addEventListener('click', function () {
    sdk.pay()
  })
</script>
```

完整参数见 [PARAMETERS.md](./PARAMETERS.md)。

---

## 4. 初始化参数（摘要）

| 参数                                 | 类型                    | 必传 | 默认值           | 说明                                                                |
| ------------------------------------ | ----------------------- | :--: | ---------------- | ------------------------------------------------------------------- |
| `container`                          | `string \| HTMLElement` | 条件 | —                | 使用 `mount()` 时必传；仅自定义按钮 + `pay()` 时可省略              |
| `order`                              | `object`                |  是  | —                | 创建订单响应，须含 `token`                                          |
| `environment`                        | `'TEST'\|'PRODUCTION'`  |  否  | `'PRODUCTION'`   | 内置 API 域名等；**不**决定 Google Pay `PaymentsClient.environment` |
| `bridgeName`                         | `string`                |  否  | `'NativeBridge'` | App JS Bridge 挂载名；省略则 `window.NativeBridge`                  |
| `onAction`                           | `(action) => void`      |  否  | —                | webUrl / 3DS 等二次动作                                             |
| `onSuccess` / `onError` / `onCancel` | function                |  否  | —                | 成功 / 失败 / 用户取消钱包                                          |

### `order` 必含字段

| 字段            | 说明                                                             |
| --------------- | ---------------------------------------------------------------- |
| `orderNo`       | 平台订单号                                                       |
| `paymentScript` | Google / Apple 原生唤起参数                                      |
| `token`         | 后续请求头 `payment-hub-token`                                   |
| `environment`   | 可选；Google Pay `PaymentsClient.environment`（缺省 PRODUCTION） |

### SDK 内置 API（谁调用）

| 用途           | 路径                                          | 谁调用         |
| -------------- | --------------------------------------------- | -------------- |
| 创建订单       | `POST {根}/open/api/v4/merchant/order/create` | **商户服务端** |
| 支付           | `POST {根}/payment-hub/alchemy-pay`           | SDK            |
| 查询订单       | `GET {根}/payment-hub/order/detail`           | SDK            |
| Apple 域名校验 | `POST {根}/payment-hub/domain/verify`         | SDK            |

API 根域名：`https://api.alchemypay.org`

---

## 5. 实例方法

| 方法                   | 说明                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RampPay.init(config)` | 校验配置并返回实例                                                                                                                                                                             |
| `sdk.ready()`          | 规范化订单、预采风控、检查钱包可用；**resolve = 可点击 / 可唤起**                                                                                                                              |
| `sdk.mount()`          | 在 `container` 渲染官方支付按钮（须先传 `container`）                                                                                                                                          |
| `sdk.pay()`            | 同步唤起钱包；自定义按钮在用户点击回调内调用；须先 `ready()`。Google Pay 使用 JS `loadPaymentData` + `PAYMENT_AUTHORIZATION`；浏览器与 App WebView 的二次动作接入见 [WEBVIEW.md](./WEBVIEW.md) |
| `sdk.openAction()`     | 用 SDK 内置打开器执行二次动作；适合**纯浏览器 callback 模式**下，商户在 `onAction` 收到动作后稍后手动调用                                                                                      |
| `sdk.getLastTraceId()` | 返回最近一次 openapi 响应的 `traceId`（成功或失败）；便于联调时带给平台排障                                                                                                                    |
| `sdk.getBridgeName()`  | 实际 Bridge 挂载名；未传 `config.bridgeName` 时为 `NativeBridge`                                                                                                                               |
| `sdk.getBridge()`      | `window[sdk.getBridgeName()]`；未注入则为 `undefined`                                                                                                                                          |
| `sdk.destroy()`        | 移除官方按钮（若有）、清理 iframe 与轮询                                                                                                                                                       |

二次动作见 §6：纯浏览器可用 `actionMode: 'auto'`；App 见 [WEBVIEW.md](./WEBVIEW.md)。**不要**在收银台 WebView 内对 `webUrl` / `s3ds` 做整页跳转。

`window.__paySdkSecondaryReturn()` 由 SDK 在 `ready()` 后挂到主收银台页。App 二级页命中 `redirectUrl` / `callbackUrl` 并关栏后，应调用它催主页立刻查单。

---

## 6. 二次动作（摘要）

出现二次动作时**始终**回调 `onAction`。是否由 SDK 自动打开取决于 `actionMode`（默认 `'callback'`）。参数详见 [PARAMETERS.md](./PARAMETERS.md)。

### 6.1 纯浏览器（`actionMode: 'auto'`）

行为对齐收银台支付二次动作（**不含 KYC**）：

| `action.type`     | SDK 内置行为                 | 原页 poll |
| ----------------- | ---------------------------- | --------- |
| `webUrl` / `s3ds` | `location.assign` 整页离开   | **停**    |
| `threeDS`         | 页内遮罩 + named iframe POST | 继续      |
| `threeDSMethod`   | 隐藏 iframe POST             | 继续      |

```js
RampPay.init({
  container: '#pay-container',
  order: createOrderResponseFromYourServer,
  actionMode: 'auto',
  onAction(action) {
    console.log('二次动作', action.type)
  },
  onSuccess(result) {
    // 自行跳转结果页（SDK 不调用 getRedirectUrl）
  },
  onError(error) {
    console.error(error)
  }
})
```

### 6.2 App WebView（`actionMode: 'callback'`，默认）

只 `onAction`，**不**自动打开；原页继续 poll。App 在 `onAction` 中走 Native Bridge（`sdk.getBridge()`）：

| `action.type`     | App                                                   |
| ----------------- | ----------------------------------------------------- |
| `webUrl` / `s3ds` | `bridge.openPayWebUrl(url, redirectUrl, callbackUrl)` |
| `threeDS`         | `openPayChallenge(壳页, payload)`                     |
| `threeDSMethod`   | `openPayMethod(壳页, payload)`                        |

`config.bridgeName` 与 App 注入的 JS Interface 名一致；**不传则使用 `NativeBridge`**。方法名不变。

**禁止**在收银台 WebView 内对 `webUrl` / `s3ds` 做整页跳转；**禁止** `auto` + 仅在 `onAction` 开 Bridge（会双开）。

完整 Bridge、壳页与关栏流程 → **[WEBVIEW.md](./WEBVIEW.md)**。参考壳页 → [`html/`](./html/)。

---

## 7. 回调与结果

业务成功以 `onSuccess` 为准；`onComplete` 表示本次编排结束，但**不等于一定支付成功**。

### 7.1 回调矩阵

| 场景                                                                                        | 回调                                           |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 无二次动作且支付直接成功，或查单 `orderState` 为 `2` / `5`                                  | `onSuccess(result)`，随后 `onComplete(result)` |
| 查单 `orderState` 为 `0` / `6` / `7` / `8` / `9` / `10` / `11`，或 API / 钱包失败、轮询超时 | `onError(error)`                               |
| 查单 `orderState` 为 `3` / `4`（`TRANSFER`），或仅 `s3dsComplete === true`                  | **仅** `onComplete(result)`                    |
| 用户关闭 Google / Apple Pay 钱包 sheet（未完成授权）                                        | `onCancel()`                                   |
| 需二次动作（`webUrl` / `s3ds` / `threeDS` / `threeDSMethod`）                               | `onAction(action)`                             |

### 7.2 `orderState` 速查

| `orderState`                              | 含义                              | SDK 回调语义               |
| ----------------------------------------- | --------------------------------- | -------------------------- |
| `1`                                       | `PENDING`                         | 继续轮询                   |
| `2` / `5`                                 | `PAY_SUCCESS` / `FINISHED`        | `onSuccess` + `onComplete` |
| `3` / `4`                                 | `TRANSFER`                        | 仅 `onComplete`            |
| `0` / `6` / `7` / `8` / `9` / `10` / `11` | 失败 / 取消 / 风控 / 退款等失败态 | `onError`                  |

编排完成时一般看 `orderNo`、`order.orderState`；不必再自己调支付接口。

---

## 8. 风控

- Fingerprint：`init` 采集，请求头 `fingerprint-id`
- Forter / Checkout / WorldPay：创建订单 `risk.*.enabled === true` 时在 `ready()` 预采集

### 8.1 排查要点

- 风控采集**失败不阻断支付**；对应字段可能为空，是否拦截取决于渠道或商户侧规则
- 域名 / 脚本白名单：允许加载 Fingerprint、Checkout Risk.js、Forter、Cardinal / WorldPay DDC 等相关脚本
- WebView：开启 JavaScript；不要拦截隐藏 iframe / form POST，WorldPay DDC 依赖它们
- Cookie / 存储：Forter token 依赖 cookie；限制第三方 Cookie 时可能采不到
- 创建订单 `risk.*.enabled === true` 才会采集；WorldPay 至少需下发动态 `jwt`
- 联调时建议同时检查请求头 `fingerprint-id` 与支付 body 中 `businessParams.cookie` / `checkoutCookie` / `sessionId` 是否有值

Apple Pay iOS / WKWebView 侧要求见 [APPLE_PAY_IOS.md](./APPLE_PAY_IOS.md)；App 抽屉与 Bridge 细节见 [WEBVIEW.md](./WEBVIEW.md)。

---

## 9. 接入检查清单

- [ ] 已引入 `https://static.alchemypay.org/ramp-pay/v1/pay.min.js`（或自托管 `pay.min.js`），页面 HTTPS
- [ ] 使用 `mount()`：`container` 存在且可见；或使用自定义按钮：`ready` 后启用按钮并在点击时同步调 `pay()`
- [ ] **服务端**创建订单响应含 `orderNo` / `paymentScript` / `token`
- [ ] `RampPay.init({ order })` 传入完整响应
- [ ] 实现 `onSuccess` / `onError` / `onCancel` / `onAction`
- [ ] 纯浏览器：需要 SDK 自动打开二次动作时设 `actionMode: 'auto'`（见 §6.1）
- [ ] App：`actionMode: 'callback'`（默认）+ 按 [WEBVIEW.md](./WEBVIEW.md) 实现 Bridge；`bridgeName` 与 Native 注入名一致（不传则 `NativeBridge`）；`webUrl`/`s3ds` 不在收银台做整页跳转
- [ ] Android Google Pay Production：Pay Console **Domain（Web）+ App** 均已过审，并正确启用 WebView Payment Request（见 [GOOGLE_PAY_ANDROID.md](./GOOGLE_PAY_ANDROID.md)）
- [ ] 创建订单带 `redirectUrl`（及如需的 `callbackUrl`）；回跳后调 `__paySdkSecondaryReturn()`
- [ ] 离开支付页 `sdk.destroy()`，并关闭未关的抽屉
- [ ] 业务接口 `returnCode === '0000'` 联调通过
