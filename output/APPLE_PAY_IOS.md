# Apple Pay（iOS App / WKWebView）接入要点

面向：**商户 iOS App** 在 `WKWebView` 内使用 Pay SDK / Apple Pay 时。  
本文只补充 iOS / Apple Pay 侧的落地要求；Bridge 与二级抽屉见 [WEBVIEW.md](./WEBVIEW.md)，H5 SDK 接入见 [SDK.md](./SDK.md)。

---

## 1. 先明确是哪条路径

在本交付包里，iOS 走的是 **H5 `ApplePaySession` + Pay SDK + WKWebView + NativeBridge**。

这**不是**原生 PassKit 按钮路径。不要把 App 首页里单独演示的原生 Apple Pay 按钮，当成本文档对应的 SDK 集成方式。

---

## 2. 基本要求

| 项      | 要求                                           |
| ------- | ---------------------------------------------- |
| WebView | 必须使用 `WKWebView`                           |
| 设备    | 建议真机；模拟器通常不可用                     |
| 钱包    | 设备需可用 Apple Wallet / Apple Pay            |
| 页面    | 收银台页必须 HTTPS                             |
| 域名    | 收银台域名须完成 Apple Pay on the Web 域名校验 |

---

## 3. 域名校验要点

商户收银台所在 HTTPS 域名，需要先完成 Apple Pay on the Web 的域名校验，包括部署 Apple 要求的域名校验文件（通常为 `apple-developer-merchantid-domain-association`）。

常见误区：

- H5 页面能打开，不代表 Apple Pay 域名已校验
- 原生 App 已有 Merchant ID，不代表 WebView 里的 H5 Apple Pay 自动可用
- 只校验了测试页域名，正式收银台换域名后仍可能失败

若商户有多个域名 / 子域名，实际承载收银台的那个域名必须完成校验。

---

## 4. SDK 与 Native 各自职责

| 角色       | 职责                                                                                    |
| ---------- | --------------------------------------------------------------------------------------- |
| Pay SDK    | 发起 `ApplePaySession`、调域名校验接口、提交支付、轮询订单                              |
| 商户服务端 | 创建订单，返回 `paymentScript` / `token` / 可选 `validateMerchantUrl`                   |
| Native App | 注入 `window.NativeBridge`、打开二级抽屉、回跳后调用 `window.__paySdkSecondaryReturn()` |

Apple Pay 域名校验请求由 SDK 调 `POST /payment-hub/domain/verify`；商户前端不需要自己再签名该接口。

---

## 5. 常见失败点

| 现象                                  | 常见原因                                                          |
| ------------------------------------- | ----------------------------------------------------------------- |
| `ready()` 失败，提示 Apple Pay 不支持 | 非 Safari WebKit 环境异常、非 `WKWebView`、设备 / 系统不支持      |
| 钱包无法唤起                          | 真机无可用 Wallet，或 Apple Pay 未启用                            |
| Merchant validation 失败              | 域名未校验，或订单下发 `validateMerchantUrl` / 环境不匹配         |
| 二次动作后无法回主流程                | App 未实现 Bridge 抽屉或未调用 `window.__paySdkSecondaryReturn()` |

联调建议：

1. 先确认真机 + Wallet
2. 再确认收银台真实域名已完成 Apple Pay on the Web 校验
3. 最后检查 Bridge、抽屉关栏与 `__paySdkSecondaryReturn()` 路径

---

## 6. 自检清单

- [ ] iOS 使用 `WKWebView`
- [ ] 收银台页为 HTTPS
- [ ] 真机可用，且设备 Wallet / Apple Pay 可正常使用
- [ ] 收银台域名已完成 Apple Pay on the Web 域名校验
- [ ] App 已注入 `window.NativeBridge` 四个方法
- [ ] 二级页命中 `redirectUrl` / `callbackUrl` 后会关栏并调用 `window.__paySdkSecondaryReturn()`
- [ ] 未把原生 PassKit 按钮路径误当成 SDK 路径
