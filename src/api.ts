import type {
  ApiResponse,
  ApplePayParams,
  CreateOrderRequest,
  CreateOrderResponse,
  CreateOrderResponseApplePay,
  CreateOrderRisk,
  Environment,
  GooglePayParams,
  PayApiConfig,
  PayMethod,
  PayRequest,
  PayResponse,
  QueryOrderResponse
} from './types.js'

const SUCCESS_RETURN_CODE = '0000'

export interface GetTokenRequest {
  email?: string
  uid?: string
}

export interface GetTokenResponse {
  accessToken: string
  id?: string
  email?: string
}

export class PayApiError extends Error {
  readonly returnCode?: string
  readonly traceId?: string
  readonly status?: number

  constructor(
    message: string,
    details: { returnCode?: string; traceId?: string; status?: number } = {}
  ) {
    super(message)
    this.name = 'PayApiError'
    this.returnCode = details.returnCode
    this.traceId = details.traceId
    this.status = details.status
  }
}

/** 服务端创建订单 data（method 可选，可由 paymentScript 推断） */
interface CreateOrderWireData {
  orderNo: string
  /** 对象直接用；部分服务端会下发 JSON 字符串，normalize 时解析 */
  paymentScript: GooglePayParams | ApplePayParams | string
  token: string
  risk?: CreateOrderRisk
  method?: PayMethod
  environment?: Environment
  validateMerchantUrl?: string
}

function isGooglePayScript(script: GooglePayParams | ApplePayParams): script is GooglePayParams {
  return Array.isArray((script as GooglePayParams).allowedPaymentMethods)
}

function isApplePayScript(script: GooglePayParams | ApplePayParams): script is ApplePayParams {
  return Array.isArray((script as ApplePayParams).merchantCapabilities) || 'total' in script
}

/** 对象原样返回；字符串则 JSON.parse，失败抛错 */
function coercePaymentScript(
  raw: GooglePayParams | ApplePayParams | string | null | undefined
): GooglePayParams | ApplePayParams {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) {
      throw new PayApiError('Create order response is missing paymentScript')
    }
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') {
        return parsed as GooglePayParams | ApplePayParams
      }
    } catch {
      throw new PayApiError('Create order response paymentScript is invalid JSON')
    }
  }
  throw new PayApiError('Create order response is missing paymentScript')
}

export function normalizeCreateOrderResponse(
  data: CreateOrderWireData | CreateOrderResponse
): CreateOrderResponse {
  if (!data?.orderNo) {
    throw new PayApiError('Create order response is missing orderNo')
  }
  const paymentScript = coercePaymentScript(data.paymentScript)
  const token = typeof data.token === 'string' ? data.token.trim() : ''
  if (!token) {
    throw new PayApiError('Create order response is missing token')
  }

  let method = data.method
  if (!method) {
    if (isGooglePayScript(paymentScript)) method = 'googlePay'
    else if (isApplePayScript(paymentScript)) method = 'applePay'
    else throw new PayApiError('Create order response paymentScript is not Google or Apple Pay')
  }

  if (method === 'googlePay') {
    const script = { ...(paymentScript as GooglePayParams) }
    const environment = data.environment || script.environment
    if ('environment' in script) delete script.environment
    return {
      orderNo: data.orderNo,
      method: 'googlePay',
      environment,
      paymentScript: script,
      token,
      risk: data.risk
    }
  }

  const appleWire = data as CreateOrderWireData & CreateOrderResponseApplePay
  return {
    orderNo: data.orderNo,
    method: 'applePay',
    environment: data.environment,
    paymentScript: paymentScript as ApplePayParams,
    token,
    validateMerchantUrl: appleWire.validateMerchantUrl,
    risk: data.risk
  }
}

/** 查单 wire：H5 用 orderStatus，Apifox 用 orderState */
interface QueryOrderWireData extends Omit<QueryOrderResponse, 'orderState'> {
  orderState?: number
  orderStatus?: number
}

export function normalizeQueryOrderResponse(data: QueryOrderWireData): QueryOrderResponse {
  const raw = data.orderState ?? data.orderStatus
  const orderState = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(orderState)) {
    throw new PayApiError('Query order response is missing orderState')
  }
  const orderNo = data.orderNo
  if (!orderNo) {
    throw new PayApiError('Query order response is missing orderNo')
  }
  return {
    ...data,
    orderNo,
    orderState,
    s3dsUrl: typeof data.s3dsUrl === 'string' ? data.s3dsUrl : undefined,
    s3dsComplete: data.s3dsComplete === true
  }
}

export class PayApiClient {
  private readonly config: PayApiConfig
  private readonly fetcher: typeof fetch
  private paymentHubToken: string | undefined
  private lastTraceId: string | undefined

  constructor(config: PayApiConfig) {
    this.config = config
    this.fetcher = config.fetch || window.fetch.bind(window)
    this.paymentHubToken = config.paymentHubToken?.trim() || undefined
  }

  getPaymentHubToken(): string | undefined {
    return this.paymentHubToken
  }

  setPaymentHubToken(token?: string): void {
    this.paymentHubToken = token?.trim() || undefined
  }

