import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { RingProvider } from "./state/RingProvider.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <RingProvider>
        <App />
      </RingProvider>
    </HashRouter>
  </StrictMode>,
);
