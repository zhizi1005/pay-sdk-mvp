/**
 * 接口 1 — 创建订单
 * POST /open/api/v4/merchant/order/create（路径以 SDK `src/endpoints.ts` 为准）
 *
 * 请求对齐 Apifox SDK 目录 S2S schema。
 * 响应 data 含 orderNo、paymentScript（Google / Apple 原生唤起参数）与 risk。
 * method 服务端可不传，SDK 按 paymentScript 形态推断。
 * environment 可选，不传默认 'PRODUCTION'。
 * risk 配置：有值覆盖 SDK 默认，无值用默认。
 * 说明见 README.md。
 */

import type { ApiResponse, Environment } from './common'

// ─────────────────────────────────────────────
// 钱包 paymentScript
// ─────────────────────────────────────────────

export interface GooglePayParams {
  apiVersion: number
  apiVersionMinor: number
  allowedPaymentMethods: Array<{
    type: 'CARD'
    parameters: {
      allowedAuthMethods: string[]
      allowedCardNetworks: string[]
      billingAddressRequired?: boolean
      billingAddressParameters?: {
        format: 'FULL' | 'MIN'
        phoneNumberRequired?: boolean
      }
    }
    tokenizationSpecification:
      | {
          type: 'DIRECT'
          parameters: { protocolVersion: string; publicKey: string }
        }
      | {
          type: 'PAYMENT_GATEWAY'
          parameters: { gateway: string; gatewayMerchantId: string }
        }
  }>
  transactionInfo: {
    countryCode: string
    currencyCode: string
    totalPriceStatus: string
    totalPrice: string
    totalPriceLabel: string
  }
  merchantInfo: {
    merchantId: string
    merchantName: string
  }
  /** SDK 固定覆盖为 ['PAYMENT_AUTHORIZATION'] */
  callbackIntents?: string[]
  /** 部分服务端会塞进 paymentScript；SDK 提升为 order.environment，供 Google Pay PaymentsClient 使用 */
  environment?: Environment
}

export interface ApplePayParams {
  countryCode: string
  currencyCode: string
  merchantCapabilities: string[]
  supportedNetworks: string[]
  total: { label: string; type: string; amount: string }
  requiredBillingContactFields?: string[]
}

// ─────────────────────────────────────────────
// 风控（创建订单下发；Fingerprint 由 SDK 独立采集，不在此）
// ─────────────────────────────────────────────

export interface RiskForterConfig {
  enabled?: boolean
  siteId?: string
}

export interface RiskCheckoutConfig {
  enabled?: boolean
  publicKey?: string
  /** 覆盖 Risk.js CDN；缺省按 publicKey（pk_sbox_ → sandbox）选择 */
  scriptUrl?: string
  /** SRI；自定义 scriptUrl 时可一并覆盖 */
  integrity?: string
}

export interface RiskWorldPayConfig {
  enabled?: boolean
  /** Cardinal / WorldPay DDC JWT（创建订单下发） */
  jwt?: string
  /** 卡 BIN；钱包支付可空 */
  bin?: string
  /** DDC Collect URL，可覆盖 */
  actionUrl?: string
}

export interface CreateOrderRisk {
  forter?: RiskForterConfig
  /** 公开块名；配置同 RiskCheckoutConfig */
  ck?: RiskCheckoutConfig
  /** 公开块名；配置同 RiskWorldPayConfig */
  wp?: RiskWorldPayConfig
}

// ─────────────────────────────────────────────
// 请求 / 响应
// ─────────────────────────────────────────────

/** 创建订单请求（对齐 Apifox 493866449） */
export interface CreateOrderRequest {
  /** onramp: BUY / offramp: SELL */
  side: string
  merchantOrderNo: string
  amount: string
  fiatCurrency: string
  /** ISO 3166-1 alpha-2；offramp 必填 */
  alpha2?: string
  cryptoCurrency: string
  /** onramp: 4 / offramp: 6 */
  orderType: string
  address?: string
  network: string
  /** 10001 card / 501 apple pay / 701 google pay */
  payWayCode: string
  userAccountId?: string
  redirectUrl: string
  callbackUrl: string
  memo?: string
  extendParams?: Record<string, unknown>
  clientIp: string
  /** 0=onChain 1=internal */
  withdrawType?: number
}

