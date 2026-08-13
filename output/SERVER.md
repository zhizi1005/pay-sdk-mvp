# 商户服务端对接（精简最终版）

本文只覆盖商户服务端必做事项：**签名创建订单**，把响应（含 `token`）交给收银台 H5 / Pay SDK。  
支付、查单、Apple 域名校验由 **SDK** 调用，服务端无需再替浏览器签名这些接口。

H5 接入见 [SDK.md](./SDK.md)；App Bridge 见 [WEBVIEW.md](./WEBVIEW.md)。

---

## 1. 职责划分

| 接口                     | 路径                                      | 谁调用                     |
| ------------------------ | ----------------------------------------- | -------------------------- |
| 获取 accessToken（可选） | `POST /open/api/v4/merchant/getToken`     | 商户服务端（建议）         |
| **创建订单**             | `POST /open/api/v4/merchant/order/create` | **商户服务端（签名）**     |
| Apple 域名校验           | `POST /payment-hub/domain/verify`         | SDK（`payment-hub-token`） |
| 支付                     | `POST /payment-hub/alchemy-pay`           | SDK                        |
| 查询订单                 | `GET /payment-hub/order/detail`           | SDK                        |

签名规范见 [API Sign](https://alchemypay.readme.io/docs/api-sign)。SDK **不**使用 `appId` / `appSecret`。

---

## 2. API 根域名

`https://api.alchemypay.org`

完整 URL = 根域名 + 路径。

---

## 3. 统一响应壳

业务字段一律在 `data` 内。成功：`returnCode === '0000'`。

```json
{
  "success": true,
  "returnCode": "0000",
  "returnMsg": "SUCCESS",
  "extend": "",
  "data": {},
  "traceId": "..."
}
```

---

## 4. 创建订单

**POST** `/open/api/v4/merchant/order/create`

请求头需按平台要求携带签名（及业务所需的 `access-token` 等）。钱包常用 `payWayCode`：`501` Apple Pay / `701` Google Pay。

### 4.1 请求字段（常用）

| 字段              | 必填 | 说明                                        |
| ----------------- | ---- | ------------------------------------------- |
| `side`            | 是   | `BUY` / `SELL`                              |
| `merchantOrderNo` | 是   | 商户订单号，唯一                            |
| `amount`          | 是   | 如 `"10.00"`                                |
| `fiatCurrency`    | 是   | 如 `"USD"`                                  |
| `cryptoCurrency`  | 是   | 如 `"USDC"`                                 |
| `orderType`       | 是   | onramp `"4"` / offramp `"6"`                |
| `address`         | 否*  | onramp 收款地址                             |
| `network`         | 是   | 如 `"BSC"`                                  |
| `payWayCode`      | 是   | `701` / `501` 等                            |
| `redirectUrl`     | 是   | 成功/渠道回跳地址（**App 抽屉关栏识别用**） |
| `callbackUrl`     | 是   | 回调 / 浏览器态落地（按业务）               |
| `clientIp`        | 是   | 用户 IPv4                                   |
| `alpha2`          | 否*  | ISO 国家码；offramp 必填                    |

```json
{
  "side": "BUY",
  "merchantOrderNo": "m_ord_xxx",
  "amount": "10.00",
  "fiatCurrency": "USD",
  "alpha2": "US",
  "cryptoCurrency": "USDC",
  "orderType": "4",
  "address": "0xabc...",
  "network": "BSC",
  "payWayCode": "701",
  "redirectUrl": "https://merchant.example/success",
  "callbackUrl": "https://merchant.example/callback",
  "clientIp": "1.2.3.4"
}
```

App 场景请保证 `redirectUrl`（及如需的 `callbackUrl`）可被 Native `startsWith` 识别，用于关闭二级抽屉。详见 [WEBVIEW.md](./WEBVIEW.md)。

### 4.2 响应 `data`（须交给 SDK）

| 字段            | 必填 | 说明                                                                                                                                                                                        |
| --------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orderNo`       | 是   | 平台订单号                                                                                                                                                                                  |
| `paymentScript` | 是   | Google / Apple 原生唤起参数                                                                                                                                                                 |
| `token`         | 是   | SDK 后续请求头 `payment-hub-token`                                                                                                                                                          |
| `environment`   | 否   | `'TEST'` \| `'PRODUCTION'`；**Google Pay `PaymentsClient.environment` 只读此字段**（或 `paymentScript.environment`）；缺省按 PRODUCTION；与 `RampPay.init({ environment })`（API 域名）无关 |
| `risk`          | 否   | 风控开关（Forter / Checkout / WorldPay）                                                                                                                                                    |

收银台：`RampPay.init({ order: data })`，其中 `data` 为上述响应体（至少含 `orderNo` / `paymentScript` / `token`）。TEST 联调请保证响应带 `environment: 'TEST'`，否则 Google Pay 会按 PRODUCTION 建 client。

---

## 5. 服务端检查清单

- [ ] 按 API Sign 签名调用创建订单
- [ ] 响应含 `orderNo` / `paymentScript` / `token`，安全下发给 H5（勿把 `appSecret` 放到前端）
- [ ] Google Pay TEST：响应含 `environment: 'TEST'`（或 `paymentScript.environment`）
- [ ] `redirectUrl` / `callbackUrl` 填写正确，App 可识别
- [ ] 不在前端使用 `appSecret`；不要求 H5 自签支付 / 查单接口
