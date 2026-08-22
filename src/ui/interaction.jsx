import React, { useCallback, useEffect, useRef, useState } from "react";

let toastBridge = null;
let confirmBridge = null;

const normalizeMessage = (message) => String(message ?? "").trim();

function pushToast(tone, message, options = {}) {
  const text = normalizeMessage(message);
  if (!text) return;
  if (toastBridge) {
    toastBridge({ tone, message: text, ...options });
    return;
  }
  const logger = tone === "error" ? console.error : tone === "warning" ? console.warn : console.info;
  logger(`[SmartQuote ${tone}] ${text}`);
}

export const notify = {
  success: (message, options) => pushToast("success", message, options),
  error: (message, options) => pushToast("error", message, options),
  warning: (message, options) => pushToast("warning", message, options),
  info: (message, options) => pushToast("info", message, options),
};

export function confirmAction(input, options = {}) {
  const config = typeof input === "string" ? { message: input, ...options } : { ...(input || {}) };
  if (!confirmBridge) return Promise.resolve(false);
  return confirmBridge({
    title: config.title || "Xác nhận thao tác",
    message: normalizeMessage(config.message),
    confirmLabel: config.confirmLabel || "Xác nhận",
    cancelLabel: config.cancelLabel || "Hủy",
    tone: config.tone || "default",
    requireText: config.requireText || "",
    inputLabel: config.inputLabel || "Nhập nội dung xác nhận",
  });
}

const toastTitles = {
  success: "Đã hoàn tất",
  error: "Có lỗi xảy ra",
  warning: "Cần kiểm tra",
  info: "Thông báo",
};

export function InteractionHost() {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const [typedValue, setTypedValue] = useState("");
  const timersRef = useRef(new Map());

  const dismissToast = useCallback((id) => {
    setToasts((items) => items.filter((item) => item.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(id);
  }, []);

  useEffect(() => {
    toastBridge = (toast) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const duration = Number(toast.duration ?? (toast.actionLabel ? 7000 : 4200));
      setToasts((items) => [...items.slice(-3), { ...toast, id }]);
      if (duration > 0) {
        const timer = setTimeout(() => dismissToast(id), duration);
        timersRef.current.set(id, timer);
      }
    };
    confirmBridge = (config) => new Promise((resolve) => {
      setTypedValue("");
      setDialog({ ...config, resolve });
    });
    return () => {
      toastBridge = null;
      confirmBridge = null;
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
    };
  }, [dismissToast]);

  const closeDialog = useCallback((result) => {
    setDialog((current) => {
      current?.resolve?.(result);
      return null;
    });
    setTypedValue("");
  }, []);

  useEffect(() => {
    if (!dialog) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") closeDialog(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialog, closeDialog]);

  const required = dialog?.requireText || "";
  const confirmEnabled = !required || typedValue.trim().toUpperCase() === required.trim().toUpperCase();

  return (
    <>
      <div className="sq-toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div key={toast.id} className={`sq-toast ${toast.tone || "info"}`} role={toast.tone === "error" ? "alert" : "status"}>
            <div className="sq-toast-mark" aria-hidden="true">
              {toast.tone === "success" ? "✓" : toast.tone === "error" ? "!" : toast.tone === "warning" ? "!" : "i"}
            </div>
            <div className="sq-toast-body">
              <strong>{toast.title || toastTitles[toast.tone] || toastTitles.info}</strong>
              <span>{toast.message}</span>
              {toast.actionLabel && typeof toast.onAction === "function" ? (
                <button type="button" onClick={() => { toast.onAction(); dismissToast(toast.id); }}>{toast.actionLabel}</button>
              ) : null}
            </div>
            <button className="sq-toast-close" type="button" aria-label="Đóng thông báo" onClick={() => dismissToast(toast.id)}>×</button>
          </div>
        ))}
      </div>

      {dialog ? (
        <div className="sq-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(false); }}>
          <div className="sq-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="sq-confirm-title" aria-describedby="sq-confirm-message">
            <div className={`sq-confirm-icon ${dialog.tone === "danger" ? "danger" : ""}`} aria-hidden="true">{dialog.tone === "danger" ? "!" : "?"}</div>
            <div className="sq-confirm-copy">
              <h2 id="sq-confirm-title">{dialog.title}</h2>
              <p id="sq-confirm-message">{dialog.message}</p>
            </div>
            {required ? (
              <label className="sq-confirm-type">
                <span>{dialog.inputLabel}</span>
                <code>{required}</code>
                <input autoFocus value={typedValue} onChange={(event) => setTypedValue(event.target.value)} placeholder={required} />
              </label>
            ) : null}
            <div className="sq-confirm-actions">
              <button type="button" className="btn-ghost" onClick={() => closeDialog(false)}>{dialog.cancelLabel}</button>
              <button type="button" className={`sq-confirm-primary ${dialog.tone === "danger" ? "danger" : ""}`} disabled={!confirmEnabled} onClick={() => closeDialog(true)}>{dialog.confirmLabel}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
