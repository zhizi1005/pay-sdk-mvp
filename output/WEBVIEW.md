# App WebView 接入指南（商户最终版）

面向：**商户 Android / iOS App** 与内嵌收银台 H5。  
可单独复制本文给 App 同学落地。

SDK 出现二次动作时**只回调** `onAction`，**不会**自动打开页面，并在需二次动作时继续轮询订单状态。App 须在 `onAction` 中调 Native Bridge。

**`actionMode` 要求（重要）**

- App **必须**使用默认 `actionMode: 'callback'`（或显式传入 `'callback'`）
- **不要**在 App 里设 `actionMode: 'auto'` 却只在 `onAction` 开 Bridge：`auto` 会对 `webUrl`/`s3ds` 做收银台内 `location.assign`，打断原页轮询并可能与抽屉双开
- 若确需 `auto`，须同时提供 `openAction` 且返回 `true` 表示 Bridge 已处理
- 纯浏览器收银台用 `auto` 的说明见 [SDK.md §6.1](./SDK.md) / [PARAMETERS.md](./PARAMETERS.md)，**不是**本文 App 路径

H5 SDK 接入见 [SDK.md](./SDK.md)；参考壳页见 [`html/`](./html/)。

---

## 1. 系统与 WebView 要求

| 平台    | 要求                                                                      |
| ------- | ------------------------------------------------------------------------- |
| Android | **8.0+（API 26）**；系统 WebView（开启 JS，可注入 `JavascriptInterface`） |
| iOS     | **16.0+**；使用 **WKWebView**（勿用已废弃的 UIWebView）                   |
| 通用    | 收银台页须 **HTTPS**；主收银台 WebView 与二级抽屉 WebView **分离**        |

补充：

- Android：Google Pay 依赖较新系统 WebView，以及设备 / Google 账号环境；不可用时 `ready()` 会失败
- Android **Production**：Google Pay Console 须 **同时**完成 **Website/Domain（Web integration）** 与 **Android App（App integration，包名 + SHA-256）**，缺一不可；常见 `OR_BIBED_11` / `13` / `15` 见 **[GOOGLE_PAY_ANDROID.md](./GOOGLE_PAY_ANDROID.md)**
- iOS：Apple Pay 需**真机** + Wallet 可用 + 商户域名已校验；模拟器或无钱包设备不可用
- 二级动作（webUrl / 3DS 壳页）必须在 Native **底部抽屉**内嵌的独立 WebView 中打开，不要在主 WebView 整页跳转

---

## 2. 目标流程

```text
支付接口返回二次动作（webUrl / threeDS / threeDSMethod）
  → 关钱包 sheet 后 SDK onAction
  → H5 调 Native Bridge：底部抽屉打开二级 WebView
       · webUrl / s3ds     → loadUrl(支付 URL)
       · threeDS           → loadUrl(商户 Challenge 壳页) + 注入 payload
       · threeDSMethod     → loadUrl(商户 Method 壳页) + 注入 payload
  → 原收银台 WebView 里 SDK 继续 poll order/detail
  → 轮询中若出现新的 s3dsUrl → 再 onAction(s3ds) → openPayWebUrl 替换抽屉内容
  → 用户完成后：
       A) 原页 poll 终态 onSuccess / onError → closePayWebUrl()
       B) 二级页导航命中 redirectUrl/callbackUrl → Native dismiss
          → 主 WebView 调 window.__paySdkSecondaryReturn() → SDK 立刻查单
          → 终态同样 onSuccess / onError（落地本身不等于成功）
```

无二次动作时：关钱包 sheet 后直接 `onSuccess`（不强制 poll）。

**禁止**在收银台 WebView 内对 `webUrl` / `s3ds` 执行整页跳转（如 `location.assign` / `location.href`），否则原页轮询中断。

不要对本页叠 Challenge/Method iframe；用二级抽屉 + 壳页。

---

## 3. 职责划分

