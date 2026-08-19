import type {
  CreateOrderResponse,
  PayResponse,
  PayResult,
  PaySdkConfig,
  PaySdkInstance,
  PaySdkSettleResult,
  PaymentAction,
  PaymentActionMode,
  PayNativeBridge,
  QueryOrderResponse,
  RuntimeWalletConfig
} from './types.js'
import { ready as detectReady } from './ready.js'
import { renderButton, resolveContainer } from './button.js'
import { payWithGoogle } from './googlePay.js'
import { payWithApple } from './applePay.js'
import { normalizeCreateOrderResponse, PayApiClient, PayApiError } from './api.js'
import { describePayResponse, describeS3ds, PaymentActionView } from './actions.js'
import { resolveEnvironment, resolvePayApiConfig } from './endpoints.js'
import {
  normalizeAppleBillingAddress,
  normalizeAppleToken,
  normalizeGoogleBillingAddress,
  buildAlchemyPayRequest,
  toError
} from './normalize.js'
import {
  ORDER_STATE_FAIL,
  ORDER_STATE_PENDING,
  ORDER_STATE_SUCCESS,
  isValidS3dsUrl,
  orderStateLabel
} from './orderState.js'
import { collectRisk } from './risk/index.js'
import { collectFingerprint } from './risk/fingerprint.js'
import { DEFAULT_BRIDGE_NAME, getNativeBridge, normalizeBridgeName } from './bridge.js'

export type {
  PaySdkConfig,
  ApiPaySdkConfig,
  RuntimeWalletConfig,
  PaySdkInstance,
  PayMethod,
  Environment,
  PaymentConfig,
  GooglePayButtonConfig,
  GooglePayConfig,
  ApplePayButtonConfig,
  ApplePayConfig,
  PayResult,
  PaySdkSettleResult,
  GooglePayResult,
  ApplePayResult,
  CreateOrderRisk,
  PayRiskPayload,
  RiskFingerprintConfig,
  RiskForterConfig,
  RiskCheckoutConfig,
  RiskWorldPayConfig,
  ApiResponse,
  CreateOrderRequest,
  CreateOrderResponse,
  CreateOrderInput,
  CreateOrderResponseGooglePay,
  CreateOrderResponseApplePay,
  GooglePayParams,
  ApplePayParams,
  BillingAddress,
  PayApiConfig,
  PayRequest,
  PayCustomParam,
  PayBusinessParams,
  PayPoaParams,
  PayResponse,
  QueryOrderResponse,
  OnRampOrderStatusLabel,
  OrderStatus,
  PaymentAction,
  PaymentActionMode,
  PayNativeBridge
} from './types.js'

export { PayApiError, normalizeCreateOrderResponse, normalizeQueryOrderResponse } from './api.js'
export { ON_RAMP_ORDER_STATUS_MAP } from './types.js'
export {
  ORDER_STATE_FAIL,
  ORDER_STATE_PENDING,
  ORDER_STATE_SUCCESS,
  orderStateLabel
} from './orderState.js'
export { describePayResponse, describeS3ds } from './actions.js'
export { getApiEndpoints, resolvePayApiConfig, resolveEnvironment } from './endpoints.js'
export { buildAlchemyPayRequest } from './normalize.js'
export { GOOGLE_PAY_CALLBACK_INTENTS } from './googlePay.js'
export { DEFAULT_BRIDGE_NAME, getNativeBridge, normalizeBridgeName } from './bridge.js'

function validateConfig(config: PaySdkConfig): void {
  if (!config || typeof config !== 'object') {
    throw new Error('RampPay.init requires a config object')
  }
  const order = config.order
  if (!order || typeof order !== 'object') {
    throw new Error('config.order is required (create-order response)')
  }
  if (!order.orderNo) {
    throw new Error('order.orderNo is required')
  }
  if (
    !order.paymentScript ||
    (typeof order.paymentScript !== 'object' && typeof order.paymentScript !== 'string')
  ) {
    throw new Error('order.paymentScript is required')
  }
  if (!order.token || typeof order.token !== 'string' || !order.token.trim()) {
    throw new Error('order.token is required')
  }
  normalizeBridgeName(config.bridgeName)
}

