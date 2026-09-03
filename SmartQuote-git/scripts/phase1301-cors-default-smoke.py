import os
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "api"))

from api.auth_guard import _allowed_origins, origin_allowed, cors_origin

with patch.dict(os.environ, {}, clear=False):
    os.environ.pop("SMARTQUOTE_ALLOWED_ORIGIN", None)
    os.environ.pop("SMARTQUOTE_ALLOWED_ORIGINS", None)
    assert _allowed_origins() == []
    same = {"Origin": "https://app.smartquote.vn", "Host": "app.smartquote.vn", "X-Forwarded-Proto": "https"}
    cross = {"Origin": "https://evil.example", "Host": "app.smartquote.vn", "X-Forwarded-Proto": "https"}
    assert origin_allowed(same) is True
    assert cors_origin(same) == "https://app.smartquote.vn"
    assert origin_allowed(cross) is False
    assert cors_origin(cross) == ""

with patch.dict(os.environ, {"SMARTQUOTE_ALLOWED_ORIGIN": "*"}, clear=False):
    assert origin_allowed({"Origin": "https://explicit-dev.example", "Host": "app.smartquote.vn"}) is True

print("Phase 13.0.1 Python CORS default-closed smoke: PASS")
