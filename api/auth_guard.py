import os
import requests
from datetime import datetime, timezone
from urllib.parse import urlsplit
from plan_limits_generated import PLAN_LIMITS, PLAN_CAPABILITIES


PLAN_RATE_LIMITS = {
    "free": {"ai_claude_request": 0, "web_scrape": 0, "pdf_extract": 0, "excel_export": 2, "product_enrich": 0},
    "trial": {"ai_claude_request": 10, "web_scrape": 2, "pdf_extract": 2, "excel_export": 5},
    "starter": {"ai_claude_request": 20, "web_scrape": 3, "pdf_extract": 3, "excel_export": 10},
    "pro": {"ai_claude_request": 60, "web_scrape": 8, "pdf_extract": 8, "excel_export": 30},
    "business": {"ai_claude_request": 120, "web_scrape": 15, "pdf_extract": 15, "excel_export": 60},
    "expired": {"ai_claude_request": 0, "web_scrape": 0, "pdf_extract": 0, "excel_export": 0},
}


def _allowed_origins():
    raw = os.getenv("SMARTQUOTE_ALLOWED_ORIGIN") or os.getenv("SMARTQUOTE_ALLOWED_ORIGINS") or "*"
    return [x.strip() for x in raw.split(",") if x.strip()] or ["*"]


def _normalized_origin(value):
    value = str(value or "").strip()
    if not value:
        return ""
    try:
        parsed = urlsplit(value if "://" in value else f"https://{value}")
        scheme = (parsed.scheme or "https").lower()
        host = (parsed.hostname or "").lower()
        if not host:
            return ""
        port = parsed.port
        default_port = (scheme == "https" and port == 443) or (scheme == "http" and port == 80)
        port_part = "" if port is None or default_port else f":{port}"
        return f"{scheme}://{host}{port_part}"
    except Exception:
        return value.rstrip("/").lower()


def _same_origin_request(headers):
    """Allow SmartQuote's own frontend to call its co-located /api routes.

    Vercel preview deployments and custom-domain aliases may not be present in the
    static CORS allowlist.  Same-origin browser requests are not a CORS trust
    expansion: the Origin must match the actual Host received by this function.
    Cross-origin requests still require SMARTQUOTE_ALLOWED_ORIGIN(S).
    """
    origin = _normalized_origin(headers.get("Origin") or headers.get("origin") or "")
    if not origin:
        return True
    host = str(headers.get("X-Forwarded-Host") or headers.get("x-forwarded-host") or headers.get("Host") or headers.get("host") or "").split(",", 1)[0].strip()
    if not host:
        return False
    proto = str(headers.get("X-Forwarded-Proto") or headers.get("x-forwarded-proto") or "https").split(",", 1)[0].strip().lower() or "https"
    request_origin = _normalized_origin(f"{proto}://{host}")
    return bool(request_origin and origin == request_origin)


def cors_origin(headers):
    origin_raw = headers.get("Origin") or headers.get("origin") or ""
    origin = _normalized_origin(origin_raw)
    allowed = _allowed_origins()
    if _same_origin_request(headers):
        # Echo the exact browser origin for same-origin calls; this also works for
        # Vercel preview URLs and custom-domain aliases without weakening CORS.
        return origin_raw or ""
    if "*" in allowed:
        return "*"
    allowed_normalized = {_normalized_origin(x) for x in allowed}
    if not origin:
        return allowed[0] if allowed else ""
    return origin_raw if origin in allowed_normalized else ""


def origin_allowed(headers):
    origin = _normalized_origin(headers.get("Origin") or headers.get("origin") or "")
    if not origin or _same_origin_request(headers):
        return True
    allowed = _allowed_origins()
    if "*" in allowed:
        return True
    return origin in {_normalized_origin(x) for x in allowed}


def security_headers(handler):
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("X-Frame-Options", "DENY")
    handler.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
    handler.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")


def _client_ip(handler):
    raw = handler.headers.get("X-Forwarded-For") or handler.headers.get("X-Real-IP") or "unknown"
    return str(raw).split(",")[0].strip() or "unknown"


def _minute_start_iso():
    now = datetime.now(timezone.utc)
    return datetime(now.year, now.month, now.day, now.hour, now.minute, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")




def _api_auth_disabled():
    return str(os.getenv("SMARTQUOTE_API_AUTH_DISABLED", "")).lower() == "true"


def _server_env():
    supabase_url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if not supabase_url or not service_key:
        raise RuntimeError("Server auth chưa được cấu hình. Cần SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY trong Vercel env.")
    return supabase_url.rstrip("/"), service_key


def _headers(service_key):
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }


def _bearer(headers):
    raw = headers.get("Authorization") or headers.get("authorization") or ""
    if raw.lower().startswith("bearer "):
        return raw[7:].strip()
    return ""


