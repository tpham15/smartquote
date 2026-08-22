import React, { useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "./client.js";
import {
  ensureDealerWorkspace,
  loadDealerBilling,
  requestPasswordReset,
  signInDealer,
  signOutDealer,
  signUpDealer,
  updateCurrentUserPassword,
} from "./cloudState.js";

function passwordResetRedirectUrl() {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}${window.location.pathname}`;
}

export default function SupabaseAuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [dealerId, setDealerId] = useState(null);
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [dealerName, setDealerName] = useState("");
  const [fullName, setFullName] = useState("");
  const [status, setStatus] = useState("Đang kiểm tra đăng nhập...");
  const [billing, setBilling] = useState(null);
  const [billingStatus, setBillingStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session || null);
      setStatus("");
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession || null);
      if (event === "PASSWORD_RECOVERY") {
        setMode("update_password");
        setPassword("");
        setConfirmPassword("");
        setNotice("Đặt mật khẩu mới cho tài khoản SmartQuote của bạn.");
      }
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (mode === "update_password") return;

    if (!session?.user) {
      setDealerId(null);
      setBilling(null);
      setBillingStatus("");
      return;
    }

    let cancelled = false;
    setStatus("Đang mở workspace đại lý...");

    ensureDealerWorkspace(session.user.user_metadata?.dealer_name || dealerName || "Đại lý SmartQuote")
      .then(async (id) => {
        if (cancelled) return;
        setDealerId(id);
        setStatus("");
        setBillingStatus("Đang tải gói sử dụng...");
        try {
          const nextBilling = await loadDealerBilling(id);
          if (!cancelled) setBilling(nextBilling);
        } finally {
          if (!cancelled) setBillingStatus("");
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(error);
        setStatus("Không mở được workspace. Kiểm tra SQL Supabase/RLS rồi thử lại.");
      });

    return () => { cancelled = true; };
  }, [session?.user?.id, mode]);

  const refreshBilling = async () => {
    if (!dealerId) return null;
    setBillingStatus("Đang cập nhật quota...");
    try {
      const nextBilling = await loadDealerBilling(dealerId);
      setBilling(nextBilling);
      return nextBilling;
    } finally {
      setBillingStatus("");
    }
  };

  const cloudProps = useMemo(() => ({
    enabled: Boolean(isSupabaseConfigured && session && dealerId),
    session,
    dealerId,
    status: billingStatus || status,
    billing,
    refreshBilling,
    onLogout: async () => {
      await signOutDealer();
      setSession(null);
      setDealerId(null);
      setBilling(null);
      setMode("login");
    },
  }), [session, dealerId, status, billingStatus, billing]);

  if (!isSupabaseConfigured) return children({ enabled: false });

  if (session && dealerId && mode !== "update_password") return children(cloudProps);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      if (mode === "register") {
        const { data, error } = await signUpDealer({ email, password, dealerName, fullName });
        if (error) throw error;
        if (!data.session) {
          setNotice("Đã tạo tài khoản. Nếu Supabase đang bật xác nhận email, hãy mở email xác nhận rồi đăng nhập lại.");
          setMode("login");
        } else {
          setSession(data.session);
        }
      } else if (mode === "forgot") {
        const cleanedEmail = String(email || "").trim();
        if (!cleanedEmail) throw new Error("Nhập email đã đăng ký để nhận link đặt lại mật khẩu.");
        const { error } = await requestPasswordReset(cleanedEmail, passwordResetRedirectUrl());
        if (error) throw error;
        setNotice("Nếu email này đã đăng ký SmartQuote, hệ thống đã gửi link đặt lại mật khẩu. Hãy kiểm tra Inbox/Spam.");
        setMode("login");
        setPassword("");
        setConfirmPassword("");
      } else if (mode === "update_password") {
        if (password.length < 6) throw new Error("Mật khẩu mới cần tối thiểu 6 ký tự.");
        if (password !== confirmPassword) throw new Error("Hai ô mật khẩu chưa trùng nhau.");
        const { error } = await updateCurrentUserPassword(password);
        if (error) throw error;
        setNotice("Đã đổi mật khẩu. Bạn có thể tiếp tục dùng SmartQuote.");
        setPassword("");
        setConfirmPassword("");
        setMode("login");
      } else {
        const { data, error } = await signInDealer({ email, password });
        if (error) throw error;
        setSession(data.session);
      }
    } catch (error) {
      console.error(error);
      setNotice(error.message || "Không xử lý được yêu cầu.");
    } finally {
      setBusy(false);
    }
  };

  const isForgot = mode === "forgot";
  const isRecovery = mode === "update_password";
  const title = isRecovery ? "Đặt mật khẩu mới" : isForgot ? "Quên mật khẩu" : "SmartQuote Cloud";
  const description = isRecovery
    ? "Nhập mật khẩu mới sau khi mở link khôi phục từ email."
    : isForgot
      ? "Nhập email đã đăng ký. SmartQuote sẽ gửi link đặt lại mật khẩu nếu tài khoản tồn tại."
      : "Mỗi đại lý đăng nhập vào workspace riêng. Catalog, gói phòng và cài đặt sẽ đồng bộ lên Supabase.";

  return (
    <div className="sq-auth-page">
      <style>{AUTH_CSS}</style>
      <form className="sq-auth-card" onSubmit={submit}>
        <div className="sq-auth-logo">📦</div>
        <h1>{title}</h1>
        <p>{description}</p>

        {mode === "register" && (
          <>
            <label>Tên đại lý / công ty</label>
            <input value={dealerName} onChange={(e) => setDealerName(e.target.value)} placeholder="VD: Lumi Dealer Hà Nội" required />
            <label>Người phụ trách</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="VD: Nguyễn Văn A" />
          </>
        )}

        {!isRecovery && (
          <>
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
          </>
        )}

        {!isForgot && (
          <>
            <label>{isRecovery ? "Mật khẩu mới" : "Mật khẩu"}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} placeholder="Tối thiểu 6 ký tự" required />
          </>
        )}

        {isRecovery && (
          <>
            <label>Nhập lại mật khẩu mới</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={6} placeholder="Nhập lại mật khẩu mới" required />
          </>
        )}

        {notice && <div className="sq-auth-notice">{notice}</div>}
        {status && <div className="sq-auth-status">{status}</div>}

        <button type="submit" disabled={busy}>
          {busy
            ? "Đang xử lý..."
            : mode === "register"
              ? "Tạo tài khoản đại lý"
              : isForgot
                ? "Gửi link đặt lại mật khẩu"
                : isRecovery
                  ? "Cập nhật mật khẩu"
                  : "Đăng nhập"}
        </button>

        {mode === "login" && (
          <button type="button" className="sq-auth-link" onClick={() => { setMode("forgot"); setNotice(""); setPassword(""); }}>
            Quên mật khẩu?
          </button>
        )}

        {!isRecovery && (
          <button type="button" className="sq-auth-link" onClick={() => {
            setNotice("");
            setPassword("");
            setConfirmPassword("");
            setMode(mode === "register" ? "login" : "register");
          }}>
            {mode === "register" ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Tạo đại lý mới"}
          </button>
        )}

        {(isForgot || isRecovery) && (
          <button type="button" className="sq-auth-link muted" onClick={async () => {
            setNotice("");
            setPassword("");
            setConfirmPassword("");
            if (isRecovery) {
              await signOutDealer();
              setSession(null);
              setDealerId(null);
            }
            setMode("login");
          }}>
            ← Quay lại đăng nhập
          </button>
        )}
      </form>
    </div>
  );
}

const AUTH_CSS = `
.sq-auth-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#eef7ff,#f5fff7);font-family:"Be Vietnam Pro",Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:24px;}
.sq-auth-card{width:100%;max-width:420px;background:white;border:1px solid #dbe7f3;border-radius:22px;box-shadow:0 22px 70px rgba(15,23,42,.12);padding:28px;display:flex;flex-direction:column;gap:10px;}
.sq-auth-logo{width:46px;height:46px;display:flex;align-items:center;justify-content:center;border-radius:14px;background:#ecfdf5;font-size:24px;}
.sq-auth-card h1{margin:4px 0 0;color:#0f172a;font-size:26px;}
.sq-auth-card p{margin:0 0 10px;color:#64748b;line-height:1.5;font-size:14px;}
.sq-auth-card label{font-size:13px;color:#334155;font-weight:700;margin-top:6px;}
.sq-auth-card input{border:1px solid #cbd5e1;border-radius:12px;padding:12px 13px;font-size:15px;outline:none;font-family:inherit;}
.sq-auth-card input:focus{border-color:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,.14);}
.sq-auth-card button[type="submit"]{margin-top:12px;border:0;border-radius:12px;background:#148457;color:white;font-weight:800;padding:13px;cursor:pointer;font-size:15px;font-family:inherit;}
.sq-auth-card button[disabled]{opacity:.65;cursor:not-allowed;}
.sq-auth-link{border:0;background:transparent;color:#12664a;font-weight:700;cursor:pointer;padding:8px 10px;font-family:inherit;}
.sq-auth-link.muted{color:#64748b;font-weight:650;}
.sq-auth-notice,.sq-auth-status{font-size:13px;border-radius:12px;padding:10px 12px;line-height:1.45;}
.sq-auth-notice{background:#fff7ed;color:#9a3412;border:1px solid #fed7aa;}
.sq-auth-status{background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;}
`;
