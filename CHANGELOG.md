# Changelog

版本号 = `package.json` `version` = `window.RampPay.version`（构建写入）。CDN 目录 `ramp-pay/v1/` 表示 major 线，不随 patch/minor 更换。

## 1.1.1 — 2026-08-27

- 去掉支付 / 创建订单接口响应的完整 JSON `console.log`，避免商户生产页泄露联调日志

## 1.1.0 — 2026-08-19

- 支持 `init({ bridgeName })`：传入则用该 JS Bridge 挂载名，省略或空字符串仍为 `NativeBridge`；提供 `sdk.getBridge()` / `RampPay.getNativeBridge`
- 不再在 SDK 内用 Unlimint TEST 样例补齐 Google Pay `merchantId` / `merchantName` / `gateway` / `gatewayMerchantId`；只使用创单 `paymentScript`
- 去掉对外导出的 `GOOGLE_PAY_TEST_DEFAULTS` / `applyGooglePayTestDefaults`

## 1.0.0

- 商户交付包初始版本（Google Pay / Apple Pay 编排、`onAction` + App Bridge 约定）