function hasSecondaryAction(response: PayResponse): boolean {
  return !!(
    response.webUrl ||
    response.MD ||
    response.JWT ||
    response.action ||
    response.threeDSMethodData ||
    response.methodUrl
  )
}

function isTransientPollError(error: unknown): boolean {
  if (error instanceof PayApiError) {
    if (error.status != null && error.status >= 500) return true
    if (error.returnCode && error.returnCode !== '0000') return false
    return error.status == null
  }
  return error instanceof TypeError
}

function runtimeConfigFromOrder(
  config: PaySdkConfig,
  order: CreateOrderResponse,
  api: PayApiClient,
  onWalletAuthorized: (result: PayResult) => void | Promise<void>,
  onAuthorizePay: (result: PayResult) => void | Promise<void>
): RuntimeWalletConfig {
  // Google Pay PaymentsClient.environment: create-order only (not init.environment)
  const walletEnvironment = resolveEnvironment(order.environment)
  const common = {
    container: config.container,
    environment: walletEnvironment,
    risk: order.risk,
    onAuthorizePay,
    onSuccess: onWalletAuthorized,
    onError: config.onError,
    onCancel: config.onCancel
  }

  if (order.method === 'googlePay') {
    const paymentScript = order.paymentScript
    const card = paymentScript.allowedPaymentMethods[0]
    if (!card?.tokenizationSpecification) {
      throw new Error('Create order response is missing Google Pay tokenizationSpecification')
    }
    const parameters = card.parameters as google.payments.api.CardParameters
    return {
      ...common,
      method: 'googlePay',
      payment: {
        amount: paymentScript.transactionInfo.totalPrice,
        currency: paymentScript.transactionInfo.currencyCode,
        countryCode: paymentScript.transactionInfo.countryCode || ''
      },
      billingAddressRequired: parameters.billingAddressRequired === true,
      googlePay: {
        merchantId: paymentScript.merchantInfo.merchantId,
        merchantName: paymentScript.merchantInfo.merchantName,
        allowedAuthMethods: parameters.allowedAuthMethods,
        allowedCardNetworks: parameters.allowedCardNetworks,
        tokenizationSpecification: card.tokenizationSpecification,
        paymentDataRequest: {
          ...paymentScript,
          callbackIntents: ['PAYMENT_AUTHORIZATION']
        }
      }
    }
  }

  const validateMerchantUrl = api.getValidateMerchantUrl(order.validateMerchantUrl)
  const paymentScript = order.paymentScript
  return {
    ...common,
    method: 'applePay',
    payment: {
      amount: paymentScript.total.amount,
      currency: paymentScript.currencyCode,
      countryCode: paymentScript.countryCode
    },
    billingAddressRequired: (paymentScript.requiredBillingContactFields?.length || 0) > 0,
    applePay: {
      validateMerchantUrl,
      validateMerchant: (validationURL) =>
        api.validateMerchant(validateMerchantUrl, order.orderNo, validationURL),
      merchantCapabilities: paymentScript.merchantCapabilities,
      supportedNetworks: paymentScript.supportedNetworks,
      totalLabel: paymentScript.total.label,
      totalType: paymentScript.total.type,
      paymentRequest: paymentScript
    }
  }
}

