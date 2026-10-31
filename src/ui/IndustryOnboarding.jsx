import React, { useState } from "react";
import { BUSINESS_TYPES, INDUSTRY_PROFILE_LIST } from "../config/industryProfiles.js";

export default function IndustryOnboarding({ dealerName = "", onSave, busy = false, error = "" }) {
  const [industry, setIndustry] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [step, setStep] = useState(1);

  const submit = async () => {
    if (!industry || busy) return;
    await onSave?.({ industryProfile: industry, businessType: businessType || null });
  };

  return (
    <div className="sq-industry-page">
      <style>{INDUSTRY_CSS}</style>
      <div className="sq-industry-card">
        <div className="sq-industry-brand"><span>✓</span><strong>Smart<em>Quote</em></strong></div>
        <div className="sq-industry-progress"><i className={step >= 1 ? "on" : ""}/><i className={step >= 2 ? "on" : ""}/></div>
        {step === 1 ? (
          <>
            <div className="sq-industry-heading">
              <small>{dealerName ? `Thiết lập ${dealerName}` : "Thiết lập workspace"}</small>
              <h1>Bạn đang kinh doanh trong lĩnh vực nào?</h1>
              <p>SmartQuote sẽ điều chỉnh thuật ngữ, trường dữ liệu và mẫu làm việc phù hợp với ngành của bạn. Bạn có thể thay đổi sau.</p>
            </div>
            <div className="sq-industry-grid">
              {INDUSTRY_PROFILE_LIST.map((profile) => (
                <button key={profile.id} type="button" className={industry === profile.id ? "selected" : ""} onClick={() => setIndustry(profile.id)}>
                  <b>{profile.icon}</b><span><strong>{profile.name}</strong><small>{profile.description}</small></span><i>✓</i>
                </button>
              ))}
            </div>
            {error && <div className="sq-industry-error">{error}</div>}
            <div className="sq-industry-actions"><span/><button type="button" disabled={!industry || busy} onClick={() => setStep(2)}>Tiếp tục →</button></div>
          </>
        ) : (
          <>
            <div className="sq-industry-heading">
              <small>Bước 2 · không bắt buộc</small>
              <h1>Doanh nghiệp của bạn thuộc mô hình nào?</h1>
              <p>Thông tin này giúp SmartQuote đưa ra gợi ý phù hợp hơn. Bạn có thể bỏ qua.</p>
            </div>
            <div className="sq-business-grid">
              {BUSINESS_TYPES.map((item) => (
                <button key={item.id} type="button" className={businessType === item.id ? "selected" : ""} onClick={() => setBusinessType(item.id)}>{item.label}<i>✓</i></button>
              ))}
            </div>
            {error && <div className="sq-industry-error">{error}</div>}
            <div className="sq-industry-actions">
              <button className="ghost" type="button" disabled={busy} onClick={() => setStep(1)}>← Quay lại</button>
              <div><button className="ghost" type="button" disabled={busy} onClick={() => { setBusinessType(""); submit(); }}>Bỏ qua</button><button type="button" disabled={busy} onClick={submit}>{busy ? "Đang lưu..." : "Vào SmartQuote →"}</button></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const INDUSTRY_CSS = `
:root{--sq-blue:#2947E0;--sq-blue-soft:#EDF0FE;--sq-ink:#16181D;--sq-muted:#6B7280;--sq-line:#E6E8ED;--sq-card:#fff;--sq-bg:#F6F7F9}
:root[data-theme="dark"]{--sq-blue:#6A83F5;--sq-blue-soft:#1E2437;--sq-ink:#E6E8EC;--sq-muted:#9AA1AD;--sq-line:#2A2F3A;--sq-card:#171A21;--sq-bg:#0E1116;color-scheme:dark}
.sq-industry-page{min-height:100vh;background:radial-gradient(circle at 15% 5%,var(--sq-blue-soft),transparent 30%),var(--sq-bg);display:flex;align-items:center;justify-content:center;padding:28px;font-family:"Be Vietnam Pro",Inter,system-ui,sans-serif;color:var(--sq-ink)}
.sq-industry-page *{box-sizing:border-box}.sq-industry-card{width:min(960px,100%);background:var(--sq-card);border:1px solid var(--sq-line);border-radius:22px;padding:34px;box-shadow:0 16px 45px rgba(20,25,45,.10)}
.sq-industry-brand{display:flex;align-items:center;gap:10px;font-size:20px}.sq-industry-brand>span{width:34px;height:34px;border-radius:10px;background:var(--sq-blue);color:#fff;display:grid;place-items:center;font-weight:900}.sq-industry-brand strong{font-style:normal}.sq-industry-brand em{font-style:normal;color:var(--sq-blue)}
.sq-industry-progress{display:flex;gap:6px;margin:22px 0 30px}.sq-industry-progress i{height:4px;flex:1;background:var(--sq-line);border-radius:20px}.sq-industry-progress i.on{background:var(--sq-blue)}
.sq-industry-heading small{color:var(--sq-blue);font-weight:800;text-transform:uppercase;letter-spacing:.08em}.sq-industry-heading h1{margin:7px 0 9px;font-size:31px;letter-spacing:-.6px}.sq-industry-heading p{margin:0;color:var(--sq-muted);line-height:1.65;max-width:720px}
.sq-industry-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:24px}.sq-industry-grid button{position:relative;text-align:left;display:flex;align-items:flex-start;gap:13px;background:var(--sq-card);color:var(--sq-ink);border:1px solid var(--sq-line);border-radius:14px;padding:16px;cursor:pointer;font-family:inherit}.sq-industry-grid button:hover,.sq-industry-grid button.selected,.sq-business-grid button.selected{border-color:var(--sq-blue);box-shadow:0 0 0 3px var(--sq-blue-soft)}.sq-industry-grid button>b{font-size:24px;width:32px}.sq-industry-grid button span{display:grid;gap:4px}.sq-industry-grid button strong{font-size:15px}.sq-industry-grid button small{color:var(--sq-muted);line-height:1.45}.sq-industry-grid button>i,.sq-business-grid button>i{margin-left:auto;font-style:normal;color:transparent}.sq-industry-grid button.selected>i,.sq-business-grid button.selected>i{color:var(--sq-blue)}
.sq-business-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:26px}.sq-business-grid button{display:flex;align-items:center;gap:8px;min-height:56px;padding:13px 15px;border-radius:12px;border:1px solid var(--sq-line);background:var(--sq-card);color:var(--sq-ink);font-family:inherit;font-weight:700;cursor:pointer}.sq-business-grid button i{margin-left:auto}
.sq-industry-actions{display:flex;align-items:center;justify-content:space-between;margin-top:28px;gap:12px}.sq-industry-actions>div{display:flex;gap:10px}.sq-industry-actions button{border:0;border-radius:10px;background:var(--sq-blue);color:#fff;padding:12px 17px;font-weight:800;font-family:inherit;cursor:pointer}.sq-industry-actions button:disabled{opacity:.45;cursor:not-allowed}.sq-industry-actions button.ghost{background:transparent;color:var(--sq-muted);border:1px solid var(--sq-line)}.sq-industry-error{margin-top:14px;border:1px solid #F3B5B5;background:#FEF2F2;color:#B42318;border-radius:10px;padding:10px 12px;font-size:13px}
@media(max-width:720px){.sq-industry-page{padding:14px;align-items:flex-start}.sq-industry-card{padding:22px 17px;border-radius:16px}.sq-industry-heading h1{font-size:25px}.sq-industry-grid,.sq-business-grid{grid-template-columns:1fr}.sq-industry-actions{align-items:stretch}.sq-industry-actions>div{flex:1;justify-content:flex-end}}
`;
