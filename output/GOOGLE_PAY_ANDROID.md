# Google Pay（Android App / WebView）Production 要求

面向：**商户 Android App** 在 WebView 内使用 Pay SDK / Google Pay **Production** 时。  
纯浏览器（Chrome）已通过 Web integration 时，**仍可能**在 App WebView 报错——校验对象不同。

H5 / Bridge 接入见 [WEBVIEW.md](./WEBVIEW.md)、[SDK.md](./SDK.md)。

---

## 1. 为什么浏览器能付、WebView 不行？

| 场景            | 校验对象                           |
| --------------- | ---------------------------------- |
| Chrome 等浏览器 | 网页域名（Web integration）        |
| Android WebView | **宿主 App 的包名 + 签名 SHA-256** |

WebView 内 Payment Request 会走系统 native intent，由 Google Play Services 校验 **App**，不是只校验域名。

---

## 2. 常见错误码与官方文档

Google 未为每个 `OR_BIBED_*` 提供独立深链；定义集中在故障排查页。

| 错误码        | 常见原因                                                          | 官方说明                                                                                                                        | 处置                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OR_BIBED_11` | App 未在 Google Pay & Wallet Console 完成 Production 注册/审批    | [Android Troubleshooting](https://developers.google.com/pay/api/android/support/troubleshooting)（Registration and access）     | [Publish / production access](https://developers.google.com/pay/api/android/guides/test-and-deploy/publish-your-integration)；[Pay Console](https://pay.google.com/business/console) |
| `OR_BIBED_13` | 包签名 SHA-256 与 Console 记录不一致（常误填 Upload Key / debug） | 同上 Troubleshooting                                                                                                            | [Sign your app](https://developer.android.com/studio/publish/app-signing)；开启 Play App Signing 时填 **应用签名密钥证书** 的 SHA-256                                                |
| `OR_BIBED_15` | WebView 未正确启用 Payment Request / Google Pay                   | 同上「Android WebView」；[Web Troubleshooting · OR_BIBED_15](https://developers.google.com/pay/api/web/support/troubleshooting) | [Using Android WebView](https://developers.google.com/pay/api/android/guides/recipes/using-android-webview)                                                                          |

`OR_BIBED_11` 官方文案示例：

> This merchant has not completed registration to use Google Pay API.  
> Please go to console (https://pay.google.com/business/console) to verify.

---

## 3. 解法摘要（`OR_BIBED_11`）

1. 注册 **Google Play** 开发者账号，将 App 发布到至少 **内部测试**（不必先正式商店上架）。
2. 在 [Google Pay & Wallet Console](https://pay.google.com/business/console) 找到对应 Android 应用，提交 **App integration**（包名 + SHA-256）。
3. 审核通过后，Production 下 `OR_BIBED_11` 通常消失。
4. 细节与指纹易错点见官方 [publish your integration](https://developers.google.com/pay/api/android/guides/test-and-deploy/publish-your-integration)。

只做一半不够：

| 只做到                                        | 结果                       |
| --------------------------------------------- | -------------------------- |
| 只注册 Play，不上传 AAB                       | Pay Console 可能找不到 App |
| 只上传内部测试，不在 Pay Console Submit       | 仍会 `OR_BIBED_11`         |
| 填错指纹（Upload Key / App Signing Key 搞混） | 可能变成 `OR_BIBED_13`     |
| WebView 未开 Payment Request                  | `OR_BIBED_15`              |

---

## 4. H5 / SDK 侧同时确认

与 App 审批并列，缺一不可：

- 创单 / Google Pay 使用 **`PRODUCTION`**（见创单响应 `order.environment` / `paymentScript.environment`）
- `merchantId` 与 Google Pay Console **生产商户**一致
- 域名的 **Web integration** 仍须有效（App 审批不能替代域名审核）

---

## 5. Android App：必须用原生 Google Pay（`openGooglePay`）

仅开启 WebView Payment Request **不够**保证出 token。Pay SDK 要求 Android 宿主实现 `NativeBridge.openGooglePay`，用 Play Services **原生 `PaymentsClient`** 出 token，再经 `__paySdkGooglePayResult` 回 H5 打支付接口。契约见 [WEBVIEW.md §4.2.1](./WEBVIEW.md)。

仍建议保留 WebView `setPaymentRequestEnabled(true)` + manifest `queries`：供 `ready()` 的 JS `isReadyToPay`，以及未升级 App 的回退。

---

## 6. Sheet 能弹出，但 PIN 后无支付接口 / `one at a time`

**不是** `OR_BIBED_11` / `13` / `15`。典型现象：

1. Production Google Pay sheet 能弹出（说明 App 审批与 Payment Request 已过）
2. 点付款 → Wallet 指纹 / PIN 成功
3. Wallet 关闭后仍停在 Pay sheet；**支付接口从未请求**
4. 再点付款 → `This method can only be called one at a time`

原因：WebView JS `loadPaymentData` 走 Payment Request → GMS `IbLoadWebPaymentDataWithPayIntentActivity` → 另开 `GenericDelegatorInternalActivityX` 做验证。部分 OEM（尤其 MIUI / HyperOS）在验证 Activity 回来后 **未把 Result 交回 WebView**，第一次 `loadPaymentData` 一直挂起；去掉 `PAYMENT_AUTHORIZATION` **修不好**（卡在 token 回到页面前）。

| 类型        | 机型 / 系统                                                   | JS WebView 路径                  |
| ----------- | ------------------------------------------------------------- | -------------------------------- |
| 已确认必现  | 小米 / Redmi / POCO（MIUI / HyperOS）                         | PIN 后丢 Result                  |
| 高风险      | OPPO / 一加（ColorOS）、vivo（OriginOS）、有 GMS 的华为、魅族 | 同类后台弹窗 / Activity 生命周期 |
| JS 往往可用 | 三星 One UI、Pixel                                            | 验证多在 sheet 内完成            |

**商户规则：所有 Android WebView 都实现原生 `openGooglePay`，不要按机型分支。** SDK 有该方法则走原生；没有则回退 JS（Chrome / 旧 App）。

---

## 7. 官方参考链接

- [Android Troubleshooting](https://developers.google.com/pay/api/android/support/troubleshooting)（`OR_BIBED_11` / `13` / `15` 等）
- [Web Troubleshooting](https://developers.google.com/pay/api/web/support/troubleshooting)（含 `OR_BIBED_15`）
- [Publish your integration](https://developers.google.com/pay/api/android/guides/test-and-deploy/publish-your-integration)
- [Using Android WebView](https://developers.google.com/pay/api/android/guides/recipes/using-android-webview)
- [Google Pay Android client](https://developers.google.com/pay/api/android/reference/client)（原生 `PaymentsClient`）
- [Sign your app](https://developer.android.com/studio/publish/app-signing)
- [Google Pay Console](https://pay.google.com/business/console)
- [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842754)