| 角色                           | 职责                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| 收银台 WebView（H5 + Pay SDK） | 调钱包、支付、`onAction`、轮询查单、`onSuccess`/`onError`                                   |
| Native App                     | 注入 Bridge；底部抽屉打开/关闭二级 WebView；壳页注入；匹配 `redirectUrl`/`callbackUrl` 关栏 |
| 商户服务端                     | 创建订单时填写可识别的 `redirectUrl`（及如需的 `callbackUrl`）                              |
| 商户 H5                        | 托管 Challenge/Method **参考壳页**（本包 `html/`；可改名/自托管）                           |

---

## 4. Bridge 契约

### 4.1 挂载名

默认挂载名是 **`NativeBridge`**（`window.NativeBridge`）。各商户 App 的 JS Interface 名可以不同：H5 在 `RampPay.init({ bridgeName })` 传入与 Native **完全一致**的名字；**不传或传空**则仍用 `NativeBridge`。

方法名不变（见 4.2），只改 `window` 上的对象名。

Android（把 `"NativeBridge"` 换成商户实际注入名）：

```kotlin
webView.addJavascriptInterface(PayJsBridge(), "NativeBridge")
```

H5：

```js
var sdk = RampPay.init({
  order: createOrderResponseData,
  // 省略则等同 NativeBridge
  bridgeName: 'NativeBridge',
  onAction: function (action) {
    var bridge = sdk.getBridge() // window[sdk.getBridgeName()]
  }
})
```

也可用全局辅助：`RampPay.getNativeBridge(name)`（`name` 省略时同样默认 `NativeBridge`）。

iOS 也建议在 H5 侧暴露**与 `bridgeName` 相同**的 `window.*`，把调用转发到 `WKScriptMessageHandler`，这样 H5 代码可与 Android 共用：

```swift
final class NativeBridge: NSObject, WKScriptMessageHandler {
  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    // message.body: { method: "openPayWebUrl", args: [...] }
  }
}

let controller = WKUserContentController()
controller.add(NativeBridge(), name: "NativeBridge")
let config = WKWebViewConfiguration()
config.userContentController = controller
```

```js
window.NativeBridge = {
  openPayWebUrl(url, redirectUrl, callbackUrl) {
    window.webkit.messageHandlers.NativeBridge.postMessage({
      method: 'openPayWebUrl',
      args: [url, redirectUrl, callbackUrl]
    })
  },
  openPayChallenge(shellUrl, jsonPayload) {
    window.webkit.messageHandlers.NativeBridge.postMessage({
      method: 'openPayChallenge',
      args: [shellUrl, jsonPayload]
    })
  },
  openPayMethod(shellUrl, jsonPayload) {
    window.webkit.messageHandlers.NativeBridge.postMessage({
      method: 'openPayMethod',
      args: [shellUrl, jsonPayload]
    })
  },
  closePayWebUrl() {
    window.webkit.messageHandlers.NativeBridge.postMessage({
      method: 'closePayWebUrl',
      args: []
    })
  }
}
```

### 4.2 方法（Android `@JavascriptInterface` / iOS message handler 共用）

| 方法               | 参数                                                    | 说明                                                       |
| ------------------ | ------------------------------------------------------- | ---------------------------------------------------------- |
| `openPayWebUrl`    | `url`, `redirectUrl`, `callbackUrl`（后两参可空字符串） | 抽屉 `loadUrl`；后两参供 Native startsWith 关栏            |
| `openPayChallenge` | `shellUrl`, `jsonPayload`                               | 抽屉 `loadUrl(壳页)`，`onPageFinished` 注入 Challenge JSON |
| `openPayMethod`    | `shellUrl`, `jsonPayload`                               | 同上，Method JSON                                          |
| `closePayWebUrl`   | 无参                                                    | 关闭二级抽屉（幂等；Challenge/Method/webUrl 共用）         |

不要用同名重载。壳页 URL **由 H5/商户传入**，不要写死在 Native。

```kotlin
class PayJsBridge {
  @JavascriptInterface
  fun openPayWebUrl(url: String, redirectUrl: String, callbackUrl: String) { /* … */ }

  @JavascriptInterface
  fun openPayChallenge(shellUrl: String, jsonPayload: String) {
    // 主线程：BottomSheet + WebView.loadUrl(shellUrl)
    // onPageFinished → evaluateJavascript 调用 __paySdkRenderChallenge(…)
  }

  @JavascriptInterface
  fun openPayMethod(shellUrl: String, jsonPayload: String) { /* → __paySdkRenderMethod */ }

  @JavascriptInterface
  fun closePayWebUrl() { /* dismiss */ }
}
```

