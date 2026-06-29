"""
Vercel Python Serverless Function — xuất Excel báo giá có ảnh
POST /api/excel  body: JSON data từ SmartQuote
"""
from http.server import BaseHTTPRequestHandler
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))


class handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            data = json.loads(body)

            from excel_builder import build_excel
            xlsx_bytes = build_excel(data)

            customer = data.get("customer", {})
            name = (customer.get("name") or "BaoGia").replace(" ", "_")
            filename = f"BaoGia_{name}.xlsx"

            self.send_response(200)
            self._cors()
            self.send_header("Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            self.send_header("Content-Disposition",
                f'attachment; filename="{filename}"')
            self.end_headers()
            self.wfile.write(xlsx_bytes)
        except Exception as e:
            self.send_response(500)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
