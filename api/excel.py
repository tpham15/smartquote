"""
Vercel Python Serverless Function — xuất Excel báo giá có ảnh
POST /api/excel  body: JSON data từ SmartQuote
Phase 7: auth + quota + rate-limit + stricter CORS/security headers.
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from auth_guard import (
    require_api_access, assert_within_quota, assert_rate_limit, record_usage,
    cors_origin, origin_allowed, security_headers,
)


class handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = cors_origin(self.headers)
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-SmartQuote-Dealer-Id, X-SmartQuote-Event, X-SmartQuote-Units, X-Request-Id")
        self.send_header("Access-Control-Max-Age", "86400")
        security_headers(self)

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def _json(self, status, payload):
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def do_POST(self):
        started = time.time()
        if not origin_allowed(self.headers):
            self._json(403, {"error": "Origin không được phép gọi SmartQuote API."})
            return

        auth, auth_error = require_api_access(self)
        if auth_error:
            status, payload = auth_error
            self._json(status, payload)
            return

        rate_error = assert_rate_limit(auth, self, "excel_export", 1)
        if rate_error:
            status, payload = rate_error
            self._json(status, payload)
            return

        quota_error = assert_within_quota(auth, "excel_export", 1)
        if quota_error:
            status, payload = quota_error
            self._json(status, payload)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            max_body = int(os.getenv("SMARTQUOTE_MAX_EXCEL_BODY_BYTES", "2500000"))
            if length > max_body:
                self._json(413, {"error": "Dữ liệu xuất Excel quá lớn. Hãy tách báo giá thành nhiều phần nhỏ hơn."})
                return
            body = self.rfile.read(length)
            data = json.loads(body)

            from excel_builder import build_excel
            xlsx_bytes = build_excel(data)

            customer = data.get("customer", {})
            name = (customer.get("name") or "BaoGia").replace(" ", "_")[:80]
            filename = f"BaoGia_{name}.xlsx"

            self.send_response(200)
            self._cors()
            self.send_header("Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            self.send_header("Content-Disposition",
                f'attachment; filename="{filename}"')
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(xlsx_bytes)
            record_usage(auth, "excel_export", 1, {"customer": customer.get("name") or "", "filename": filename, "durationMs": int((time.time() - started) * 1000)})
        except Exception as e:
            self._json(500, {"error": str(e)})
