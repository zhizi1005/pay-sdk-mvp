# Google Pay（Android App / WebView）Production 要求

面向：**商户 Android App** 在 WebView 内使用 Pay SDK / Google Pay **Production** 时。  
纯浏览器（Chrome）已通过 Web integration 时，**仍可能**在 App WebView 报错——校验对象不同。

H5 / Bridge 接入见 [WEBVIEW.md](./WEBVIEW.md)、[SDK.md](./SDK.md)。

---

## 1. Production：App 与 Domain **都要**在 Console 过审

在 **Android App WebView** 里用本 SDK 唤起 Google Pay **Production** 时，Google Pay & Wallet Console 里需要 **同时**具备：

| 审批项                                  | Console 入口（常见名称）                                            | 校验什么                                       | 缺了会怎样                                                 |
| --------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| **Website / Domain（Web integration）** | Google Pay API → Integrations → **Integrate with your website**     | 调用 Google Pay 的 **页面域名**（顶层 domain） | 浏览器 / Web 路径不可用；WebView 场景也缺少 Web 侧生产准入 |
| **Android App（App integration）**      | Google Pay API → Integrations → **Integrate with your Android app** | 宿主 App **包名 + 签名 SHA-256**               | WebView 内易 `OR_BIBED_11` / `13`（只过了域名也不够）      |

**结论：要同时验证 App 和 Domain，缺一不可。** App 审批不能替代域名审批，域名审批也不能替代 App 审批。

官方依据：

- [Using Android WebView](https://developers.google.com/pay/api/android/guides/recipes/using-android-webview)：先完成 **Google Pay Web integration**，再在 App 内启用 Payment Request，并完成 [publish your integration](https://developers.google.com/pay/api/android/guides/test-and-deploy/publish-your-integration)（Android App）
- [Web FAQ](https://developers.google.com/pay/api/web/support/faq)：Production 需 **Android App 与 website domains 均获批**

域名侧步骤见 [Publish your Web integration](https://developers.google.com/pay/api/web/guides/test-and-deploy/publish-your-integration)（Add website → 填顶层域名 → Submit）。

---

## 2. 为什么浏览器能付、WebView 不行？

| 场景            | 主要额外校验对象                     |
| --------------- | ------------------------------------ |
| Chrome 等浏览器 | 网页域名（Web integration）          |
| Android WebView | **再加**宿主 App 包名 + 签名 SHA-256 |

WebView 内 Payment Request 会走系统 native intent，由 Google Play Services 校验 **App**。因此：域名已过审、浏览器能付，**仍可能**在 App WebView 报 `OR_BIBED_11`——缺的是 **App integration**，不是「只验 Domain、不验 App」。

---

## 3. 常见错误码与官方文档

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

## 4. 解法摘要（`OR_BIBED_11`，偏 App 侧）

在 **Domain / Web integration 已过审** 的前提下，WebView 仍报 `OR_BIBED_11` 时：

1. 注册 **Google Play** 开发者账号，将 App 发布到至少 **内部测试**（不必先正式商店上架）。
2. 在 [Google Pay & Wallet Console](https://pay.google.com/business/console) 找到对应 Android 应用，提交 **App integration**（包名 + SHA-256）。
3. 审核通过后，Production 下 `OR_BIBED_11` 通常消失。
4. 细节与指纹易错点见官方 [publish your Android integration](https://developers.google.com/pay/api/android/guides/test-and-deploy/publish-your-integration)。

只做一半不够：

| 只做到                                        | 结果                                          |
| --------------------------------------------- | --------------------------------------------- |
| 只过 Domain，不过 App integration             | 浏览器可能正常；**WebView Production 仍失败** |
| 只过 App，不过 Domain / Web integration       | 不符合官方 WebView 前置；Web/生产准入不完整   |
| 只注册 Play，不上传 AAB                       | Pay Console 可能找不到 App                    |
| 只上传内部测试，不在 Pay Console Submit       | 仍会 `OR_BIBED_11`                            |
| 填错指纹（Upload Key / App Signing Key 搞混） | 可能变成 `OR_BIBED_13`                        |
| WebView 未开 Payment Request                  | `OR_BIBED_15`                                 |

---

## 5. H5 / SDK 侧同时确认

与 Console 的 **App + Domain** 审批并列：

- Google Pay 使用 **Production** 环境（由创单响应 / 平台配置决定）
- `merchantId` 与 Google Pay Console **生产商户**一致
- 收银台页所在 **域名** 已在 Console 完成 **Web integration** 并获批
- 宿主 App 已完成 **App integration**（包名 + 正确 SHA-256）并获批

---

## 6. 官方参考链接

- [Android Troubleshooting](https://developers.google.com/pay/api/android/support/troubleshooting)（`OR_BIBED_11` / `13` / `15` 等）
- [Web Troubleshooting](https://developers.google.com/pay/api/web/support/troubleshooting)（含 `OR_BIBED_15`）
- [Publish your Android integration](https://developers.google.com/pay/api/android/guides/test-and-deploy/publish-your-integration)
- [Publish your Web integration](https://developers.google.com/pay/api/web/guides/test-and-deploy/publish-your-integration)（Domain）
- [Using Android WebView](https://developers.google.com/pay/api/android/guides/recipes/using-android-webview)
- [Web FAQ](https://developers.google.com/pay/api/web/support/faq)（App 与 website domains 均需获批）
- [Sign your app](https://developer.android.com/studio/publish/app-signing)
- [Google Pay Console](https://pay.google.com/business/console)
- [Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842754)
