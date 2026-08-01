import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";

// DO NOT REMOVE — required for voice UI tools (click / type / scroll / keys).
import "./voice-bridge";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
