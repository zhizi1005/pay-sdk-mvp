# Changelog

版本号与 `window.RampPay.version` 一致。静态资源路径 `https://static.alchemypay.org/ramp-pay/v1/pay.min.js` 中的 `v1` 是 major 线。

## 1.1.1 — 2026-08-27

- 去掉支付 / 创建订单接口响应的完整 JSON `console.log`，避免商户生产页泄露联调日志

## 1.1.0 — 2026-08-19

- 支持 `RampPay.init({ bridgeName })`：与 Native 注入的 JS Interface 名对齐；不传则仍为 `NativeBridge`
- 可用 `sdk.getBridge()` 或 `RampPay.getNativeBridge(name)` 读取 Bridge
- Google Pay 的 `merchantId` / `merchantName` / `gateway` / `gatewayMerchantId` **只使用创建订单 `paymentScript`**，SDK 不再填 TEST 默认值

## 1.0.0

- 首个商户交付包
