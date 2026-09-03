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
  const isRegister = mode === "register";
  const title = isRecovery
    ? "Đặt mật khẩu mới"
    : isForgot
      ? "Khôi phục mật khẩu"
      : isRegister
        ? "Tạo workspace SmartQuote"
        : "Đăng nhập SmartQuote";
  const description = isRecovery
    ? "Tạo mật khẩu mới để tiếp tục vào workspace của bạn."
    : isForgot
      ? "Nhập email đã đăng ký. Chúng tôi sẽ gửi link đặt lại mật khẩu nếu tài khoản tồn tại."
      : isRegister
        ? "Tạo workspace riêng để quản lý báo giá, sản phẩm và dữ liệu của doanh nghiệp."
        : "Quản lý báo giá, sản phẩm và workspace của bạn.";

  return (
    <div className="sq-auth-page">
      <style>{AUTH_CSS}</style>
      <form className="sq-auth-card" onSubmit={submit}>
        <div className="sq-auth-brand" aria-label="SmartQuote">
          <div className="sq-auth-brand-mark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M4 13l5 5L20 6" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="sq-auth-brand-name">Smart<span>Quote</span></div>
        </div>

        <div className="sq-auth-heading">
          <h1>{title}</h1>
          <p>{description}</p>
        </div>

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
              ? "Tạo workspace"
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
            {mode === "register" ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Tạo workspace"}
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
:root{
  --ink:#16181D;--ink-2:#3A3F49;--muted:#6B7280;--faint:#9AA1AD;
  --line:#E8EAED;--hair:#F0F2F5;--canvas:#F6F7F9;--card:#FFFFFF;--rail:#FBFBFC;
  --primary:#2947E0;--primary-d:#1E37B8;--primary-soft:#EDF0FE;--primary-ring:rgba(41,71,224,.18);
  --amber:#B7791F;--amber-bg:#FDF6E7;--amber-line:#F2D999;
  --green:#0F9D63;--green-bg:#E9F7F0;--red:#D64545;--red-bg:#FEF2F2;
  --surface:var(--card);--surface2:#FCFCFD;--line2:#D8DCE3;
  --brand:var(--primary);--brand-d:var(--primary-d);--brand-soft:var(--primary-soft);
  --sh-1:0 1px 2px rgba(20,25,45,.05);--sh-2:0 8px 28px rgba(20,25,45,.10);
}
:root[data-theme="dark"]{
  --canvas:#0E1116;--card:#171A21;--rail:#12151B;--surface:#171A21;--surface2:#1C2029;
  --ink:#E6E8EC;--ink-2:#B4B9C4;--muted:#8A90A0;--faint:#82899A;
  --line:#2A2F3A;--hair:#20242D;--line2:#333A47;
  --primary:#6A83F5;--primary-d:#4359D8;--primary-soft:#1E2437;--primary-ring:rgba(106,131,245,.28);
  --brand:#6A83F5;--brand-d:#4359D8;--brand-soft:#1E2437;
  --green:#34D399;--green-bg:#0E2A20;--amber:#F0C674;--amber-bg:#2A2410;--amber-line:#4A3D18;--red:#F87171;--red-bg:#2C1618;
  --sh-1:0 1px 2px rgba(0,0,0,.4);--sh-2:0 8px 28px rgba(0,0,0,.5);
  color-scheme:dark;
}
.sq-auth-page{
  min-height:100vh;box-sizing:border-box;display:flex;align-items:center;justify-content:center;
  background:
    radial-gradient(circle at 18% 12%,var(--primary-soft) 0,transparent 30%),
    radial-gradient(circle at 88% 82%,var(--primary-soft) 0,transparent 28%),
    var(--canvas);
  color:var(--ink);font-family:"Be Vietnam Pro",Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:28px;
}
.sq-auth-page *{box-sizing:border-box;}
.sq-auth-card{
  width:100%;max-width:520px;background:var(--card);border:1px solid var(--line);border-radius:20px;
  box-shadow:var(--sh-2);padding:36px;display:flex;flex-direction:column;gap:12px;
}
.sq-auth-brand{display:flex;align-items:center;gap:10px;margin-bottom:12px;}
.sq-auth-brand-mark{
  width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,var(--primary),var(--primary-d));
  display:grid;place-items:center;color:#fff;box-shadow:0 2px 8px var(--primary-ring);flex:none;
}
.sq-auth-brand-name{font-size:19px;line-height:1;font-weight:800;letter-spacing:-.3px;color:var(--ink);}
.sq-auth-brand-name span{color:var(--brand);}
.sq-auth-heading{display:flex;flex-direction:column;gap:8px;margin-bottom:12px;}
.sq-auth-card h1{margin:0;color:var(--ink);font-size:28px;line-height:1.22;letter-spacing:-.55px;font-weight:800;}
.sq-auth-card p{margin:0;color:var(--muted);line-height:1.65;font-size:14px;}
.sq-auth-card label{font-size:13px;color:var(--ink-2);font-weight:700;margin-top:5px;}
.sq-auth-card input{
  width:100%;border:1px solid var(--line2);border-radius:10px;padding:12px 13px;font-size:15px;line-height:1.4;
  outline:none;font-family:inherit;background:var(--surface2);color:var(--ink);transition:border-color .15s,box-shadow .15s,background .15s;
}
.sq-auth-card input::placeholder{color:var(--faint);opacity:1;}
.sq-auth-card input:hover{border-color:var(--line);background:var(--card);}
.sq-auth-card input:focus{border-color:var(--brand);background:var(--card);box-shadow:0 0 0 3px var(--primary-ring);}
.sq-auth-card input:-webkit-autofill,
.sq-auth-card input:-webkit-autofill:hover,
.sq-auth-card input:-webkit-autofill:focus{
  -webkit-text-fill-color:var(--ink);caret-color:var(--ink);box-shadow:0 0 0 1000px var(--surface2) inset;
  transition:background-color 9999s ease-out 0s;
}
.sq-auth-card button[type="submit"]{
  margin-top:14px;border:0;border-radius:10px;background:var(--primary-d);color:#fff;font-weight:700;padding:13px 16px;
  cursor:pointer;font-size:15px;font-family:inherit;box-shadow:0 5px 16px var(--primary-ring);transition:transform .12s,background .15s,box-shadow .15s;
}
.sq-auth-card button[type="submit"]:hover:not(:disabled){background:var(--primary-d);transform:translateY(-1px);box-shadow:0 7px 20px var(--primary-ring);}
.sq-auth-card button[type="submit"]:active:not(:disabled){transform:translateY(0);}
.sq-auth-card button[disabled]{opacity:.58;cursor:not-allowed;box-shadow:none;}
.sq-auth-link{
  align-self:center;border:0;background:transparent;color:var(--brand);font-weight:700;cursor:pointer;padding:6px 10px;
  font-size:13px;line-height:1.45;font-family:inherit;border-radius:8px;
}
.sq-auth-link:hover{background:var(--primary-soft);}
.sq-auth-link.muted{color:var(--muted);font-weight:650;}
.sq-auth-notice,.sq-auth-status{font-size:13px;border-radius:10px;padding:10px 12px;line-height:1.5;margin-top:2px;}
.sq-auth-notice{background:var(--amber-bg);color:var(--ink-2);border:1px solid var(--amber-line);}
.sq-auth-status{background:var(--primary-soft);color:var(--brand);border:1px solid var(--line);}
@media(max-width:640px){
  .sq-auth-page{padding:16px;align-items:flex-start;padding-top:max(24px,6vh);}
  .sq-auth-card{max-width:none;padding:26px 20px;border-radius:16px;}
  .sq-auth-card h1{font-size:24px;}
  .sq-auth-brand{margin-bottom:8px;}
}
`;