SDK 在 `ready` 后注册 `window.__paySdkSecondaryReturn`：Native 关栏后调用可催原页立刻查单。

### 4.3 哪些 action 走 Bridge

| `action.type`   | H5 做法（App 推荐）                                                      | App                |
| --------------- | ------------------------------------------------------------------------ | ------------------ |
| `webUrl`        | `openPayWebUrl(action.url, redirect, callback)`                          | 底部抽屉 `loadUrl` |
| `s3ds`          | 同上（可替换已打开的抽屉）                                               | 同上               |
| `threeDS`       | `openPayChallenge(shellUrl, JSON.stringify({MD,JWT,action}))`            | 壳页 + 注入        |
| `threeDSMethod` | `openPayMethod(shellUrl, JSON.stringify({threeDSMethodData,methodUrl}))` | 同上               |

### 4.4 参考壳页

本包提供（命名/托管由商户自定）：

| 文件                                                   | 约定全局函数                                             | 作用                 |
| ------------------------------------------------------ | -------------------------------------------------------- | -------------------- |
| [`html/3ds-challenge.html`](./html/3ds-challenge.html) | `__paySdkRenderChallenge({ MD, JWT, action })`           | POST MD/JWT → action |
| [`html/3ds-method.html`](./html/3ds-method.html)       | `__paySdkRenderMethod({ threeDSMethodData, methodUrl })` | 隐藏 iframe POST     |

Native 注入建议：将 `jsonPayload` Base64 后 `evaluateJavascript`，避免引号转义。iOS / Android 都保持同一方法名与参数顺序，H5 更容易复用。

---

## 5. H5 最小接入（可粘贴）

```js
// 与 Native 注入名一致；不传 init.bridgeName 时 SDK 默认 NativeBridge
var bridgeName = 'NativeBridge'
// 商户自托管壳页；本包见 html/3ds-*.html
var challengeShell = 'https://merchant.example/3ds-challenge.html'
var methodShell = 'https://merchant.example/3ds-method.html'
var redirectUrl = '' // 与创建订单一致
var callbackUrl = ''

function missingBridge(method) {
  console.error('[RampPay] ' + bridgeName + '.' + method + ' missing; please upgrade the App')
  // 正式 App：可 Toast「请升级 App」
}

function closePayDrawer() {
  var bridge = sdk.getBridge()
  if (bridge && typeof bridge.closePayWebUrl === 'function') {
    bridge.closePayWebUrl()
  }
}

var sdk = RampPay.init({
  container: '#pay-button',
  order: createOrderResponseData,
  bridgeName: bridgeName,
  onAction: function (action) {
    var bridge = sdk.getBridge()
    if (action.type === 'webUrl' || action.type === 's3ds') {
      if (bridge && typeof bridge.openPayWebUrl === 'function') {
        bridge.openPayWebUrl(action.url, redirectUrl || '', callbackUrl || '')
        return
      }
      missingBridge('openPayWebUrl')
      return
    }
    if (action.type === 'threeDS') {
      if (bridge && typeof bridge.openPayChallenge === 'function') {
        bridge.openPayChallenge(
          challengeShell,
          JSON.stringify({ MD: action.MD, JWT: action.JWT, action: action.action })
        )
        return
      }
      missingBridge('openPayChallenge')
      return
    }
    if (action.type === 'threeDSMethod') {
      if (bridge && typeof bridge.openPayMethod === 'function') {
        bridge.openPayMethod(
          methodShell,
          JSON.stringify({
            threeDSMethodData: action.threeDSMethodData,
            methodUrl: action.methodUrl
          })
        )
        return
      }
      missingBridge('openPayMethod')
    }
  },
  onSuccess: function () {
    closePayDrawer()
  },
  onError: function () {
    closePayDrawer()
  }
})

sdk.ready().then(function () {
  sdk.mount()
})
```

也可用商户自有按钮：`ready()` 成功后启用按钮，在点击回调里同步调 `sdk.pay()`（可不传 `container` / 不调 `mount`）。按钮与唤起细节见 [SDK.md](./SDK.md)。Bridge / 抽屉流程不变。