class PaySdk implements PaySdkInstance {
  private readonly config: PaySdkConfig
  private api: PayApiClient
  private readonly actionView = new PaymentActionView()
  private readonly fingerprintIdPromise: Promise<string>
  private _readyPromise: Promise<true> | null = null
  private _button: HTMLElement | null = null
  private runtimeConfig: RuntimeWalletConfig | null = null
  private order: CreateOrderResponse | null = null
  private pollTimer: number | null = null
  private pollDelayResolve: (() => void) | null = null
  private pollGeneration = 0
  private paymentInFlight = false
  private settledPayment = false
  private destroyed = false
  private earlyPayPromise: Promise<PayResponse> | null = null
  private pollContext: {
    walletResult: PayResult
    paymentResponse: PayResponse
    generation: number
  } | null = null
  private forceCheckInFlight = false

  constructor(config: PaySdkConfig) {
    this.config = config
    this.fingerprintIdPromise = collectFingerprint()
    this.api = new PayApiClient(this.buildApiConfig(resolveEnvironment(config.environment)))
  }

  private buildApiConfig(environment: ReturnType<typeof resolveEnvironment>) {
    return resolvePayApiConfig(environment, {
      ...this.config.api,
      paymentHubToken: this.api?.getPaymentHubToken() || this.config.order?.token,
      getFingerprintId: () => this.fingerprintIdPromise
    })
  }

  ready(): Promise<true> {
    if (!this._readyPromise) {
      this._readyPromise = this.prepare()
    }
    return this._readyPromise
  }

  private async prepare(): Promise<true> {
    if (!this.runtimeConfig) {
      // Merchant (or demo) already created the order; SDK does not call createOrder.
      const order = normalizeCreateOrderResponse(this.config.order)
      this.order = order
      this.config.onOrderCreated?.(order)

      // API / Checkout Risk: init.environment, else create-order environment
      const apiEnvironment = resolveEnvironment(this.config.environment || order.environment)
      const prevTraceId = this.api.getLastTraceId()
      this.api = new PayApiClient(this.buildApiConfig(apiEnvironment))
      this.api.restoreLastTraceId(prevTraceId)
      this.api.setPaymentHubToken(order.token)

      this.runtimeConfig = runtimeConfigFromOrder(
        this.config,
        order,
        this.api,
        async (result) => {
          await this.processPayment(result)
        },
        async (result) => {
          await this.authorizePay(result)
        }
      )

      this.runtimeConfig.riskCollection = collectRisk(this.runtimeConfig.risk, apiEnvironment)
      void Promise.all([this.fingerprintIdPromise, this.runtimeConfig.riskCollection]).then(
        ([fingerprintId, risk]) => {
          this.config.onRiskCollected?.({
            fingerprintId: fingerprintId || undefined,
            risk
          })
        }
      )
      this.bindSecondaryReturnHook()
    }
    return detectReady(this.runtimeConfig)
  }

  /**
   * Synchronously open the wallet sheet. Must run inside a user-gesture stack
   * (e.g. button click). Call only after `ready()` has resolved.
   */
  pay(): void {
    const config = this.runtimeConfig
    if (!config) {
      throw new Error('Pay SDK is not ready; call ready() first')
    }
    if (this.destroyed) {
      throw new Error('Pay SDK has been destroyed')
    }
    if (config.method === 'googlePay') {
      void payWithGoogle(config)
      return
    }
    payWithApple(config)
  }

  mount(): this {
    if (!this.config.container) {
      throw new Error(
        'config.container is required for mount(); omit mount and call pay() for a custom button'
      )
    }
    if (this.runtimeConfig) {
      this.render()
    } else {
      void this.ready()
        .then(() => this.render())
        .catch((error) => this.config.onError?.(toError(error)))
    }
    return this
  }

  openAction(action: PaymentAction): void {
    this.actionView.open(action)
  }

  getLastTraceId(): string | undefined {
    return this.api.getLastTraceId()
  }

  getBridgeName(): string {
    return normalizeBridgeName(this.config.bridgeName)
  }

  getBridge(): PayNativeBridge | undefined {
    return getNativeBridge(this.getBridgeName())
  }

  private getActionMode(): PaymentActionMode {
    return this.config.actionMode || 'callback'
  }

