import type { GooglePayParams, PayResult, RuntimeWalletConfig } from './types.js'
import { normalizeGoogleResult, isGoogleCancel, toError } from './normalize.js'
import { resolveRiskCollection } from './risk/index.js'

/** Google Pay TEST 环境默认（Unlimint；与 create-order Unlimint TEST 一致） */
export const GOOGLE_PAY_TEST_DEFAULTS = {
  merchantId: '863513232473669406',
  merchantName: 'Example Merchant',
  gateway: 'unlimint',
  gatewayMerchantId: 'googletest'
} as const

/** 固定 callbackIntents；须配合 PaymentsClient.paymentDataCallbacks */
export const GOOGLE_PAY_CALLBACK_INTENTS: ['PAYMENT_AUTHORIZATION'] = ['PAYMENT_AUTHORIZATION']

const paymentsClients = new WeakMap<RuntimeWalletConfig, google.payments.api.PaymentsClient>()

interface PendingGooglePay {
  riskPromise: Promise<import('./types.js').PayRiskPayload>
  /** 已在 onPaymentAuthorized 里处理过授权结果，避免 loadPaymentData catch 重复回调 */
  settled: boolean
  /** 授权成功后暂存，等 GP 弹窗关闭（loadPaymentData resolve）再 processPayment */
  authorizedResult?: PayResult
}

const pendingPays = new WeakMap<RuntimeWalletConfig, PendingGooglePay>()

/**
 * TEST 环境下补齐 merchantInfo / PAYMENT_GATEWAY 缺省字段。
 * 响应已有值则保留；无 tokenization 时默认 PAYMENT_GATEWAY。
 * 始终固定 callbackIntents = ['PAYMENT_AUTHORIZATION']。
 */
export function applyGooglePayTestDefaults(params: GooglePayParams): GooglePayParams {
  const merchantInfo: google.payments.api.MerchantInfo = {
    ...params.merchantInfo,
    merchantId: params.merchantInfo?.merchantId || GOOGLE_PAY_TEST_DEFAULTS.merchantId,
    merchantName: params.merchantInfo?.merchantName || GOOGLE_PAY_TEST_DEFAULTS.merchantName
  }

  const allowedPaymentMethods = (params.allowedPaymentMethods || []).map((method) => {
    const spec = method.tokenizationSpecification
    if (!spec) {
      return {
        ...method,
        tokenizationSpecification: {
          type: 'PAYMENT_GATEWAY' as const,
          parameters: {
            gateway: GOOGLE_PAY_TEST_DEFAULTS.gateway,
            gatewayMerchantId: GOOGLE_PAY_TEST_DEFAULTS.gatewayMerchantId
          }
        }
      }
    }
    if (spec.type !== 'PAYMENT_GATEWAY') return method
    const parameters = {
      ...spec.parameters,
      gateway: spec.parameters?.gateway || GOOGLE_PAY_TEST_DEFAULTS.gateway,
      gatewayMerchantId:
        spec.parameters?.gatewayMerchantId || GOOGLE_PAY_TEST_DEFAULTS.gatewayMerchantId
    }
    return {
      ...method,
      tokenizationSpecification: { type: 'PAYMENT_GATEWAY' as const, parameters }
    }
  })

  if (allowedPaymentMethods.length === 0) {
    allowedPaymentMethods.push({
      type: 'CARD',
      parameters: {
        allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
        allowedCardNetworks: ['MASTERCARD', 'VISA']
      },
      tokenizationSpecification: {
        type: 'PAYMENT_GATEWAY',
        parameters: {
          gateway: GOOGLE_PAY_TEST_DEFAULTS.gateway,
          gatewayMerchantId: GOOGLE_PAY_TEST_DEFAULTS.gatewayMerchantId
        }
      }
    })
  }

  return {
    ...params,
    merchantInfo,
    allowedPaymentMethods,
    callbackIntents: [...GOOGLE_PAY_CALLBACK_INTENTS]
  }
}

function withFixedCallbackIntents(request: GooglePayParams): GooglePayParams {
  return {
    ...request,
    callbackIntents: [...GOOGLE_PAY_CALLBACK_INTENTS]
  }
}

/** App WebView: NativeBridge.openGooglePay → native PaymentsClient (avoids Payment Request Result loss). */
export function hasNativeGooglePay(): boolean {
  const bridge = window.NativeBridge
  return typeof bridge?.openGooglePay === 'function'
}

/** Strip callbackIntents for native PaymentDataRequest.fromJson (no PaymentDataCallbacks). */
function stripCallbackIntents(
  request: google.payments.api.PaymentDataRequest
): google.payments.api.PaymentDataRequest {
  const { callbackIntents: _omit, ...rest } = request as google.payments.api.PaymentDataRequest & {
    callbackIntents?: unknown
  }
  return rest as google.payments.api.PaymentDataRequest
}

export interface NativeGooglePayResultPayload {
  status: 'SUCCESS' | 'CANCELED' | 'ERROR'
  paymentData?: google.payments.api.PaymentData
  message?: string
}

