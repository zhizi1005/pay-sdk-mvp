# Pay SDK 接入文档

本文说明商户如何在 **App WebView**（及同构收银台 H5）中接入 Pay SDK，完成 Google Pay / Apple Pay 支付。  
**App 内嵌须同时阅读** [WEBVIEW.md](./WEBVIEW.md)（Bridge / 底部抽屉 / 3DS 壳页）；服务端见 [SERVER.md](./SERVER.md)。

同目录文档说明如何接入；SDK 通过官方 CDN 引入（见 §1）。控制台可用 `RampPay.version` 查看当前 SDK 版本号。

---

## 1. 接入方式

通过 **官方 CDN** 用 `<script>` 引入（IIFE，挂载到 `window.RampPay`）：

```html
<script src="https://static.alchemypay.org/ramp-pay/v1/pay.min.js"></script>
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
  → SDK 提交支付 / 查单
  → 若无二次动作：onSuccess / onComplete
  → 若有 webUrl / 3DS 等：始终 onAction；打开方式见 actionMode（§7）
       · 纯浏览器 auto：webUrl/s3ds 整页跳转（停 poll）；threeDS/Method 页内打开并继续 poll
       · App callback（默认）：Native 底部抽屉打开；原页继续 poll
       · 二级页命中 redirectUrl/callbackUrl → Native 关栏 → 主 WebView 调 __paySdkSecondaryReturn() 催查单
  → 轮询到成功/失败（或浏览器整页离开后由落地页处理）：onSuccess 或 onError / onComplete
```