  getLastTraceId(): string | undefined {
    return this.lastTraceId
  }

  /** 重建 client 时保留最近一次 traceId */
  restoreLastTraceId(traceId?: string): void {
    if (traceId) this.lastTraceId = traceId
  }

  /**
   * @deprecated SDK 编排不再调用。legacy：优先 accessToken，否则 getToken。
   */
  async ensureAccessToken(identity: {
    accessToken?: string
    email?: string
    uid?: string
  }): Promise<string> {
    const provided = identity.accessToken?.trim()
    if (provided) {
      return provided
    }

    const email = identity.email?.trim()
    const uid = identity.uid?.trim()
    if (!email && !uid) {
      throw new PayApiError(
        'accessToken or email/uid is required (prefer passing accessToken from your server)'
      )
    }

    const body: GetTokenRequest = email ? { email } : { uid: uid! }
    const data = await this.getToken(body)
    const token = data?.accessToken?.trim()
    if (!token) {
      throw new PayApiError('Get token response is missing accessToken')
    }
    return token
  }

  /** @deprecated SDK 编排不再调用。legacy / demo。 */
  getToken(request: GetTokenRequest): Promise<GetTokenResponse> {
    return this.request<GetTokenResponse>(this.config.getTokenUrl, 'POST', request)
  }

  /** @deprecated SDK 编排不再调用；创建订单由商户/demo 完成。 */
  async createOrder(request: CreateOrderRequest): Promise<CreateOrderResponse> {
    const data = await this.request<CreateOrderWireData>(
      this.config.createOrderUrl,
      'POST',
      request
    )
    return normalizeCreateOrderResponse(data)
  }

  getValidateMerchantUrl(override?: string): string {
    return override || this.config.validateMerchantUrl
  }

  validateMerchant(
    url: string | undefined,
    orderNo: string,
    validationURL: string
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(this.getValidateMerchantUrl(url), 'POST', {
      orderNo,
      validationURL
    })
  }

  pay(request: PayRequest): Promise<PayResponse> {
    return this.request<PayResponse>(this.config.payUrl, 'POST', request)
  }

  async queryOrder(): Promise<QueryOrderResponse> {
    const data = await this.request<QueryOrderWireData>(this.config.queryOrderUrl, 'GET')
    return normalizeQueryOrderResponse(data)
  }

  private async resolveHeaders(
    _url: string,
    _method: 'GET' | 'POST',
    bodyString: string
  ): Promise<Record<string, string>> {
    const configured =
      typeof this.config.headers === 'function' ? await this.config.headers() : this.config.headers
    const headers: Record<string, string> =
      bodyString !== '' ? { 'Content-Type': 'application/json', ...configured } : { ...configured }

    // SDK runtime does not sign; demo signs create-order via demo/signed-api.js.

    if (this.paymentHubToken) {
      headers['payment-hub-token'] = this.paymentHubToken
    }

    // legacy: access-token from getToken
    // const isGetToken = url.replace(/\/$/, '') === this.config.getTokenUrl.replace(/\/$/, '')
    // if (this.accessToken && !isGetToken) {
    //   headers['access-token'] = this.accessToken
    // }

    if (this.config.getFingerprintId) {
      const fingerprintId = await this.config.getFingerprintId()
      if (fingerprintId) headers['fingerprint-id'] = fingerprintId
    }

    return headers
  }

  private async request<T>(url: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const bodyString = body === undefined ? '' : JSON.stringify(body)
    let response: Response
    try {
      response = await this.fetcher(url, {
        method,
        headers: await this.resolveHeaders(url, method, bodyString),
        body: bodyString === '' ? undefined : bodyString
      })
    } catch (error) {
      throw error instanceof Error ? error : new PayApiError('Pay API network request failed')
    }

    let envelope: ApiResponse<T>
    try {
      envelope = (await response.json()) as ApiResponse<T>
    } catch {
      throw new PayApiError(
        response.ok
          ? 'Pay API returned invalid JSON'
          : `Pay API request failed with status ${response.status}`,
        { status: response.status }
      )
    }

    if (envelope?.traceId) {
      this.lastTraceId = envelope.traceId
    }

    // Demo-friendly: log create-order / alchemy-pay envelopes for Mock paste
    if (
      typeof console !== 'undefined' &&
      (url.includes('/merchant/order/create') || url.includes('/payment-hub/alchemy-pay'))
    ) {
      const label = url.includes('/alchemy-pay')
        ? '[PaySdk] 支付接口返回（完整 JSON，可复制）'
        : '[PaySdk] 创建订单接口返回（完整 JSON，可复制）'
      try {
        console.log(label, envelope)
        console.log(label + ' JSON 字符串\n' + JSON.stringify(envelope, null, 2))
      } catch {
        /* ignore console failures */
      }
    }

    if (!response.ok || !envelope || envelope.returnCode !== SUCCESS_RETURN_CODE) {
      throw new PayApiError(envelope?.returnMsg || 'Pay API request failed', {
        returnCode: envelope?.returnCode,
        traceId: envelope?.traceId || this.lastTraceId,
        status: response.status
      })
    }

    return envelope.data
  }
}
