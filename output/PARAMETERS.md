# RampPay.init 参数说明

**查表用文档**。接入流程、示例代码见 [SDK.md](./SDK.md)；App 二次动作见 [WEBVIEW.md](./WEBVIEW.md)。

图例：**必传** = 必须提供，否则 `init` 抛错；**条件** = 某种用法下必传。

---

## 1. 顶层参数

| 参数              | 类型                    |  必传  | 默认值           | 说明                                                                          |
| ----------------- | ----------------------- | :----: | ---------------- | ----------------------------------------------------------------------------- |
| `container`       | `string \| HTMLElement` |  条件  | —                | 使用 `mount()` 时必传；仅自定义按钮 + `pay()` 时可省略                        |
| `order`           | `object`                | **是** | —                | 创建订单响应 `data`；须含 `orderNo` / `paymentScript` / `token`               |
| `api`             | `object`                |   否   | —                | 可选 `headers`、`pollIntervalMs`（默认 2000）、`pollTimeoutMs`（默认 300000） |
| `actionMode`      | `'callback' \| 'auto'`  |   否   | `'callback'`     | 二次动作如何打开；**App 请用 `callback`**，见 [SDK.md §7](./SDK.md)           |
| `bridgeName`      | `string`                |   否   | `'NativeBridge'` | App JS Bridge 挂载名；须与 Native 注入名一致                                  |
| `openAction`      | `(action) => boolean`   |   否   | —                | 仅 `auto` 时：返回 `true` 表示商户已自行处理二次动作                          |
| `onAction`        | `(action) => void`      |   否   | —                | 出现二次动作时回调；App 内在此调 Bridge                                       |
| `onSuccess`       | `(result) => void`      |   否   | —                | **支付成功**                                                                  |
| `onComplete`      | `(result) => void`      |   否   | —                | 本次流程结束（**不等于**一定支付成功）                                        |
| `onError`         | `(error) => void`       |   否   | —                | 支付失败、超时或不可恢复错误                                                  |
| `onCancel`        | `() => void`            |   否   | —                | 用户关闭钱包，未完成授权                                                      |
| `onStatusChange`  | `(order) => void`       |   否   | —                | 可选；查单过程中订单状态更新（日志 / UI）                                     |
| `onRiskCollected` | `(info) => void`        |   否   | —                | 可选；风控预采集结束                                                          |
| `onOrderCreated`  | `(order) => void`       |   否   | —                | 可选；`ready()` 接受订单后回调（**不是** SDK 自己创单）                       |

---

## 2. `order`（创建订单响应 `data`）

| 字段            | 必传 | 说明                        |
| --------------- | :--: | --------------------------- |
| `orderNo`       |  是  | 平台订单号                  |
| `paymentScript` |  是  | Google / Apple 钱包唤起参数 |
| `token`         |  是  | SDK 后续请求所用凭证        |
| `risk`          |  否  | 风控开关；由创单响应下发    |

创单**请求**字段见平台 API 文档。服务端与 H5 交接见 [SERVER.md](./SERVER.md)。

---

## 3. 回调结果（`onSuccess` / `onComplete`）

```js
{
  orderNo: 'ord_xxx',
  order: { /* 查单结果，如有 */ }
}
```

| 回调                 | 含义                                  |
| -------------------- | ------------------------------------- |
| `onSuccess(result)`  | **支付成功** — 业务跳转、关单以此为准 |
| `onError(error)`     | 支付失败、超时或不可恢复错误          |
| `onComplete(result)` | 流程结束（**不等于**一定支付成功）    |
| `onCancel()`         | 用户关闭钱包，未完成授权              |
| `onAction(action)`   | 需要二次动作（webUrl / 3DS 等）       |

成功时：先 `onSuccess`，再 `onComplete`。

---

## 4. 实例与全局能力

| 名称                                                          | 说明                                       |
| ------------------------------------------------------------- | ------------------------------------------ |
| `sdk.ready()` / `sdk.mount()` / `sdk.pay()` / `sdk.destroy()` | 见 [SDK.md §6](./SDK.md)                   |
| `sdk.openAction(action)`                                      | 纯浏览器下手动打开二次动作                 |
| `sdk.getLastTraceId()`                                        | 联调排障用，见 [README.md](./README.md)    |
| `sdk.getBridge()` / `sdk.getBridgeName()`                     | App：读取 Native 注入的 Bridge             |
| `RampPay.getNativeBridge(name)`                               | 按名读取 Bridge；省略时默认 `NativeBridge` |
| `window.__paySdkSecondaryReturn()`                            | App 二级页关栏后调用，催主收银台立刻查单   |

配置项 `openAction`（拦截器）与实例方法 `sdk.openAction()`（立即打开）不要混淆，见 [SDK.md](./SDK.md)。
