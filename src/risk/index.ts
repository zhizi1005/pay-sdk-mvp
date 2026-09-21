import type { CreateOrderRisk, Environment, PayRiskPayload, RuntimeWalletConfig } from '../types.js'
import { collectForter } from './forter.js'
import { collectCheckout } from './checkout.js'
import { collectWorldPay } from './worldpay.js'
import { withTimeout } from './timeout.js'

/** 授权时最多再等这么久；超时用已采到的字段继续支付（对齐 ramp-vue 失败不挡支付）。 */
const PAY_WAIT_MS = 8_000

const riskSnapshots = new WeakMap<Promise<PayRiskPayload>, PayRiskPayload>()

function isEnabled(enabled?: boolean): boolean {
  return enabled === true
}

function snapshotOf(promise: Promise<PayRiskPayload>): PayRiskPayload {
  const snap = riskSnapshots.get(promise)
  return snap ? { ...snap } : {}
}

/**
 * 按 Forter → Checkout → WorldPay 并行采集（支付 body）。
 * Fingerprint 由 SDK init 独立采集，仅走请求头 fingerprint-id。
 * 仅 enabled === true 的块会执行；失败字段不写入 payload。
 */
export function collectRisk(
  risk?: CreateOrderRisk,
  environment?: Environment
): Promise<PayRiskPayload> {
  const payload: PayRiskPayload = {}
  const promise = (async () => {
    if (!risk) return payload

    const tasks: Array<Promise<void>> = []

    if (isEnabled(risk.forter?.enabled)) {
      tasks.push(
        collectForter(risk.forter)
          .then((token) => {
            if (token) payload.forter = { token }
          })
          .catch(() => undefined)
      )
    }

    if (isEnabled(risk.checkout?.enabled)) {
      tasks.push(
        collectCheckout(risk.checkout, environment)
          .then((deviceSessionId) => {
            if (deviceSessionId) payload.checkout = { deviceSessionId }
          })
          .catch(() => undefined)
      )
    }

    if (isEnabled(risk.worldPay?.enabled)) {
      tasks.push(
        collectWorldPay(risk.worldPay)
          .then((sessionId) => {
            if (sessionId) payload.worldPay = { sessionId }
          })
          .catch(() => undefined)
      )
    }

    await Promise.all(tasks)
    return payload
  })()
  riskSnapshots.set(promise, payload)
  return promise
}

/** 支付路径：优先复用预采集 Promise，否则当场开始采集。 */
export function resolveRiskCollection(config: RuntimeWalletConfig): Promise<PayRiskPayload> {
  if (config.riskCollection) return config.riskCollection
  return collectRisk(config.risk, config.environment)
}

/**
 * 钱包授权后调用：风控超时/失败返回已采到的字段或 {}，绝不抛错。
 * 后台采集仍继续。
 */
export function awaitRiskForPay(promise: Promise<PayRiskPayload>): Promise<PayRiskPayload> {
  return withTimeout(
    promise
      .then((value) => (value && typeof value === 'object' ? value : snapshotOf(promise)))
      .catch(() => snapshotOf(promise)),
    PAY_WAIT_MS,
    () => snapshotOf(promise)
  )
}
