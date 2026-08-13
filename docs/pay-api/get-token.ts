/**
 * 接口 0 — 获取免登 accessToken
 * POST /open/api/v4/merchant/getToken
 *
 * 创建订单等业务接口请求头需要 `access-token`。
 * 建议商户服务端调用本接口后，把 `accessToken` 传给 RampPay.init，
 * 避免 JS SDK 在渲染支付按钮前再请求一次 getToken。
 *
 * email 与 uid 二选一必填。
 */

import type { ApiResponse } from './common'

export interface GetTokenRequest {
  /** Native / 常用：用户邮箱 */
  email?: string
  /** 商户侧用户 UUID */
  uid?: string
}

export interface GetTokenResponse {
  accessToken: string
  id?: string
  email?: string
}

export type GetTokenApiResponse = ApiResponse<GetTokenResponse>

export const getTokenByEmailExample: GetTokenRequest = {
  email: 'user@example.com'
}

export const getTokenByUidExample: GetTokenRequest = {
  uid: '1234567xxxxx'
}

export const getTokenResponseExample: GetTokenResponse = {
  id: 'kklzDn3K/BvuSXs559OQfQ==',
  accessToken:
    'ACH8945766425@ACH@kklzDn3K/BvuSXs559OQfQ==@PAY@cwqgsiyILMYNuMjhxhaQLpCX1hnntIqfL+V7uEqNu6I=@IO@…',
  email: 'cwqgsiyILMYNuMjhxhaQLpCX1hnntIqfL+V7uEqNu6I='
}

export const getTokenApiResponseExample: GetTokenApiResponse = {
  success: true,
  returnCode: '0000',
  returnMsg: 'SUCCESS',
  extend: '',
  data: getTokenResponseExample,
  traceId: '642e6990f3481462c6185b310ba2120b'
}
