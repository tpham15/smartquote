import React from "react";
import { createRoot } from "react-dom/client";
import SmartQuote from "./SmartQuote.jsx";
import SupabaseAuthGate from "./supabase/SupabaseAuthGate.jsx";

const root = createRoot(document.getElementById("root"));
root.render(
  React.createElement(SupabaseAuthGate, null, (cloud) => React.createElement(SmartQuote, { cloud }))
);
