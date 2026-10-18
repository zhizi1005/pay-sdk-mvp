import type { RuntimeWalletConfig } from './types.js'
import { loadApplePay } from './loader.js'

async function readyApplePay(): Promise<true> {
  await loadApplePay()

  if (typeof ApplePaySession === 'undefined') {
    throw new Error('Apple Pay is not supported in this browser')
  }
  if (!ApplePaySession.canMakePayments()) {
    throw new Error('Apple Pay cannot make payments on this device')
  }
  return true
}

export function ready(config: RuntimeWalletConfig): Promise<true> {
  if (config.method === 'applePay') return readyApplePay()
  return Promise.reject(new Error(`Unknown payment method: ${config.method}`))
}
