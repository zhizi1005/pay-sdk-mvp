import type { PayResult, RuntimeWalletConfig } from './types.js'
import { normalizeGoogleResult, toError } from './normalize.js'
import { awaitRiskForPay, resolveRiskCollection } from './risk/index.js'

/** Button page on the Google Pay approved host. Do not derive this from pay.min.js. */
export const GOOGLE_PAY_BUTTON_URL = 'https://ramp.alchemypay.org/payments/google-pay-button.html'

const FRAME_ORIGIN = 'https://ramp.alchemypay.org'
const PARENT_SOURCE = 'ramp-pay'
const CHILD_SOURCE = 'ramp-pay-button'
const FRAME_READY_TIMEOUT_MS = 20000

export const CUSTOM_BUTTON_WARN =
  'RampPay: custom buttons are not recommended. Pass container and call mount(). This version still opens the Apple Pay sheet from pay(). Google Pay pay() places the official button inside the clicked button; tap that button to pay.'

interface ChildMessage {
  source?: string
  type?: string
  message?: string
  paymentData?: google.payments.api.PaymentData
}

interface Handshake {
  resolve: () => void
  reject: (error: Error) => void
}

function buttonPayload(config: RuntimeWalletConfig) {
  const btn = config.googlePay?.button || {}
  return {
    buttonColor: btn.buttonColor || 'default',
    buttonType: btn.buttonType || 'plain',
    buttonSizeMode: btn.buttonSizeMode || 'fill',
    buttonLocale: btn.buttonLocale
  }
}

export function clickedCustomButton(): HTMLButtonElement | null {
  const el = document.activeElement
  return el instanceof HTMLButtonElement ? el : null
}

/**
 * Hosts the Google Pay button on ramp.alchemypay.org and keeps pay / polling on the parent.
 */
export class GooglePayFrame {
  private iframe: HTMLIFrameElement | null = null
  private onMessage: ((event: MessageEvent) => void) | null = null
  private handshake: Handshake | null = null
  private timer: number | null = null
  private settled = false
  private authorizedResult: PayResult | null = null
  private destroyed = false

  constructor(private readonly config: RuntimeWalletConfig) {}

  isAttached(): boolean {
    return !!this.iframe
  }

  attach(container: HTMLElement): Promise<void> {
    this.teardown(new Error('Google Pay button frame was replaced'))
    this.settled = false
    this.authorizedResult = null
    this.destroyed = false

    const iframe = document.createElement('iframe')
    iframe.title = 'Google Pay'
    iframe.setAttribute('allow', 'payment')
    iframe.setAttribute('sandbox', 'allow-scripts allow-popups allow-same-origin allow-forms')
    iframe.style.width = '100%'
    iframe.style.height = '100%'
    iframe.style.minHeight = '40px'
    iframe.style.border = '0'
    iframe.style.display = 'block'
    iframe.style.pointerEvents = 'auto'
    if (container instanceof HTMLButtonElement) {
      container.style.pointerEvents = 'none'
    }
    this.iframe = iframe
    this.bind()

    const ready = new Promise<void>((resolve, reject) => {
      this.handshake = { resolve, reject }
      this.timer = window.setTimeout(() => {
        this.failHandshake(new Error('Google Pay button frame timed out'))
      }, FRAME_READY_TIMEOUT_MS)
    })
    iframe.src = GOOGLE_PAY_BUTTON_URL
    container.replaceChildren(iframe)
    return ready
  }

  destroy(): void {
    this.destroyed = true
    this.teardown(new Error('Pay SDK has been destroyed'))
  }

  private bind(): void {
    this.onMessage = (event: MessageEvent) => this.handleMessage(event)
    window.addEventListener('message', this.onMessage)
  }

  private teardown(reason?: Error): void {
    if (this.timer != null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
    if (reason && this.handshake) {
      const pending = this.handshake
      this.handshake = null
      pending.reject(reason)
    }
    if (this.onMessage) {
      window.removeEventListener('message', this.onMessage)
      this.onMessage = null
    }
    this.iframe?.remove()
    this.iframe = null
  }

  private post(message: Record<string, unknown>): void {
    const target = this.iframe?.contentWindow
    if (!target) return
    target.postMessage({ source: PARENT_SOURCE, ...message }, FRAME_ORIGIN)
  }

  private failHandshake(error: Error): void {
    if (this.timer != null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
    const pending = this.handshake
    this.handshake = null
    pending?.reject(error)
  }

  private handleMessage(event: MessageEvent): void {
    if (this.destroyed) return
    if (event.origin !== FRAME_ORIGIN) return
    if (!this.iframe || event.source !== this.iframe.contentWindow) return
    const data = event.data as ChildMessage
    if (!data || data.source !== CHILD_SOURCE || !data.type) return

    if (data.type === 'frameReady') {
      const request = this.config.googlePay?.paymentDataRequest
      if (!request) {
        this.failHandshake(new Error('Create order response is missing Google Pay paymentScript'))
        return
      }
      this.post({
        type: 'init',
        environment: this.config.environment === 'TEST' ? 'TEST' : 'PRODUCTION',
        paymentDataRequest: request,
        button: buttonPayload(this.config)
      })
      return
    }

    if (data.type === 'ready') {
      if (this.timer != null) {
        window.clearTimeout(this.timer)
        this.timer = null
      }
      const pending = this.handshake
      this.handshake = null
      pending?.resolve()
      return
    }

    if (data.type === 'unavailable' || data.type === 'error') {
      const error = new Error(data.message || 'Google Pay is not available')
      if (this.handshake) {
        this.failHandshake(error)
        return
      }
      if (!this.settled) {
        this.settled = true
        this.config.onError?.(error)
      }
      return
    }

    if (data.type === 'authorized') {
      void this.handleAuthorized(data.paymentData)
      return
    }

    if (data.type === 'sheetClosed') {
      void this.handleSheetClosed()
      return
    }

    if (data.type === 'cancel') {
      if (!this.settled) {
        this.settled = true
        this.config.onCancel?.()
      }
    }
  }

  private async handleAuthorized(
    paymentData: google.payments.api.PaymentData | undefined
  ): Promise<void> {
    if (this.destroyed || this.settled || !paymentData) {
      this.post({
        type: 'authorizeResult',
        ok: false,
        message: 'Payment is not active'
      })
      return
    }

    try {
      const risk = await awaitRiskForPay(resolveRiskCollection(this.config))
      const authorized = { ...normalizeGoogleResult(paymentData), risk }
      await this.config.onAuthorizePay?.(authorized)
      if (this.destroyed || this.settled) {
        this.post({
          type: 'authorizeResult',
          ok: false,
          message: 'Payment authorization timed out'
        })
        return
      }
      this.authorizedResult = authorized
      this.settled = true
      this.post({ type: 'authorizeResult', ok: true })
    } catch (err) {
      const error = toError(err)
      if (!this.settled && !this.destroyed) {
        this.settled = true
        this.config.onError?.(error)
      }
      this.post({ type: 'authorizeResult', ok: false, message: error.message })
    }
  }

  private async handleSheetClosed(): Promise<void> {
    if (!this.authorizedResult || this.destroyed) return
    try {
      await this.config.onSuccess?.(this.authorizedResult)
    } catch (err) {
      this.config.onError?.(toError(err))
    }
  }
}
