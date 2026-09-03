# SmartQuote — Vercel registry fix

## Vấn đề

Vercel deploy thất bại ở bước `npm install` vì `package-lock.json` có một số tarball URL trỏ về registry nội bộ của sandbox/OpenAI:

```txt
packages.applied-caas-gateway1.internal.api.openai.org/artifactory/api/npm/npm-public
```

URL này chỉ truy cập được trong môi trường build nội bộ, nên Vercel báo `EHOSTUNREACH`.

## Đã sửa

- Thay toàn bộ `resolved` URL nội bộ trong `package-lock.json` về public npm registry:

```txt
https://registry.npmjs.org/
```

- Giữ `.npmrc`:

```txt
registry=https://registry.npmjs.org/
```

- Thêm smoke test:

```bash
npm run smoke:vercel-registry
```

Smoke test sẽ fail nếu `package-lock.json`, `package.json`, hoặc `.npmrc` còn chứa `applied-caas`, `artifactory`, hoặc `internal.api.openai.org`.

## Lệnh deploy local

```bash
npm ci
npm run build
npm run smoke:vercel-registry
```