export interface CreateOrderResponseGooglePay {
  orderNo: string
  method: 'googlePay'
  /**
   * Google Pay `PaymentsClient.environment`；不传时 SDK 按 PRODUCTION。
   * 也可写在 paymentScript.environment，规范化时提升到本字段。
   */
  environment?: Environment
  paymentScript: GooglePayParams
  /** 后续 verify / pay / detail 请求头 `payment-hub-token` */
  token: string
  risk?: CreateOrderRisk
}

export interface CreateOrderResponseApplePay {
  orderNo: string
  method: 'applePay'
  /** 可选；与 Google 路径同样可从创单下发（Apple 不读 PaymentsClient.environment） */
  environment?: Environment
  paymentScript: ApplePayParams
  /** 后续 verify / pay / detail 请求头 `payment-hub-token` */
  token: string
  /** 可选覆盖；未下发时 SDK 使用当前环境的内置接口 2 地址 */
  validateMerchantUrl?: string
  risk?: CreateOrderRisk
}

/** 创建订单成功时 data 载荷 */
export type CreateOrderResponse = CreateOrderResponseGooglePay | CreateOrderResponseApplePay

export type CreateOrderApiResponse = ApiResponse<CreateOrderResponse>

// ─────────────────────────────────────────────
// 示例
// ─────────────────────────────────────────────

export const googlePayParamsDirect: GooglePayParams = {
  apiVersion: 2,
  apiVersionMinor: 0,
  allowedPaymentMethods: [
    {
      type: 'CARD',
      parameters: {
        allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
        allowedCardNetworks: ['MASTERCARD', 'VISA'],
        billingAddressRequired: true,
        billingAddressParameters: {
          format: 'FULL',
          phoneNumberRequired: false
        }
      },
      tokenizationSpecification: {
        type: 'DIRECT',
        parameters: {
          protocolVersion: 'ECv2',
          publicKey:
            'BE6v5sWsfYnUTgU+21rbWKcCAgPBuN8aR7k3b2tq+UMF6iuwHS1Px3maVxaRdbxUOn1HYuMWQ6Uvhc6/OhXE/p4='
        }
      }
    }
  ],
  transactionInfo: {
    countryCode: 'US',
    currencyCode: 'USD',
    totalPriceStatus: 'FINAL',
    totalPrice: '10.00',
    totalPriceLabel: 'Total'
  },
  merchantInfo: {
    merchantId: 'BCR2DN5TRCG6H2QZ',
    merchantName: 'Alchemy Pay Ramp'
  },
  callbackIntents: ['PAYMENT_AUTHORIZATION']
}

export const googlePayParamsDirectMinimal: GooglePayParams = {
  apiVersion: 2,
  apiVersionMinor: 0,
  allowedPaymentMethods: [
    {
      type: 'CARD',
      parameters: {
        allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
        allowedCardNetworks: ['MASTERCARD', 'VISA']
      },
      tokenizationSpecification: {
        type: 'DIRECT',
        parameters: {
          protocolVersion: 'ECv2',
          publicKey:
            'BE6v5sWsfYnUTgU+21rbWKcCAgPBuN8aR7k3b2tq+UMF6iuwHS1Px3maVxaRdbxUOn1HYuMWQ6Uvhc6/OhXE/p4='
        }
      }
    }
  ],
  transactionInfo: {
    countryCode: 'US',
    currencyCode: 'USD',
    totalPriceStatus: 'FINAL',
    totalPrice: '10.00',
    totalPriceLabel: 'Total'
  },
  merchantInfo: {
    merchantId: 'BCR2DN5TRCG6H2QZ',
    merchantName: 'Alchemy Pay Ramp'
  },
  callbackIntents: ['PAYMENT_AUTHORIZATION']
}

