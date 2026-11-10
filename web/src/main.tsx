import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./theme/tokens.css";
import "./theme/base.css";
import "./theme/fonts.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing #root element in index.html.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
