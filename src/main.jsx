import React from "react";
import { createRoot } from "react-dom/client";
import SmartQuote from "./SmartQuote.jsx";

const root = createRoot(document.getElementById("root"));
root.render(React.createElement(SmartQuote));
