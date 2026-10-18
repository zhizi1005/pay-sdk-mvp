# 打包留存

本目录保存每次 `npm run build` 产出的 `pay.min.js`，文件名即当时的 `package.json` `version`（与 `RampPay.version` 相同）。

- 上传 CDN 仍使用 `dist/pay.min.js`
- 同一版本再次打包会覆盖 `pay.<version>.min.js`