### 无 Bridge 时

正式 App WebView 必须注入完整 Bridge（默认 `NativeBridge`，或与 `bridgeName` 同名）。缺失时提示用户升级 App，**不要**在收银台页做整页跳转打开 `webUrl` / `s3ds`。

---

## 6. 关闭二级 WebView

### A. 原页轮询终态（主路径）

`onSuccess` / `onError` → `closePayWebUrl()`

### B. 二级页命中 redirectUrl / callbackUrl（兜底）

仅当渠道会浏览器回跳到创建订单落地地址时启用。

1. 创建订单填写真实会跳回的 `redirectUrl`（及如需的 `callbackUrl`）
2. H5 `openPayWebUrl(webUrl, redirectUrl, callbackUrl)` 把前缀交给 Native
3. Native：`currentUrl.startsWith(redirectUrl|callbackUrl)` → dismiss
4. 主 WebView 执行 `window.__paySdkSecondaryReturn()`
5. **业务成功仍以查单终态为准**（打开落地页 ≠ 成功）

匹配建议：`startsWith` 完整前缀（origin+path）；不要只比 host。

### 用户中途下滑关闭抽屉

SDK 轮询**继续**；`onCancel` **不会**因此触发（`onCancel` 只表示钱包取消）。

---

## 7. Native 实现要点

1. 三个 open 方法在**主线程**弹出同一 BottomSheet，内嵌独立 WebView。
2. **不要**在收银台 WebView 上 `loadUrl(webUrl)`。
3. Challenge/Method：先 `loadUrl(壳页)`，`onPageFinished` 再注入。
4. 二级与主 WebView Cookie 默认隔离；按渠道配置第三方 Cookie（若需要）。
5. 收银台销毁时 H5 调 `sdk.destroy()`，并关掉未关的抽屉。

iOS 补充：

1. 用 `WKWebView` + `WKUserContentController` 注入同名 `NativeBridge`
2. `redirectUrl` / `callbackUrl` 命中后，在主 WebView 执行 `window.__paySdkSecondaryReturn()`
3. H5 Apple Pay 走 `ApplePaySession`；不是首页原生 PassKit 按钮，详见 [APPLE_PAY_IOS.md](./APPLE_PAY_IOS.md)

---

## 8. 与 SDK 行为对齐（勿踩坑）

| 点              | 说明                                               |
| --------------- | -------------------------------------------------- |
| 二次动作默认    | 只 `onAction`，不自动开页；有二次动作时继续 poll   |
| 无二次动作      | 直接 `onSuccess`                                   |
| `webUrl`/`s3ds` | **禁止**收银台整页跳转；必须 Bridge 开二级抽屉     |
| App 主推        | `onAction` 调 Bridge（`openPayWebUrl` / 壳页方法） |

---

## 9. 自检清单

- [ ] Android 8.0+ / iOS 16+；iOS 使用 WKWebView
- [ ] 注入 Bridge：Android `JavascriptInterface` / iOS `messageHandlers` 对外暴露四方法；H5 `bridgeName` 与注入名一致（不传则 `NativeBridge`）
- [ ] 底部抽屉二级 WebView，非当前页跳转
- [ ] H5：`webUrl`/`s3ds` → Bridge；`threeDS`/`threeDSMethod` → 壳页 Bridge
- [ ] 创建订单 `redirectUrl`；命中后 dismiss + `__paySdkSecondaryReturn`
- [ ] `onSuccess` / `onError` 调 `closePayWebUrl`
- [ ] 未在收银台 WebView 对 `webUrl`/`s3ds` 做整页跳转
- [ ] 联调确认原页仍在轮询 `order/detail`
- [ ] 离开收银台 `sdk.destroy()` 并关抽屉
- [ ] iOS H5 Apple Pay 用真机 + Wallet + 已校验域名；不要把原生 PassKit 演示当成 SDK 路径
- [ ] Google Pay **Production**：Pay Console **Domain + App** 均已过审；WebView 正确启用 Payment Request（见 [GOOGLE_PAY_ANDROID.md](./GOOGLE_PAY_ANDROID.md)）
