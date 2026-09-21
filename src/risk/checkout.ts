import type { Environment, RiskCheckoutConfig } from '../types.js'
import { loadScript } from '../loader.js'
import { mergeCheckoutConfig } from './defaults.js'
import { withTimeout } from './timeout.js'

/** 对齐 ramp-vue `RISK_TIMEOUT_MS`（脚本加载）；整段采集含 publishRiskData 一并封顶。 */
const TIMEOUT_MS = 8_000

interface CheckoutRiskInstance {
  publishRiskData(): Promise<string>
}

interface CheckoutRiskStatic {
  create(publicKey: string): Promise<CheckoutRiskInstance>
}

declare global {
  interface Window {
    Risk?: CheckoutRiskStatic
  }
}

/** 同页复用 deviceSessionId；并发共用一次采集。 */
let cachedDeviceSessionId: string | null = null
let inflight: Promise<string> | null = null

async function ensureRiskJs(scriptUrl: string, integrity: string): Promise<CheckoutRiskStatic> {
  if (window.Risk) return window.Risk
  await loadScript(scriptUrl, {
    id: 'risk-js',
    integrity: integrity || undefined,
    crossorigin: true,
    defer: true
  })
  if (!window.Risk) {
    throw new Error('Checkout Risk.js loaded but window.Risk is missing')
  }
  return window.Risk
}

/**
 * Checkout Risk.js 采集 deviceSessionId（SDK 3.3.1）。
 * https://www.checkout.com/docs/developer-resources/sdks/risk-sdks/risk-js-sdk
 * enabled 由 collectRisk 判断；失败、脚本挂起或超过 8s 返回 ""，不阻断支付。
 * environment=TEST 且未下发 publicKey 时，使用沙盒默认 key。
 */
export async function collectCheckout(
  cfg?: RiskCheckoutConfig,
  environment?: Environment
): Promise<string> {
  if (cachedDeviceSessionId) return cachedDeviceSessionId
  if (inflight) return inflight

  const run = (async () => {
    try {
      const merged = mergeCheckoutConfig(cfg, environment)
      if (!merged.publicKey) return ''

      const Risk = await ensureRiskJs(merged.scriptUrl, merged.integrity)
      const risk = await Risk.create(merged.publicKey)
      const deviceSessionId = await risk.publishRiskData()
      const id = typeof deviceSessionId === 'string' ? deviceSessionId : ''
      if (id) cachedDeviceSessionId = id
      return id
    } catch {
      return ''
    }
  })()

  // 并发复用同一条带超时的 Promise，避免后加入的调用方重新挂死
  inflight = withTimeout(run, TIMEOUT_MS, '')
  void run.finally(() => {
    inflight = null
  })
  return inflight
}