商户须在**服务端**调用创建订单（按 [API Sign](https://alchemypay.readme.io/docs/api-sign) 签名），把响应 `data` 传入 `RampPay.init`。创单字段见平台 API 文档；与 H5 交接见 [SERVER.md](./SERVER.md)。

SDK **不**调用创建订单、**不**签名、**不**需要 `appId` / `appSecret`；支付与查单由 SDK 在浏览器 / WebView 内自动完成。

钱包类型与风控开关由**创建订单响应**决定；SDK 会在 `init` / `ready()` 阶段按需预采集风控信息（失败一般不阻断支付）。

**按钮两种用法：**

| 方式             | 做法                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------- |
| SDK 渲染官方按钮 | 传 `container`，`ready()` 后 `mount()`                                                        |
| 商户自定义按钮   | 可不传 `container`；以 `ready()` resolve 为「可点击」通知；在用户点击回调里**同步**调 `pay()` |

自定义 CTA 的 Google / Apple 品牌合规由商户自行负责。`pay()` 必须在点击事件的同步调用栈内执行（不可先 `await` 再唤起）。

---

## 3. 收银台如何拿到 `order`

`order` 必须是商户服务端**创建订单接口返回的 `data`**，常见做法：

1. **服务端渲染**：创单后把 `data` 注入页面（如 `window.__ORDER__ = {...}`）
2. **前端请求商户自有接口**：收银台页 `fetch` 商户后端（由后端代调平台创单），拿到 `data` 再 `RampPay.init`

**不要**在 H5 里使用 `appSecret` 或自行签名调平台创单接口。

---

## 4. 最小接入示例

### 4.1 SDK 渲染官方按钮（传 DOM）

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
      // order：商户服务端创单后的 data（见 §3）
      const order = window.__ORDER__

      const sdk = RampPay.init({
        container: '#pay-container',
        order: order,
        // 支付直接成功，或轮询查单到成功态
        onSuccess(result) {
          console.log('支付成功', result.orderNo)
        },
        // API / 钱包失败、查单失败态、超时等
        onError(error) {
          console.error(error.message)
        },
        // 用户关闭 Google / Apple Pay 钱包 sheet（未完成授权）
        onCancel() {
          console.log('用户取消')
        },
        // App：完整 Bridge 示例见 WEBVIEW.md §5
        onAction(action) {
          console.log('二次动作', action.type)
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

### 4.2 商户自定义按钮

```html
<button id="pay-now" disabled>加载中</button>
<script src="https://static.alchemypay.org/ramp-pay/v1/pay.min.js"></script>
<script>
  const order = window.__ORDER__
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

完整参数表见 [PARAMETERS.md](./PARAMETERS.md)。

---

## 5. 初始化参数（摘要）

| 参数                                                | 类型                    | 必传 | 默认值           | 说明                                                   |
| --------------------------------------------------- | ----------------------- | :--: | ---------------- | ------------------------------------------------------ |
| `container`                                         | `string \| HTMLElement` | 条件 | —                | 使用 `mount()` 时必传；仅自定义按钮 + `pay()` 时可省略 |
| `order`                                             | `object`                |  是  | —                | 创建订单响应，须含 `token`                             |
| `bridgeName`                                        | `string`                |  否  | `'NativeBridge'` | App JS Bridge 挂载名；省略则 `window.NativeBridge`     |
| `onAction`                                          | `(action) => void`      |  否  | —                | webUrl / 3DS 等二次动作                                |
| `onSuccess` / `onError` / `onCancel` / `onComplete` | function                |  否  | —                | 成功 / 失败 / 取消 / 流程结束（见 §8）                 |

### `order` 必含字段

| 字段            | 说明                               |
| --------------- | ---------------------------------- |
| `orderNo`       | 平台订单号                         |
| `paymentScript` | Google / Apple 原生唤起参数        |
| `token`         | SDK 后续请求凭证（由创单响应下发） |

---

## 6. 实例方法

| 方法                   | 说明                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RampPay.init(config)` | 校验配置并返回实例                                                                                                                                                                             |
| `sdk.ready()`          | 规范化订单、预采风控、检查钱包可用；**resolve = 可点击 / 可唤起**                                                                                                                              |
| `sdk.mount()`          | 在 `container` 渲染官方支付按钮（须先传 `container`）                                                                                                                                          |
| `sdk.pay()`            | 同步唤起钱包；自定义按钮在用户点击回调内调用；须先 `ready()`。Google Pay 使用 JS `loadPaymentData` + `PAYMENT_AUTHORIZATION`；浏览器与 App WebView 的二次动作接入见 [WEBVIEW.md](./WEBVIEW.md) |
| `sdk.openAction()`     | 用 SDK 内置打开器执行二次动作；适合**纯浏览器 callback 模式**下，商户在 `onAction` 收到动作后稍后手动调用                                                                                      |
| `sdk.getLastTraceId()` | 联调排障用；见 [README.md](./README.md)                                                                                                                                                        |
| `sdk.getBridgeName()`  | 实际 Bridge 挂载名；未传 `config.bridgeName` 时为 `NativeBridge`                                                                                                                               |
| `sdk.getBridge()`      | `window[sdk.getBridgeName()]`；未注入则为 `undefined`                                                                                                                                          |
| `sdk.destroy()`        | 移除官方按钮（若有）、清理 iframe 与轮询                                                                                                                                                       |

二次动作见 §7：纯浏览器可用 `actionMode: 'auto'`；App 见 [WEBVIEW.md](./WEBVIEW.md) §5。

`window.__paySdkSecondaryReturn()` 由 SDK 在 `ready()` 后挂到主收银台页。App 二级页命中 `redirectUrl` / `callbackUrl` 并关栏后，应调用它催主页立刻查单。

---

## 7. 二次动作（摘要）

出现二次动作时**始终**回调 `onAction`。是否由 SDK 自动打开取决于 `actionMode`（默认 `'callback'`）。参数详见 [PARAMETERS.md](./PARAMETERS.md)。

### 7.1 纯浏览器（`actionMode: 'auto'`）

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

### 7.2 App WebView（`actionMode: 'callback'`，默认）

只 `onAction`，**不**自动打开；原收银台页继续查单。App 在 `onAction` 中走 Native Bridge（`sdk.getBridge()`）。**完整可粘贴示例见 [WEBVIEW.md §5](./WEBVIEW.md)。**

| `action.type`     | App                                                   |
| ----------------- | ----------------------------------------------------- |
| `webUrl` / `s3ds` | `bridge.openPayWebUrl(url, redirectUrl, callbackUrl)` |
| `threeDS`         | `openPayChallenge(壳页, payload)`                     |
| `threeDSMethod`   | `openPayMethod(壳页, payload)`                        |

`config.bridgeName` 与 App 注入的 JS Interface 名一致；**不传则使用 `NativeBridge`**。方法名不变。

**禁止**在收银台 WebView 内对 `webUrl` / `s3ds` 做整页跳转；**禁止** `auto` + 仅在 `onAction` 开 Bridge（会双开）。

完整 Bridge、壳页与关栏流程 → **[WEBVIEW.md](./WEBVIEW.md)**。参考壳页 → [`html/`](./html/)。

---

## 8. 回调与结果

商户只需关心以下回调：

| 回调                 | 含义                         | 商户侧建议                                                       |
| -------------------- | ---------------------------- | ---------------------------------------------------------------- |
| `onSuccess(result)`  | **支付成功**                 | 跳转成功页、通知服务端、关单                                     |
| `onError(error)`     | 支付失败、超时或不可恢复错误 | 展示失败、允许重试                                               |
| `onComplete(result)` | 本次 SDK 流程结束            | **不等于**一定支付成功；仅作收尾                                 |
| `onCancel()`         | 用户关闭钱包，未完成授权     | 保持收银台或返回上一页                                           |
| `onAction(action)`   | 需要 webUrl / 3DS 等二次动作 | App 调 Bridge（见 [WEBVIEW.md §5](./WEBVIEW.md)）；纯浏览器见 §7 |

支付成功时：先 `onSuccess(result)`，再 `onComplete(result)`。  
若只有 `onComplete`、没有 `onSuccess`，表示流程结束但未走到支付成功。

`result` 含 `orderNo`；需要更多订单字段时可读 `result.order`。

---

## 9. 风控与 WebView（简要）

- 风控由创单响应中的 `risk` 开关控制；SDK 自动预采集，**失败一般不阻断支付**
- App / 浏览器需允许相关第三方脚本、iframe 与 Cookie（尤其 WebView 场景）
- 细节与平台差异：Android 见 [GOOGLE_PAY_ANDROID.md](./GOOGLE_PAY_ANDROID.md)；iOS 见 [APPLE_PAY_IOS.md](./APPLE_PAY_IOS.md)；Bridge 见 [WEBVIEW.md](./WEBVIEW.md)

---

## 10. 接入检查清单

- [ ] 已引入 `https://static.alchemypay.org/ramp-pay/v1/pay.min.js`，页面 HTTPS
- [ ] 使用 `mount()`：`container` 存在且可见；或使用自定义按钮：`ready` 后启用按钮并在点击时同步调 `pay()`
- [ ] **服务端**创建订单响应含 `orderNo` / `paymentScript` / `token`
- [ ] `RampPay.init({ order })` 传入完整响应
- [ ] 实现 `onSuccess` / `onError` / `onCancel` / `onAction`
- [ ] 纯浏览器：需要 SDK 自动打开二次动作时设 `actionMode: 'auto'`（见 §7.1）
- [ ] App：`actionMode: 'callback'`（默认）+ 按 [WEBVIEW.md](./WEBVIEW.md) 实现 Bridge；`bridgeName` 与 Native 注入名一致（不传则 `NativeBridge`）；`webUrl`/`s3ds` 不在收银台做整页跳转
- [ ] Android Google Pay Production：Pay Console **Domain（Web）+ App** 均已过审，并正确启用 WebView Payment Request（见 [GOOGLE_PAY_ANDROID.md](./GOOGLE_PAY_ANDROID.md)）
- [ ] 创建订单带 `redirectUrl`（及如需的 `callbackUrl`）；回跳后调 `__paySdkSecondaryReturn()`
- [ ] 离开支付页 `sdk.destroy()`，并关闭未关的抽屉
- [ ] 联调失败时记录 `orderNo`、`RampPay.version`、`sdk.getLastTraceId()` 反馈平台
