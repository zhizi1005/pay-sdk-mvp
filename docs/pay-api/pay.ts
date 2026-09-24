/**
 * 接口 3 — 支付
 * POST /payment-hub/alchemy-pay
 *
 * 请求形态对齐 ramp-vue（GP/AP）；Apifox 493859922 body/成功示例不可信。
 *
 * 先看外层 returnCode==='0000'，再看 data 里是否有二次动作字段：
 * 1) 无 webUrl / MD+JWT+action / threeDSMethodData+methodUrl → 成功结束，不调接口 4
 * 2) 有上述字段 → 打开对应页面，轮询接口 4
 * 接口失败（returnCode!=='0000'）看 returnMsg，不调接口 4
 */

import type { ApiResponse } from './common'

export interface PayCustomParam {
  /** Google：token 串；Apple：JSON.stringify(event.payment) */
  encryptedData: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  zip?: string
  country?: string
  firstName?: string
  lastName?: string
}

export interface PayBusinessParams {
  /** Forter ← risk.forter.token */
  cookie?: string
  /** ck 采集结果 → deviceSessionId */
  checkoutCookie?: string
  /** 可选扩展；本阶段 SDK init 不采集 */
  dob?: string
}

export interface PayPoaParams {
  address?: string
  city?: string
  state?: string
  postcode?: string
  country?: string
}

/** POST /alchemy-pay 请求体（对齐 ramp-vue） */
export interface PayRequest {
  orderNo: string
  customParam: PayCustomParam
  businessParams?: PayBusinessParams
  /** wp 采集结果 → sessionId */
  sessionId?: string
  /**
   * 有账单时由账单映射（账单同居住地）；无账单则不传。
   * address←addressLine1, postcode←zip
   */
  poaParams?: PayPoaParams
}

/**
 * 支付成功时 data 载荷（二次动作，对齐 digitalWalletMixin.handleAlchemyPayResponse）。
 * 字段有值则走对应二次动作；都无则直接成功。
 * 忽略 Apifox 成功示例中的订单详情字段。
 */
export interface PayResponse {
  /** 3DS 表单等 */
  MD?: string
  JWT?: string
  /** 3DS 表单提交地址（配合 MD / JWT） */
  action?: string
  /** 普通跳转 */
  webUrl?: string
  /** Shift4 等方法页 */
  threeDSMethodData?: string
  methodUrl?: string
}

export type PayApiResponse = ApiResponse<PayResponse>

/**
 * afterPay(res):
 *   if returnCode !== '0000' → onError(returnMsg)
 *   else if data.MD && data.JWT && data.action → openThreeDSPage(...); poll 接口 4
 *   else if data.webUrl → open(webUrl); poll 接口 4
 *   else if data.threeDSMethodData && data.methodUrl → openShift4Page(...); poll 接口 4
 *   else → onSuccess() / finish（不调接口 4）
 */

export const payRequestExample: PayRequest = {
  orderNo: 'ord_xxx',
  customParam: {
    encryptedData: '...google pay encrypted token...',
    addressLine1: '1 Main St',
    addressLine2: '',
    city: 'San Francisco',
    state: 'CA',
    zip: '94105',
    country: 'US',
    firstName: 'Jane',
    lastName: 'Doe'
  },
  businessParams: {
    cookie: 'your forter token',
    checkoutCookie: 'dsid_...'
  },
  sessionId: 'your worldPay sessionId',
  poaParams: {
    address: '1 Main St',
    city: 'San Francisco',
    state: 'CA',
    postcode: '94105',
    country: 'US'
  }
}

export const payRequestMinimal: PayRequest = {
  orderNo: 'ord_xxx',
  customParam: {
    encryptedData: '{"token":{/* Apple Pay payment */}}'
  }
}

/** 直接成功 → 不必调接口 4 */
export const payResponseSucceeded: PayResponse = {}

/** 普通 webUrl → 打开页面 + 轮询接口 4 */
export const payResponseWebUrl: PayResponse = {
  webUrl: 'https://psp.example/checkout/xxx'
}

/** 3DS（MD/JWT/action）→ 打开 3DS 页 + 轮询接口 4 */
export const payResponseThreeDS: PayResponse = {
  MD: '...',
  JWT: '...',
  action: 'https://acs.example/challenge'
}

/** Shift4 → 方法页 + 轮询接口 4 */
export const payResponseShift4: PayResponse = {
  threeDSMethodData: '...',
  methodUrl: 'https://psp.example/3ds-method'
}

export const payApiResponseSucceededExample: PayApiResponse = {
  success: true,
  returnCode: '0000',
  returnMsg: 'SUCCESS',
  extend: '',
  data: payResponseSucceeded,
  traceId: '68b11d63f919cca7adbb4bbe57939df9'
}

export const payApiResponseWebUrlExample: PayApiResponse = {
  success: true,
  returnCode: '0000',
  returnMsg: 'SUCCESS',
  extend: '',
  data: payResponseWebUrl,
  traceId: '68b11d63f919cca7adbb4bbe57939df9'
}