function merchantInfo(config: RuntimeWalletConfig): google.payments.api.MerchantInfo {
  const gp = config.googlePay
  if (gp?.paymentDataRequest?.merchantInfo) {
    const info = gp.paymentDataRequest.merchantInfo
    if (config.environment === 'TEST') {
      return {
        ...info,
        merchantId: info.merchantId || GOOGLE_PAY_TEST_DEFAULTS.merchantId,
        merchantName: info.merchantName || GOOGLE_PAY_TEST_DEFAULTS.merchantName
      }
    }
    return info
  }
  const info: Partial<google.payments.api.MerchantInfo> = {
    merchantName:
      gp?.merchantName ||
      (config.environment === 'TEST' ? GOOGLE_PAY_TEST_DEFAULTS.merchantName : 'Merchant')
  }
  const merchantId =
    gp?.merchantId ||
    (config.environment === 'TEST' ? GOOGLE_PAY_TEST_DEFAULTS.merchantId : undefined)
  if (merchantId) info.merchantId = merchantId
  return info as google.payments.api.MerchantInfo
}

/**
 * 授权后先 await api.pay，再 return SUCCESS 关 GP 弹窗。
 * processPayment / onAction 放到 loadPaymentData resolve 之后（复用已缓存 pay 响应立刻开抽屉）。
 */
async function onPaymentAuthorized(
  config: RuntimeWalletConfig,
  paymentData: google.payments.api.PaymentData
): Promise<{ transactionState: 'SUCCESS' | 'ERROR'; error?: Record<string, string> }> {
  const pending = pendingPays.get(config)
  if (!pending) {
    return {
      transactionState: 'ERROR',
      error: {
        intent: 'PAYMENT_AUTHORIZATION',
        message: 'No payment in progress',
        reason: 'OTHER_ERROR'
      }
    }
  }

  try {
    const risk = await pending.riskPromise
    const authorized = { ...normalizeGoogleResult(paymentData), risk }
    // 关弹窗前等支付结果；失败则 ERROR，不关 SUCCESS、不开抽屉
    await config.onAuthorizePay?.(authorized)
    pending.authorizedResult = authorized
    pending.settled = true
    return { transactionState: 'SUCCESS' }
  } catch (err) {
    const error = toError(err)
    pending.settled = true
    config.onError?.(error)
    return {
      transactionState: 'ERROR',
      error: {
        intent: 'PAYMENT_AUTHORIZATION',
        message: error.message || 'Payment failed',
        reason: 'PAYMENT_DATA_INVALID'
      }
    }
  }
}

export function getPaymentsClient(config: RuntimeWalletConfig): google.payments.api.PaymentsClient {
  const cached = paymentsClients.get(config)
  if (cached) return cached

  // @types/googlepay 可能无 paymentDataCallbacks；运行时 Google Pay JS 需要该字段
  const clientOptions = {
    environment: config.environment === 'TEST' ? 'TEST' : 'PRODUCTION',
    merchantInfo: merchantInfo(config),
    paymentDataCallbacks: {
      onPaymentAuthorized: (paymentData: google.payments.api.PaymentData) =>
        onPaymentAuthorized(config, paymentData)
    }
  }

  const client = new google.payments.api.PaymentsClient(
    clientOptions as google.payments.api.PaymentOptions
  )
  paymentsClients.set(config, client)
  return client
}

function buildCardPaymentMethod(
  config: RuntimeWalletConfig
): google.payments.api.PaymentMethodSpecification {
  const gp = config.googlePay

  const parameters: google.payments.api.CardParameters = {
    allowedAuthMethods: gp?.allowedAuthMethods || ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
    allowedCardNetworks: gp?.allowedCardNetworks || ['MASTERCARD', 'VISA']
  }

  if (config.billingAddressRequired) {
    parameters.billingAddressRequired = true
    parameters.billingAddressParameters = {
      format: 'FULL',
      phoneNumberRequired: false
    }
  }

  return {
    type: 'CARD',
    parameters,
    tokenizationSpecification: gp!.tokenizationSpecification
  }
}

// Base request shared by isReadyToPay() — 不含 callbackIntents
export function buildGoogleBaseRequest(
  config: RuntimeWalletConfig
): google.payments.api.IsReadyToPayRequest {
  const request = config.googlePay?.paymentDataRequest
  return {
    apiVersion: request?.apiVersion || 2,
    apiVersionMinor: request?.apiVersionMinor || 0,
    allowedPaymentMethods: request?.allowedPaymentMethods || [buildCardPaymentMethod(config)]
  }
}

