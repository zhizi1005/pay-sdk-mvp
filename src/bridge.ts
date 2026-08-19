import type { PayNativeBridge } from './types.js'

/** Default App WebView JS Bridge mount name (`window.NativeBridge`). */
export const DEFAULT_BRIDGE_NAME = 'NativeBridge'

const BRIDGE_NAME_RE = /^[A-Za-z_$][\w$]*$/

/**
 * Empty / omitted → `NativeBridge`. Otherwise must be a JS identifier
 * matching Android `addJavascriptInterface` / iOS `window.*` names.
 */
export function normalizeBridgeName(bridgeName?: string | null): string {
  if (bridgeName == null) return DEFAULT_BRIDGE_NAME
  const trimmed = String(bridgeName).trim()
  if (!trimmed) return DEFAULT_BRIDGE_NAME
  if (!BRIDGE_NAME_RE.test(trimmed)) {
    throw new Error(
      'config.bridgeName must be a JavaScript identifier (e.g. NativeBridge, MerchantPayBridge)'
    )
  }
  return trimmed
}

/** Read `window[bridgeName]`. Omitted name uses `NativeBridge`. */
export function getNativeBridge(bridgeName?: string | null): PayNativeBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const name = normalizeBridgeName(bridgeName)
  const value = (window as unknown as Record<string, unknown>)[name]
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  return value as PayNativeBridge
}
