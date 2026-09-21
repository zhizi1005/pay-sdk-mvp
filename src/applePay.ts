import type { RuntimeWalletConfig } from './types.js'
import { normalizeAppleResult, toError } from './normalize.js'
import { awaitRiskForPay, resolveRiskCollection } from './risk/index.js'

const APPLE_PAY_VERSION = 3

const DEFAULT_CAPABILITIES: ApplePayJS.ApplePayMerchantCapability[] = [
  'supports3DS',
  'supportsCredit',
  'supportsDebit'
]

const DEFAULT_NETWORKS = ['masterCard', 'visa']

const BILLING_CONTACT_FIELDS: ApplePayJS.ApplePayContactField[] = [
  'name',
  'postalAddress',
  'phone',
  'email'
]

function buildPaymentRequest(config: RuntimeWalletConfig): ApplePayJS.ApplePayPaymentRequest {
  const payment = config.payment
  const ap = config.applePay
  if (ap?.paymentRequest) {
    return ap.paymentRequest as ApplePayJS.ApplePayPaymentRequest
  }

  const request: ApplePayJS.ApplePayPaymentRequest = {
    countryCode: payment.countryCode,
    currencyCode: payment.currency,
    merchantCapabilities: ap?.merchantCapabilities || DEFAULT_CAPABILITIES,
    supportedNetworks: ap?.supportedNetworks || DEFAULT_NETWORKS,
    total: {
      label: ap?.totalLabel || 'ALCHEMY GPS EUROPE UAB',
      type: ap?.totalType || 'final',
      amount: String(payment.amount)
    }
  }

  if (config.billingAddressRequired) {
    request.requiredBillingContactFields = BILLING_CONTACT_FIELDS
  }

  return request
}

export function payWithApple(config: RuntimeWalletConfig): void {
  const ap = config.applePay

  if (!ap?.validateMerchant) {
    config.onError?.(new Error('Apple Pay merchant validation is not configured'))
    return
  }

  const riskPromise = resolveRiskCollection(config)
  const session = new ApplePaySession(APPLE_PAY_VERSION, buildPaymentRequest(config))

  session.onvalidatemerchant = async (event) => {
    try {
      const merchantSession = await ap.validateMerchant!(event.validationURL)
      session.completeMerchantValidation(merchantSession)
    } catch (err) {
      session.abort()
      config.onError?.(toError(err))
    }
  }

  session.onpaymentauthorized = (event) => {
    void (async () => {
      let completed = false
      try {
        const base = normalizeAppleResult(event.payment)
        const risk = await awaitRiskForPay(riskPromise)
        const authorized = { ...base, risk }
        // 关 sheet 前完成支付；completePayment 后稍等系统 sheet 动画，再 onAction / 二级抽屉
        await config.onAuthorizePay?.(authorized)
        session.completePayment(ApplePaySession.STATUS_SUCCESS)
        completed = true
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 400)
        })
        try {
          await config.onSuccess?.(authorized)
        } catch (err) {
          // 已 SUCCESS complete，无法再 STATUS_FAILURE；后续失败走商户 onError
          config.onError?.(toError(err))
        }
      } catch (err) {
        if (!completed) {
          try {
            session.completePayment(ApplePaySession.STATUS_FAILURE)
          } catch {
            /* session may already be finished */
          }
        }
        config.onError?.(toError(err))
      }
    })()
  }

  session.oncancel = () => {
    config.onCancel?.()
  }

  session.begin()
}