  private async dispatchAction(
    action: PaymentAction
  ): Promise<'navigated' | 'opened' | 'deferred'> {
    this.config.onAction?.(action)
    if (this.getActionMode() !== 'auto') return 'deferred'

    const handled = this.config.openAction ? await this.config.openAction(action) : false
    if (handled === true) return 'opened'

    this.actionView.open(action)
    if (action.type === 'webUrl' || action.type === 's3ds') return 'navigated'
    return 'opened'
  }

  private render(): void {
    if (this.destroyed || !this.runtimeConfig || !this.runtimeConfig.container) return
    this._button = renderButton(this.runtimeConfig, () => this.pay())
  }

  /**
   * 钱包授权后、关 sheet 前调用：await api.pay，缓存到 earlyPayPromise。
   * 失败抛错给钱包层（GP return ERROR / Apple FAILURE），不走 onAction。
   */
  private async authorizePay(walletResult: PayResult): Promise<void> {
    if (this.destroyed || !this.order) {
      throw new Error('Order is not ready')
    }
    if (this.earlyPayPromise || this.settledPayment) {
      if (this.earlyPayPromise) await this.earlyPayPromise
      return
    }

    this.paymentInFlight = true
    this.settledPayment = false
    const payPromise = this.api.pay(this.buildPayRequest(walletResult))
    this.earlyPayPromise = payPromise
    try {
      await payPromise
    } catch (error) {
      this.earlyPayPromise = null
      this.paymentInFlight = false
      throw error instanceof Error ? error : toError(error)
    }
  }

  private async processPayment(walletResult: PayResult): Promise<void> {
    if (!this.order) {
      throw new Error('Order is not ready')
    }
    if (this.destroyed || this.settledPayment) return

    const early = this.earlyPayPromise
    if (!early && this.paymentInFlight) {
      throw new Error('Payment already in progress')
    }

    this.paymentInFlight = true
    try {
      // early 已在 authorizePay 中 await 完成时，此处几乎立刻拿到响应并 onAction
      const paymentResponse = await (early ?? this.api.pay(this.buildPayRequest(walletResult)))
      this.earlyPayPromise = null
      if (this.destroyed || this.settledPayment) return

      if (!hasSecondaryAction(paymentResponse)) {
        this.finish(walletResult, paymentResponse)
        return
      }

      const action = describePayResponse(paymentResponse)
      if (this.destroyed || this.settledPayment) return
      // auto + webUrl/s3ds → location.assign ('navigated'): page is leaving; do not poll
      // callback / Bridge openAction / threeDS·Method → keep poll (WebView unchanged)
      if (action) {
        const outcome = await this.dispatchAction(action)
        if (outcome === 'navigated') return
      }
      void this.pollOrder(walletResult, paymentResponse)
    } catch (error) {
      this.earlyPayPromise = null
      this.paymentInFlight = false
      this.stopPolling()
      this.actionView.destroy()
      throw error instanceof Error ? error : toError(error)
    }
  }

  private buildPayRequest(walletResult: PayResult) {
    if (!this.order) throw new Error('Order is not ready')

    if (walletResult.method === 'googlePay') {
      if (!walletResult.token) throw new Error('Google Pay token is missing')
      return buildAlchemyPayRequest({
        orderNo: this.order.orderNo,
        encryptedData: walletResult.token,
        billingAddress: normalizeGoogleBillingAddress(
          walletResult.billingAddress,
          walletResult.email
        ),
        risk: walletResult.risk
      })
    }

    if (!walletResult.token) throw new Error('Apple Pay token is missing')
    const encryptedData = walletResult.raw
      ? JSON.stringify(walletResult.raw)
      : JSON.stringify(normalizeAppleToken(walletResult.token))
    return buildAlchemyPayRequest({
      orderNo: this.order.orderNo,
      encryptedData,
      billingAddress: normalizeAppleBillingAddress(walletResult.billingContact),
      risk: walletResult.risk
    })
  }

