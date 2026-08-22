import importlib.util
import os
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'api'))
spec = importlib.util.spec_from_file_location('auth_guard', ROOT / 'api' / 'auth_guard.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

same = {
    'Origin': 'https://smartquote-git-main-example.vercel.app',
    'Host': 'smartquote-git-main-example.vercel.app',
    'X-Forwarded-Proto': 'https',
}
with patch.dict(os.environ, {'SMARTQUOTE_ALLOWED_ORIGIN': 'https://app.smartquote.vn'}, clear=False):
    assert mod.origin_allowed(same) is True, 'same-origin Vercel deployment must not be blocked by stale CORS allowlist'
    assert mod.cors_origin(same) == same['Origin'], 'same-origin response must echo browser origin'

    custom = {
        'Origin': 'https://app.smartquote.vn',
        'Host': 'app.smartquote.vn',
        'X-Forwarded-Proto': 'https',
    }
    assert mod.origin_allowed(custom) is True

    allowed_cross = {
        'Origin': 'https://app.smartquote.vn',
        'Host': 'api.smartquote.vn',
        'X-Forwarded-Proto': 'https',
    }
    assert mod.origin_allowed(allowed_cross) is True, 'explicit cross-origin allowlist must continue to work'

    blocked_cross = {
        'Origin': 'https://evil.example',
        'Host': 'app.smartquote.vn',
        'X-Forwarded-Proto': 'https',
    }
    assert mod.origin_allowed(blocked_cross) is False, 'untrusted cross-origin request must stay blocked'
    assert mod.cors_origin(blocked_cross) == '', 'blocked cross-origin request must not receive ACAO'

print('Phase 12.4.3 same-origin SmartQuote API smoke: PASS')
