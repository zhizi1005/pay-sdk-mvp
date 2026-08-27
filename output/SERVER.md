# 商户服务端对接

商户服务端负责：**按平台规范签名并调用创建订单**（创单请求与字段见平台已提供的商户 API 文档），把接口返回的 `data` 安全交给收银台 H5。

签名规范见 [API Sign](https://alchemypay.readme.io/docs/api-sign)。SDK **不**使用 `appId` / `appSecret`。

H5 接入见 [SDK.md](./SDK.md)；App Bridge 见 [WEBVIEW.md](./WEBVIEW.md)。

---

## 交给收银台

创建订单成功且 `returnCode === '0000'` 时，将响应中的 **`data`** 传给 Pay SDK：

```js
RampPay.init({ order: data })
```

`data` 须至少包含 `orderNo`、`paymentScript`、`token`（以平台创建订单接口文档为准）。支付、查单等后续步骤由 SDK 在浏览器 / WebView 内完成，**服务端无需再替前端签名或代调这些接口**。

---

## 服务端自查

- [ ] 按 [API Sign](https://alchemypay.readme.io/docs/api-sign) 在**服务端**签名调用创建订单
- [ ] 仅将创建订单响应的 `data` 下发给 H5；**勿**把 `appSecret` 放到前端
- [ ] 收银台已正确执行 `RampPay.init({ order: data })`
- [ ] `redirectUrl` / `callbackUrl` 按业务填写正确（App 场景关栏识别见 [WEBVIEW.md](./WEBVIEW.md)）
- [ ] 不要求 H5 自签支付、查单等接口