export const googlePayParamsGateway: GooglePayParams = {
  apiVersion: 2,
  apiVersionMinor: 0,
  allowedPaymentMethods: [
    {
      type: 'CARD',
      parameters: {
        allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
        allowedCardNetworks: ['MASTERCARD', 'VISA'],
        billingAddressRequired: true,
        billingAddressParameters: {
          format: 'FULL',
          phoneNumberRequired: false
        }
      },
      tokenizationSpecification: {
        type: 'PAYMENT_GATEWAY',
        parameters: {
          gateway: 'unlimint',
          gatewayMerchantId: 'BCR2DN4TQTA5V4YV'
        }
      }
    }
  ],
  transactionInfo: {
    countryCode: 'US',
    currencyCode: 'USD',
    totalPriceStatus: 'FINAL',
    totalPrice: '10.00',
    totalPriceLabel: 'Total'
  },
  merchantInfo: {
    merchantId: 'BCR2DN4TQTA5V4YV',
    merchantName: 'ramp'
  },
  callbackIntents: ['PAYMENT_AUTHORIZATION']
}

export const applePayParams: ApplePayParams = {
  countryCode: 'US',
  currencyCode: 'USD',
  merchantCapabilities: ['supports3DS', 'supportsCredit', 'supportsDebit'],
  supportedNetworks: ['masterCard', 'visa'],
  total: {
    label: 'ALCHEMY GPS EUROPE UAB',
    type: 'final',
    amount: '10.00'
  },
  requiredBillingContactFields: ['name', 'postalAddress', 'phone', 'email']
}

export const applePayParamsMinimal: ApplePayParams = {
  countryCode: 'US',
  currencyCode: 'USD',
  merchantCapabilities: ['supports3DS', 'supportsCredit', 'supportsDebit'],
  supportedNetworks: ['masterCard', 'visa'],
  total: {
    label: 'ALCHEMY GPS EUROPE UAB',
    type: 'final',
    amount: '10.00'
  }
}

export const riskCollectAll: CreateOrderRisk = {
  forter: { enabled: true, siteId: 'b132efccafac' },
  // 生产默认 pk_aldlsnx6lhkjggag4qe2nff4c4h；沙盒默认 pk_sbox_srkhzyxmotpo6vnfhqixvs66kyt（environment=TEST）
  ck: { enabled: true, publicKey: 'pk_aldlsnx6lhkjggag4qe2nff4c4h' },
  wp: { enabled: true, jwt: 'your worldPayJwt' }
}

export const riskCollectNone: CreateOrderRisk = {
  forter: { enabled: false },
  ck: { enabled: false },
  wp: { enabled: false }
}

export const createOrderRequestExample: CreateOrderRequest = {
  side: 'BUY',
  merchantOrderNo: 'm_ord_xxx',
  amount: '10.00',
  fiatCurrency: 'USD',
  alpha2: 'US',
  cryptoCurrency: 'USDT',
  orderType: '4',
  address: '0xabc...',
  network: 'ETH',
  payWayCode: '701',
  redirectUrl: 'https://merchant.example/success',
  callbackUrl: 'https://merchant.example/callback',
  clientIp: '1.2.3.4'
}

export const createOrderResponseGooglePayDirect: CreateOrderResponseGooglePay = {
  orderNo: 'ord_xxx',
  environment: 'TEST',
  method: 'googlePay',
  paymentScript: googlePayParamsDirect,
  token: 'payment-hub-token-example',
  risk: riskCollectAll
}

export const createOrderResponseGooglePayGateway: CreateOrderResponseGooglePay = {
  orderNo: 'ord_xxx',
  environment: 'TEST',
  method: 'googlePay',
  paymentScript: googlePayParamsGateway,
  token: 'payment-hub-token-example',
  risk: riskCollectAll
}

export const createOrderResponseApplePay: CreateOrderResponseApplePay = {
  orderNo: 'ord_xxx',
  environment: 'TEST',
  method: 'applePay',
  paymentScript: applePayParams,
  token: 'payment-hub-token-example',
  validateMerchantUrl: 'https://api-test.alchemytech.cc/payment-hub/domain/verify',
  risk: riskCollectAll
}

export const createOrderResponseMinimalNoRisk: CreateOrderResponseGooglePay = {
  orderNo: 'ord_xxx',
  method: 'googlePay',
  paymentScript: googlePayParamsDirectMinimal,
  token: 'payment-hub-token-example',
  risk: riskCollectNone
}

/** 完整成功报文示意 */
export const createOrderApiResponseExample: CreateOrderApiResponse = {
  success: true,
  returnCode: '0000',
  returnMsg: 'SUCCESS',
  extend: '',
  data: createOrderResponseGooglePayDirect,
  traceId: '68b11d63f919cca7adbb4bbe57939df9'
}
