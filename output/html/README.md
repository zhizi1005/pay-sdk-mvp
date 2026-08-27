# 3DS 参考壳页

本目录提供 App 二级 WebView 使用的 **Challenge / Method** 参考页。商户可改名、改样式后自托管；URL 由收银台 H5 传给 Native Bridge（见 [WEBVIEW.md](../WEBVIEW.md)）。

## 文件

| 文件                                         | 全局函数                                                        | Native 注入时机          |
| -------------------------------------------- | --------------------------------------------------------------- | ------------------------ |
| [`3ds-challenge.html`](./3ds-challenge.html) | `window.__paySdkRenderChallenge({ MD, JWT, action })`           | 壳页 `onPageFinished` 后 |
| [`3ds-method.html`](./3ds-method.html)       | `window.__paySdkRenderMethod({ threeDSMethodData, methodUrl })` | 同上                     |

## 约定

1. Bridge：`openPayChallenge(shellUrl, jsonPayload)` / `openPayMethod(shellUrl, jsonPayload)`。
2. Native 先 `loadUrl(shellUrl)`，再注入并调用上述全局函数（建议 payload Base64 后再 `evaluateJavascript`）。
3. Challenge：向 `action` POST `MD` / `JWT`，目标为页内 iframe。
4. Method：隐藏 iframe，向 `methodUrl` POST `threeDSMethodData`；原收银台继续 poll，之后可能再出 `s3ds` / `webUrl`。

## 托管示例

```text
https://merchant.example/pay/3ds-challenge.html
https://merchant.example/pay/3ds-method.html
```

H5：

```js
var bridge = sdk.getBridge()
bridge.openPayChallenge(challengeShell, JSON.stringify({ MD, JWT, action }))
bridge.openPayMethod(methodShell, JSON.stringify({ threeDSMethodData, methodUrl }))
```