  private async pollOrder(walletResult: PayResult, paymentResponse: PayResponse): Promise<void> {
    const apiConfig = this.config.api
    const interval = apiConfig?.pollIntervalMs || 2_000
    const timeoutMs = apiConfig?.pollTimeoutMs ?? 300_000
    const startedAt = Date.now()
    const generation = ++this.pollGeneration
    this.pollContext = { walletResult, paymentResponse, generation }
    let lastS3dsUrl = ''
    let consecutiveTransientErrors = 0
    let firstTick = true

    while (!this.destroyed && this.order && generation === this.pollGeneration) {
      if (!firstTick) await this.delay(interval)
      firstTick = false
      if (this.destroyed || !this.order || generation !== this.pollGeneration) return

      if (Date.now() - startedAt > timeoutMs) {
        this.fail(new Error('Payment status polling timed out'))
        return
      }

      try {
        const current = await this.api.queryOrder()
        if (this.destroyed || generation !== this.pollGeneration) return
        consecutiveTransientErrors = 0
        this.config.onStatusChange?.(current)

        if (isValidS3dsUrl(current.s3dsUrl) && current.s3dsUrl !== lastS3dsUrl) {
          lastS3dsUrl = current.s3dsUrl
          const outcome = await this.dispatchAction(describeS3ds(current.s3dsUrl))
          if (outcome === 'navigated') {
            this.stopPolling()
            return
          }
        }

        const terminal = this.applyOrderStatus(walletResult, paymentResponse, current)
        if (terminal) return
      } catch (error) {
        if (this.destroyed || generation !== this.pollGeneration) return
        if (isTransientPollError(error)) {
          consecutiveTransientErrors += 1
          if (consecutiveTransientErrors < 5) continue
        }
        this.fail(toError(error))
        return
      }
    }
  }

  /**
   * @returns true 已终态结算；false 仍 pending，继续 poll
   */
  private applyOrderStatus(
    walletResult: PayResult,
    paymentResponse: PayResponse,
    current: QueryOrderResponse
  ): boolean {
    // 仅 orderState === PENDING 且未 s3dsComplete 时继续（有 s3dsUrl 但未导航也继续）
    if (current.orderState === ORDER_STATE_PENDING && current.s3dsComplete !== true) {
      return false
    }

    if (ORDER_STATE_FAIL.has(current.orderState)) {
      this.fail(
        new Error(
          current.failureReason || `Payment failed (${orderStateLabel(current.orderState)})`
        )
      )
      return true
    }
    if (ORDER_STATE_SUCCESS.has(current.orderState)) {
      this.finish(walletResult, paymentResponse, current)
      return true
    }
    // 其它非 pending（TRANSFER 等）或仅 s3dsComplete
    this.complete(walletResult, paymentResponse, current)
    return true
  }

  /**
   * Native 二级页命中 redirectUrl/callbackUrl 后调用 window.__paySdkSecondaryReturn()：
   * 立刻查单；终态走 onSuccess/onError，否则继续原 poll。
   */
  private async forceOrderCheck(): Promise<void> {
    if (this.destroyed || this.settledPayment || this.forceCheckInFlight) return
    const ctx = this.pollContext
    if (!ctx || ctx.generation !== this.pollGeneration || !this.order) return

    this.forceCheckInFlight = true
    try {
      const current = await this.api.queryOrder()
      if (this.destroyed || ctx.generation !== this.pollGeneration || this.settledPayment) return
      this.config.onStatusChange?.(current)

      // 不在此重派 s3ds（避免重复开抽屉）；仅催终态判定，新 s3ds 仍由 poll 循环处理
      const terminal = this.applyOrderStatus(ctx.walletResult, ctx.paymentResponse, current)
      if (!terminal) this.wakePollDelay()
    } catch (error) {
      if (this.destroyed || ctx.generation !== this.pollGeneration) return
      if (isTransientPollError(error)) {
        this.wakePollDelay()
        return
      }
      this.fail(toError(error))
    } finally {
      this.forceCheckInFlight = false
    }
  }

