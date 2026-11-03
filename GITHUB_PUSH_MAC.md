# HƯỚNG DẪN PUSH SMARTQUOTE RC16.1 LÊN GITHUB (MAC)

## A. Tạo repository **mới, private** (đơn giản nhất)

1. Trên GitHub chọn **New repository** → tên `smartquote` hoặc `smartquote-pilot` → **Private** → **không** tích Initialize with README / .gitignore / license.
2. Giải nén `SmartQuote-RC16.1-Pilot-GitHubReady.zip`.
3. Mở **Terminal** trên Mac và gõ `cd ` (có dấu cách cuối), kéo folder `SmartQuote-RC16.1-Pilot-GitHubReady` từ Finder vào Terminal, rồi Enter. Kiểm tra `pwd` và `ls`.
4. Chạy lệnh sau, thay `USERNAME` bằng tài khoản GitHub (hoặc org bạn được cấp quyền):

```bash
git init
git branch -M main
git add -A
git status --short
git commit -m "SmartQuote RC16.1 pilot candidate"
git remote add origin https://github.com/USERNAME/smartquote.git
git push -u origin main
```

Nếu Git hỏi tên/email, thiết lập `git config --global user.name "Tên GitHub của bạn"` và `git config --global user.email "email-của-bạn"` rồi commit lại. GitHub dùng token/credential manager khi xác thực HTTPS; **không** dán token vào file source hoặc URL remote.

### Trước khi commit

```bash
git status --short
git check-ignore .env.local .vercel/project.json node_modules/test || true
```

Tuyệt đối không `git add -f .env.local` và không commit key thật. Repo mặc định private; sau đó có thể mời collaborator theo quyền hạn cần thiết.

## B. Nếu đã có repo GitHub và Vercel đang trỏ tới repo đó

**Không** xóa lịch sử Git hiện có; **không dùng** `git push --force`.

1. Clone repo hiện tại và tạo nhánh:

```bash
git clone https://github.com/USERNAME/smartquote.git smartquote-work
cd smartquote-work
git checkout -b pilot/rc16.1
```

2. Sao chép **nội dung** folder `SmartQuote-RC16.1-Pilot-GitHubReady/` vào thư mục `smartquote-work/`, ghi đè file source tương ứng nhưng **không đụng** thư mục `.git/`. Có thể làm trên Finder. Chỉ xóa các file cũ khi đã kiểm tra chúng không cần nữa.

3. Kiểm tra diff rồi commit:

```bash
git status
git diff --stat
git add -A
git commit -m "Prepare RC16.1 pilot release"
git push -u origin pilot/rc16.1
```

4. Trên Vercel mở Preview deployment cho nhánh `pilot/rc16.1`, test UAT rồi mới merge vào `main`/production khi được GO.

## C. Chạy app local

Cài **Node.js 22+**, sau đó trong thư mục project:

```bash
cp .env.example .env.local
# Điền các key đúng vào .env.local, file này đã được gitignore
npm ci
npm run dev
```

`npm run dev` chỉ chạy frontend local. Các API trong `api/` là Vercel Functions; muốn test API tương đương Vercel cần chạy đúng runtime Vercel (VD: `vercel dev` sau khi đăng nhập và liên kết project), với biến môi trường riêng. Không cho dữ liệu khách thật vào test khi bảo mật chưa được xác minh.

## D. Kết nối Vercel (sau khi qua gate)

- Trong Vercel: Add New → Project → Import Git Repository (chính repo private này).
- Framework: **Vite**. Root Directory: root project. Build Command: `npm run build`. Output Directory: `dist`. Install Command (đã ở `vercel.json`): `npm ci --include=dev`.
- Thêm Env ở Vercel Project Settings, lấy danh sách trong `.env.example` và checklist. Các biến tối thiểu:
  - Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
  - Server: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`; thêm `ANTHROPIC_API_KEY` và Serper key khi dùng các chức năng tương ứng.
  - Domain/cors: `SMARTQUOTE_ALLOWED_ORIGIN=https://app.smartquote.vn` cho Production; chỉnh đúng URL Preview theo chính sách CORS nếu cần.
- `app.smartquote.vn` là miền Web App trên Vercel; landing page `smartquote.vn` ở Netlify giữ nguyên, không đổi DNS root nếu không muốn chuyển landing page.
- Vercel có thể **tự động deploy production** từ `main`; không kết nối/merge production trước khi đã chạy gate.
- Không đưa service role key vào GitHub repository và không tiền tố `VITE_` cho secret server.

## E. Các lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `npm ci` lỗi mạng tới `cdn.sheetjs.com` | Thử lại trên mạng ổn định, kiểm tra DNS/proxy; không tự ý sửa lockfile. |
| `git push` báo Authentication failed | Dùng Git Credential Manager, GitHub CLI hoặc personal access token qua cơ chế xác thực GitHub. |
| `git remote add origin` báo remote already exists | Xem `git remote -v`, cân nhắc `git remote set-url origin <URL_đúng>` nếu chắc chắn. |
| Vercel build fails | Đọc log cài deps và `npm run build`; xác nhận Node >=22. |
| Mở app không thấy đăng nhập | Kiểm tra `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` đã set cho đúng môi trường và redeploy. |
| API báo unauthorized / 403 | Kiểm tra auth, workspace, RLS, biến server và release gate; không tắt security flags để vượt lỗi. |

**Git push thành công không có nghĩa đã GO pilot.** Xem `PILOT_DEPLOY_CHECKLIST.md`.