function buildPaymentDataRequest(
  config: RuntimeWalletConfig
): google.payments.api.PaymentDataRequest {
  const provided = config.googlePay?.paymentDataRequest
  if (provided) {
    const withIntents = withFixedCallbackIntents(provided as GooglePayParams)
    const base =
      config.environment === 'TEST' ? applyGooglePayTestDefaults(withIntents) : withIntents
    return base as google.payments.api.PaymentDataRequest
  }

  const payment = config.payment
  return {
    apiVersion: 2,
    apiVersionMinor: 0,
    allowedPaymentMethods: [buildCardPaymentMethod(config)],
    merchantInfo: merchantInfo(config),
    transactionInfo: {
      countryCode: payment.countryCode,
      currencyCode: payment.currency,
      totalPriceStatus: 'FINAL',
      totalPrice: String(payment.amount),
      totalPriceLabel: 'Total'
    },
    callbackIntents: [...GOOGLE_PAY_CALLBACK_INTENTS]
  } as google.payments.api.PaymentDataRequest
}

function buttonOptions(
  config: RuntimeWalletConfig,
  onClick: () => void
): google.payments.api.ButtonOptions {
  const btn = config.googlePay?.button || {}
  const options: google.payments.api.ButtonOptions = {
    onClick,
    buttonColor: btn.buttonColor || 'default',
    buttonType: btn.buttonType || 'plain',
    buttonSizeMode: btn.buttonSizeMode || 'fill'
  }
  if (btn.buttonLocale) options.buttonLocale = btn.buttonLocale
  return options
}

export function createGoogleButton(config: RuntimeWalletConfig, onClick: () => void): HTMLElement {
  return getPaymentsClient(config).createButton(buttonOptions(config, onClick))
}

/**
 * Native path: App openGooglePay → Wallet → __paySdkGooglePayResult → authorizePay / onSuccess.
 * Does not use JS loadPaymentData (avoids MIUI Payment Request Result loss).
 */
async function payWithGoogleNative(config: RuntimeWalletConfig): Promise<void> {
  // Must call as NativeBridge.openGooglePay(...) — Android WebView rejects a detached
  // @JavascriptInterface function ("can't be invoked on a non-injected object").
  if (!hasNativeGooglePay()) {
    throw new Error('NativeBridge.openGooglePay is not available')
  }

  const riskPromise = resolveRiskCollection(config)
  const pending: PendingGooglePay = { riskPromise, settled: false }
  pendingPays.set(config, pending)

  const request = stripCallbackIntents(buildPaymentDataRequest(config))
  // Native client needs environment for ENVIRONMENT_TEST / PRODUCTION
  const requestForNative = {
    ...request,
    environment: config.environment === 'TEST' ? 'TEST' : 'PRODUCTION'
  }

  try {
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        delete window.__paySdkGooglePayResult
      }

      window.__paySdkGooglePayResult = (payload: NativeGooglePayResultPayload) => {
        void (async () => {
          try {
            if (!payload || payload.status === 'CANCELED') {
              pending.settled = true
              config.onCancel?.()
              resolve()
              return
            }
            if (payload.status === 'ERROR' || !payload.paymentData) {
              pending.settled = true
              const err = new Error(payload.message || 'Google Pay failed')
              config.onError?.(err)
              resolve()
              return
            }

            const risk = await pending.riskPromise
            const authorized = { ...normalizeGoogleResult(payload.paymentData), risk }
            try {
              await config.onAuthorizePay?.(authorized)
            } catch (err) {
              pending.settled = true
              config.onError?.(toError(err))
              resolve()
              return
            }
            pending.authorizedResult = authorized
            pending.settled = true
            try {
              await config.onSuccess?.(authorized)
            } catch (err) {
              config.onError?.(toError(err))
            }
            resolve()
          } catch (err) {
            pending.settled = true
            config.onError?.(toError(err))
            resolve()
          } finally {
            finish()
          }
        })()
      }

      try {
        window.NativeBridge!.openGooglePay!(JSON.stringify(requestForNative))
      } catch (err) {
        finish()
        reject(toError(err))
      }
    })
  } finally {
    pendingPays.delete(config)
    delete window.__paySdkGooglePayResult
  }
}

export async function payWithGoogle(config: RuntimeWalletConfig): Promise<void> {
  if (hasNativeGooglePay()) {
    if (typeof window.__paySdkGooglePayResult === 'function') {
      config.onError?.(new Error('Google Pay already in progress'))
      return
    }
    return payWithGoogleNative(config)
  }

  const client = getPaymentsClient(config)
  const riskPromise = resolveRiskCollection(config)
  const pending: PendingGooglePay = { riskPromise, settled: false }
  pendingPays.set(config, pending)

  try {
    await client.loadPaymentData(buildPaymentDataRequest(config))
    // GP 弹窗已关、pay 已完成：processPayment 立刻 onAction（开抽屉）
    if (pending.authorizedResult) {
      try {
        await config.onSuccess?.(pending.authorizedResult)
      } catch (err) {
        config.onError?.(toError(err))
      }
    }
  } catch (err) {
    if (isGoogleCancel(err)) {
      config.onCancel?.()
      return
    }
    // onPaymentAuthorized 已 onError 时不再重复
    if (!pending.settled) {
      config.onError?.(toError(err))
    }
  } finally {
    pendingPays.delete(config)
  }
}