  private wakePollDelay(): void {
    if (this.pollTimer != null) {
      window.clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    const resume = this.pollDelayResolve
    this.pollDelayResolve = null
    resume?.()
  }

  private bindSecondaryReturnHook(): void {
    if (typeof window === 'undefined') return
    window.__paySdkSecondaryReturn = () => {
      void this.forceOrderCheck()
    }
  }

  private unbindSecondaryReturnHook(): void {
    if (typeof window === 'undefined') return
    if (window.__paySdkSecondaryReturn) {
      delete window.__paySdkSecondaryReturn
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.pollDelayResolve = () => resolve()
      this.pollTimer = window.setTimeout(() => {
        this.pollDelayResolve = null
        this.pollTimer = null
        resolve()
      }, ms)
    })
  }

  private stopPolling(): void {
    this.pollGeneration += 1
    this.pollContext = null
    if (this.pollTimer != null) {
      window.clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    const resume = this.pollDelayResolve
    this.pollDelayResolve = null
    resume?.()
  }

  private settleResult(order?: QueryOrderResponse): PaySdkSettleResult {
    return {
      orderNo: this.order?.orderNo,
      order
    }
  }

  private finish(
    _walletResult: PayResult,
    _paymentResponse: PayResponse,
    order?: QueryOrderResponse
  ): void {
    if (this.destroyed || this.settledPayment) return
    this.settledPayment = true
    this.stopPolling()
    this.actionView.destroy()
    this.paymentInFlight = false
    this.earlyPayPromise = null
    const result = this.settleResult(order)
    void this.config.onSuccess?.(result)
    this.config.onComplete?.(result)
  }

  private complete(
    _walletResult: PayResult,
    _paymentResponse: PayResponse,
    order: QueryOrderResponse
  ): void {
    if (this.destroyed || this.settledPayment) return
    this.settledPayment = true
    this.stopPolling()
    this.actionView.destroy()
    this.paymentInFlight = false
    this.earlyPayPromise = null
    this.config.onComplete?.(this.settleResult(order))
  }

  private fail(error: Error): void {
    if (this.destroyed || this.settledPayment) return
    this.settledPayment = true
    this.stopPolling()
    this.actionView.destroy()
    this.paymentInFlight = false
    this.earlyPayPromise = null
    this.config.onError?.(error)
  }

  destroy(): void {
    this.destroyed = true
    this.unbindSecondaryReturnHook()
    this.stopPolling()
    this.actionView.destroy()
    this.paymentInFlight = false
    this.earlyPayPromise = null
    this._button?.remove()
    this._button = null
    if (this.runtimeConfig?.container) {
      resolveContainer(this.runtimeConfig.container).replaceChildren()
    }
  }
}

export const version: string = __SDK_VERSION__

export function init(config: PaySdkConfig): PaySdkInstance {
  validateConfig(config)
  return new PaySdk(config)
}

declare global {
  interface Window {
    RampPay: {
      init: typeof init
      version: string
      describeS3ds: typeof describeS3ds
      describePayResponse: typeof describePayResponse
      DEFAULT_BRIDGE_NAME: typeof DEFAULT_BRIDGE_NAME
      getNativeBridge: typeof getNativeBridge
      normalizeBridgeName: typeof normalizeBridgeName
    }
    /** Default App WebView Bridge (`bridgeName` omitted). */
    NativeBridge?: PayNativeBridge
    /** Native 二级页命中 redirect/callback 后调用，催原页立刻查单 */
    __paySdkSecondaryReturn?: () => void
  }
}

if (typeof window !== 'undefined') {
  window.RampPay = {
    init,
    version,
    describeS3ds,
    describePayResponse,
    DEFAULT_BRIDGE_NAME,
    getNativeBridge,
    normalizeBridgeName
  }
}
