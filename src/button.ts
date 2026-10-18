import type { RuntimeWalletConfig } from './types.js'

const APPLE_BUTTON_STYLE_ID = 'pay-sdk-apple-button-style'

export function resolveContainer(container: string | HTMLElement): HTMLElement {
  const el =
    typeof container === 'string' ? document.querySelector<HTMLElement>(container) : container
  if (!el) throw new Error(`Pay SDK container not found: ${String(container)}`)
  return el
}

function injectAppleButtonStyle(): void {
  if (document.getElementById(APPLE_BUTTON_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = APPLE_BUTTON_STYLE_ID
  style.textContent = `
apple-pay-button {
  --apple-pay-button-width: 100%;
  --apple-pay-button-height: 40px;
  --apple-pay-button-border-radius: 4px;
  --apple-pay-button-padding: 0px 0px;
  --apple-pay-button-box-sizing: border-box;
}`
  document.head.appendChild(style)
}

function renderAppleButton(
  el: HTMLElement,
  config: RuntimeWalletConfig,
  onClick: () => void
): HTMLElement {
  injectAppleButtonStyle()
  const btn = config.applePay?.button || {}

  const button = document.createElement('apple-pay-button')
  button.setAttribute('buttonstyle', btn.buttonstyle || 'black')
  button.setAttribute('type', btn.type || 'plain')
  button.setAttribute('locale', btn.locale || 'en-US')
  button.addEventListener('click', onClick)

  el.appendChild(button)
  return button
}

// Renders the official Apple Pay button into the container and returns the node.
export function renderButton(config: RuntimeWalletConfig, onClick: () => void): HTMLElement {
  if (!config.container) {
    throw new Error('config.container is required to render the official wallet button')
  }
  const el = resolveContainer(config.container)
  el.replaceChildren()

  if (config.method === 'applePay') return renderAppleButton(el, config, onClick)
  throw new Error(`Unknown payment method: ${config.method}`)
}
