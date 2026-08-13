# 未完成功能 / 后续迭代

> **内部待办**，非商户交付文档。商户接入材料见 [`output/`](../output/)。  
> 每条结构：**现状 / 缺口 / 后续计划**。完成一项可在标题旁标注 `[done]` 或移出本文。

---

## A. 产品能力缺口

### 1. Native SDK（Android / iOS）

- **现状**：仅有浏览器 / App WebView 用的 JS-SDK（`pay.min.js` + Bridge，见 [`output/WEBVIEW.md`](../output/WEBVIEW.md)、[`output/SDK.md`](../output/SDK.md)）。
- **缺口**：缺少纯 Native Android / iOS SDK。
- **后续计划**：等 JS-SDK 测试通过，或商户对接稳定后再开发对应 Native 版本。

### 2. 居住地址单独采集

- **现状**：默认用户同意「居住地址 = 账单地址」；支付体 `poaParams` 由钱包账单地址映射，SDK **不**单独采集居住地址。
- **缺口**：若需区分居住地址与账单地址，商户 App 需额外渲染复选框、表单收集页等 DOM。
- **后续计划**：有业务必要时作为迭代版本开发。

### 3. 支付方式扩展（Card / S2S local）

- **现状**：仅支持 Google Pay / Apple Pay。
- **缺口**：不支持 Card（如 payWay `10001`），以及其他 S2S 对应的 local 支付方式。
- **后续计划**：后续迭代扩展；与现有钱包编排解耦实现。

### 4. 风控采集依赖商户环境（Fingerprint / Forter / Checkout / WorldPay）

- **现状**：`fingerprint-id`（请求头）、Forter token（`businessParams.cookie`）、Checkout `deviceSessionId`（`checkoutCookie`）、WorldPay `sessionId` 等由 SDK 在 `ready()` / init 阶段预采集；**失败不阻断支付**，对应字段可能为空。
- **缺口 / 风险**：采集依赖商户 App WebView 配置、域名白名单、第三方脚本与 Cookie 策略、ATS / 网络安全策略等；不同商户环境可能采不到，无法在 SDK 侧「一次修死」。
- **后续计划**：
  - 不在当前版本做统一强依赖改造；**待商户对接时按环境具体排查**。
  - 给商户的常见建议（对接时可据此列检查清单）：
    - **域名 / 脚本白名单**：允许加载 Fingerprint（如 `fp.alchemypay.org`）、Checkout Risk.js（`risk.checkout.com` / sandbox）、Forter、Cardinal / WorldPay DDC（如 `centinelapi.cardinalcommerce.com`）等相关域名。
    - **WebView**：开启 JavaScript；允许第三方脚本执行；勿过度拦截 iframe / form POST（WorldPay DDC 依赖隐藏 iframe）。
    - **Cookie / 存储**：Forter 依赖 `forterToken` cookie；限制第三方 Cookie 可能导致 token 为空。
    - **创建订单 risk 开关**：仅 `enabled === true` 的厂商会采集；WorldPay 至少需要下发动态 `jwt`；钱包路径下 BIN 常为空属已知限制。
    - **观测**：对接时用 demo / 日志确认请求头 `fingerprint-id` 与支付 body 风控字段是否有值；空值时先查 App 网络与 WebView 策略，再查渠道侧是否强制要求。
  - 若对接中反复踩坑，再补一份商户侧「风控采集排查」指引文档。

---

## B. 待优化 / 待补齐

### 5. 查单 KYC / 弹窗编排

- **现状**：`QueryOrderResponse` 已有 `needPopup` / `kycInfoExtend` / `popupCode` 等字段。
- **缺口**：轮询路径未按这些字段分支（无弹窗 / KYC 编排）。
- **后续计划**：有产品需求时补齐轮询侧处理与商户回调约定。

### 6. 账单地址完整性

- **已处理**：对齐 ramp-vue，去掉完整性校验；钱包有地址对象时按字段上送，缺省传空串；无地址对象则不写地址字段。

### 7. 中间态回调语义

- **现状**：`TRANSFER`（orderState 3/4）、`s3dsComplete` 等非终态成功路径主要走 `onComplete`，不走 `onSuccess`。
- **缺口**：商户易把「流程结束」当成「支付成功」。
- **后续计划**：补强文档说明，或增加更明确的状态回调约定。

### 8. `actionMode: 'auto'` 与 App WebView

- **现状**：默认 `callback`；`auto` 会对 `webUrl` / `s3ds` 做整页 `location.assign` 并停止 poll；threeDS/Method 页内打开并继续 poll。交付文档已约束 App 用 `callback`（见 `output/WEBVIEW.md` / `SDK.md` §6）；demo 在检测到 Bridge 时强制 `callback`。
- **缺口**：SDK **尚未**在运行时检测 `NativeBridge` 并强制降级为 `callback`。
- **后续计划**：若商户仍误配，再考虑运行时降级；当前以文档 + demo 约束为准。

### 9. 错误信息可观测性

- **现状**：商户回调多为 `Error.message`；`returnCode` / `traceId` 可通过 `getLastTraceId()` 等拿到，但 PARAMETERS 覆盖不足。
- **缺口**：线上排障时商户难关联平台 trace。
- **后续计划**：补 PARAMETERS / SDK 文档；视需要在 `onError` 透出结构化错误字段。

### 10. PARAMETERS 与真实 init 表面对齐

- **现状**：`actionMode` / `openAction` / `environment`（API 域名语义）及创单 `order.environment`（Google Pay）已写入 PARAMETERS / SERVER / pay-api；浏览器/App 双轨二次动作见 SDK.md §6。
- **缺口**：`onStatusChange`、`onRiskCollected` 等仍可能未完整列入参数表。
- **后续计划**：继续对齐其余 init 表面字段。
