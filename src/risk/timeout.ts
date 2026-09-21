type TimeoutFallback<T> = T | (() => T)

function readFallback<T>(fallback: TimeoutFallback<T>): T {
  return typeof fallback === 'function' ? (fallback as () => T)() : fallback
}

/** 超时或拒绝时返回 fallback，Promise 始终 resolve。 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: TimeoutFallback<T>
): Promise<T> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(readFallback(fallback)), ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      () => {
        window.clearTimeout(timer)
        resolve(readFallback(fallback))
      }
    )
  })
}
