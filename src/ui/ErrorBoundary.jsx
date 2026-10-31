import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("SmartQuote UI crashed:", error, info);
  }

  reload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f6f7f9", color: "#16181d", fontFamily: '"Be Vietnam Pro", Inter, system-ui, sans-serif' }}>
        <div style={{ width: "min(560px, 100%)", background: "#fff", border: "1px solid #e6e8ed", borderRadius: 18, padding: 28, boxShadow: "0 18px 55px rgba(20,25,45,.10)" }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#2947e0", textTransform: "uppercase", letterSpacing: ".08em" }}>SmartQuote</div>
          <h1 style={{ margin: "8px 0 10px", fontSize: 24 }}>Có lỗi khi hiển thị ứng dụng</h1>
          <p style={{ margin: 0, color: "#6b7280", lineHeight: 1.6 }}>Dữ liệu đã lưu trên cloud không bị xóa. Hãy tải lại trang. Nếu lỗi lặp lại, ghi lại thao tác vừa thực hiện và liên hệ hỗ trợ.</p>
          <button type="button" onClick={this.reload} style={{ marginTop: 20, border: 0, borderRadius: 10, padding: "11px 16px", background: "#2947e0", color: "#fff", fontWeight: 800, cursor: "pointer" }}>Tải lại SmartQuote</button>
        </div>
      </div>
    );
  }
}