def _parse_iso(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None

def _billing_lock(dealer):
    dealer = dealer or {}
    plan = str(dealer.get("plan") or "trial").lower()
    status = str(dealer.get("subscription_status") or ("trialing" if plan == "trial" else "active")).lower()
    now = datetime.now(timezone.utc)
    trial_ends = _parse_iso(dealer.get("trial_ends_at"))
    period_end = _parse_iso(dealer.get("current_period_end"))
    trial_expired = plan == "trial" and trial_ends is not None and trial_ends <= now
    paid_expired = plan != "trial" and period_end is not None and period_end <= now
    status_locked = status in ("expired", "canceled", "past_due", "unpaid")
    if plan == "expired" or trial_expired or paid_expired or status_locked:
        reason = "Trial đã hết hạn. Vui lòng nâng cấp gói để tiếp tục dùng API." if trial_expired else ("Gói hiện tại đã hết hạn. Vui lòng gia hạn để tiếp tục dùng API." if paid_expired else f"Workspace đang ở trạng thái {status}. Vui lòng nâng cấp/gia hạn gói.")
        return {"locked": True, "effectivePlan": "expired", "reason": reason}
    return {"locked": False, "effectivePlan": plan, "reason": ""}


def require_api_access(handler):
    requested_dealer_id = handler.headers.get("X-SmartQuote-Dealer-Id") or handler.headers.get("x-smartquote-dealer-id") or ""
    if _api_auth_disabled():
        return {
            "devMode": True,
            "user": {"id": "local-dev-user", "email": "local-dev@smartquote.local"},
            "dealerId": requested_dealer_id or "local-dev-dealer",
            "dealer": {"id": requested_dealer_id or "local-dev-dealer", "name": "Local Dev", "plan": "business"},
            "plan": "business",
        }, None

    token = _bearer(handler.headers)
    if not token:
        return None, (401, {"error": "Bạn cần đăng nhập để gọi API này."})

    try:
        supabase_url, service_key = _server_env()
    except RuntimeError as exc:
        return None, (500, {"error": str(exc)})

    user_resp = requests.get(
        f"{supabase_url}/auth/v1/user",
        headers={"apikey": service_key, "Authorization": f"Bearer {token}"},
        timeout=8,
    )
    if user_resp.status_code != 200:
        return None, (401, {"error": "Phiên đăng nhập không hợp lệ hoặc đã hết hạn."})
    user = user_resp.json()
    user_id = user.get("id")
    if not user_id:
        return None, (401, {"error": "Phiên đăng nhập không hợp lệ hoặc đã hết hạn."})

    params = {
        "select": "dealer_id,role,dealers(id,name,plan,trial_ends_at,subscription_status,current_period_end)",
        "user_id": f"eq.{user_id}",
        "limit": "1",
        "order": "created_at.asc",
    }
    if requested_dealer_id:
        params["dealer_id"] = f"eq.{requested_dealer_id}"

    member_resp = requests.get(
        f"{supabase_url}/rest/v1/dealer_members",
        headers=_headers(service_key),
        params=params,
        timeout=8,
    )
    if member_resp.status_code >= 400:
        return None, (500, {"error": "Không kiểm tra được workspace đại lý."})
    rows = member_resp.json() or []
    if not rows:
        return None, (403, {"error": "Tài khoản này không thuộc workspace đại lý được yêu cầu."})
    membership = rows[0]
    dealer = membership.get("dealers") or {}
    if isinstance(dealer, list):
        dealer = dealer[0] if dealer else {}
    lock = _billing_lock(dealer)
    if lock.get("locked"):
        return None, (402, {
            "error": lock.get("reason"),
            "billing": {
                "plan": (dealer or {}).get("plan") or "trial",
                "effectivePlan": lock.get("effectivePlan"),
                "subscription_status": (dealer or {}).get("subscription_status") or "trialing",
                "trial_ends_at": (dealer or {}).get("trial_ends_at"),
                "current_period_end": (dealer or {}).get("current_period_end"),
            },
        })
    return {
        "devMode": False,
        "user": user,
        "dealerId": membership.get("dealer_id"),
        "role": membership.get("role"),
        "dealer": dealer,
        "plan": lock.get("effectivePlan") or (dealer or {}).get("plan") or "trial",
        "supabaseUrl": supabase_url,
        "serviceKey": service_key,
    }, None


def _month_start_iso():
    now = datetime.now(timezone.utc)
    return datetime(now.year, now.month, 1, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")




def _capability_enabled(plan, capability):
    plan = str(plan or "trial").lower()
    if plan not in PLAN_CAPABILITIES:
        plan = "trial"
    return bool((PLAN_CAPABILITIES.get(plan) or {}).get(capability))

def assert_capability(auth, capability):
    if not capability or auth.get("devMode"):
        return None
    plan = str(auth.get("plan") or "trial").lower()
    payload = {"plan_input": plan, "capability_input": capability}
    resp = requests.post(f"{auth['supabaseUrl']}/rest/v1/rpc/plan_has_capability", headers=_headers(auth["serviceKey"]), json=payload, timeout=8)
    if resp.status_code < 400:
        data = resp.json() if resp.content else False
        if isinstance(data, list): data = data[0] if data else False
        if data is True: return None
        return (403, {"error": f"Tính năng này chưa mở cho gói {plan}. Vui lòng nâng cấp gói.", "capability": {"plan": plan, "capability": capability}})
    msg = resp.text or ""
    if "plan_has_capability" in msg or "function" in msg.lower():
        return (500, {"error": "Capability RPC chưa được cấu hình. Hãy chạy supabase/phase10_plan_capabilities.sql trên Supabase."})
    if _capability_enabled(plan, capability): return None
    return (403, {"error": f"Tính năng này chưa mở cho gói {plan}. Vui lòng nâng cấp gói.", "capability": {"plan": plan, "capability": capability}})

def _limit_for(plan, event_type):
    plan = str(plan or "trial").lower()
    if plan not in PLAN_LIMITS:
        plan = "trial"
    return PLAN_LIMITS[plan].get(event_type, 0), plan


def assert_within_quota(auth, event_type, units=1):
    if auth.get("devMode"):
        return None
    units = max(1, int(units or 1))
    limit, plan = _limit_for(auth.get("plan"), event_type)

    payload = {
        "target_dealer_id": auth["dealerId"],
        "target_user_id": auth["user"].get("id"),
        "target_event_type": event_type,
        "requested_units": units,
        "event_meta": {},
    }
    resp = requests.post(
        f"{auth['supabaseUrl']}/rest/v1/rpc/consume_usage_quota",
        headers=_headers(auth["serviceKey"]),
        json=payload,
        timeout=8,
    )
    if resp.status_code < 400:
        data = resp.json() if resp.content else {}
        if isinstance(data, list):
            data = data[0] if data else {}
        auth.setdefault("_consumedUsage", {})[event_type] = data or {}
        return None

    try:
        payload = resp.json() or {}
        msg = payload.get("message") or payload.get("error") or resp.text or ""
    except Exception:
        msg = resp.text or ""
    if "consume_usage_quota" in msg or "Could not find the function" in msg or ("function" in msg and "does not exist" in msg):
        return (500, {"error": "Quota RPC chưa được cấu hình. Hãy chạy supabase/phase7_1_must_fix.sql trên Supabase."})
    status = 403 if "quota" in msg.lower() or "vượt" in msg.lower() else 500
    return (status, {"error": msg or f"Không kiểm tra được quota {event_type}.", "quota": {"plan": plan, "eventType": event_type, "limit": limit, "requested": units}})


def record_usage(auth, event_type, units=1, meta=None):
    if auth.get("devMode"):
        return
    consumed = (auth.get("_consumedUsage") or {}).get(event_type) or {}
    event_id = consumed.get("event_id")
    if event_id:
        requests.patch(
            f"{auth['supabaseUrl']}/rest/v1/usage_events",
            headers={**_headers(auth["serviceKey"]), "Prefer": "return=minimal"},
            params={"id": f"eq.{event_id}"},
            json={"meta": meta or {}},
            timeout=8,
        ).raise_for_status()
        auth.get("_consumedUsage", {}).pop(event_type, None)
        return
    payload = {
        "dealer_id": auth["dealerId"],
        "user_id": auth["user"].get("id"),
        "event_type": event_type,
        "units": max(1, int(units or 1)),
        "meta": meta or {},
    }
    requests.post(
        f"{auth['supabaseUrl']}/rest/v1/usage_events",
        headers={**_headers(auth["serviceKey"]), "Prefer": "return=minimal"},
        json=payload,
        timeout=8,
    ).raise_for_status()


def _rate_limit_for(plan, event_type):
    plan = str(plan or "trial").lower()
    if plan not in PLAN_RATE_LIMITS:
        plan = "trial"
    return PLAN_RATE_LIMITS[plan].get(event_type, 10), plan


def assert_rate_limit(auth, handler, event_type, units=1):
    if auth.get("devMode") or str(os.getenv("SMARTQUOTE_RATE_LIMIT_DISABLED", "")).lower() == "true":
        return None
    limit, plan = _rate_limit_for(auth.get("plan"), event_type)
    key = f"{auth.get('dealerId')}:{event_type}:{_client_ip(handler)}"
    payload = {
        "p_key": key,
        "p_window_start": _minute_start_iso(),
        "p_limit": limit,
        "p_increment": max(1, int(units or 1)),
    }
    resp = requests.post(
        f"{auth['supabaseUrl']}/rest/v1/rpc/smartquote_increment_rate_limit",
        headers=_headers(auth["serviceKey"]),
        json=payload,
        timeout=8,
    )
    if resp.status_code >= 400:
        return (500, {"error": "Rate limit chưa được cấu hình. Hãy chạy supabase/phase7_hardening.sql."})
    data = resp.json() if resp.content else {}
    if isinstance(data, list):
        data = data[0] if data else {}
    if not data.get("allowed", True):
        return (429, {
            "error": "Bạn thao tác quá nhanh. Vui lòng thử lại sau khoảng 1 phút.",
            "rateLimit": {"plan": plan, "eventType": event_type, "limit": limit, "count": data.get("count"), "resetAt": data.get("reset_at")},
        })
    return None
