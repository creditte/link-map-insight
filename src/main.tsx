import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// ── Unregister any rogue service workers ────────────────────────────
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const reg of regs) {
      console.warn("[SW] Unregistering service worker:", reg.scope);
      reg.unregister();
    }
  });
}

// ── Global Error Guards ─────────────────────────────────────────────
window.addEventListener("error", (event) => {
  console.error("[GlobalError]", event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[UnhandledRejection]", event.reason);
});

// ── Bootstrap ───────────────────────────────────────────────────────
try {
  const root = createRoot(document.getElementById("root")!);
  root.render(<App />);
} catch (err) {
  console.error("[BootstrapError]", err);
  // Render a minimal recovery screen without React
  const el = document.getElementById("root");
  if (el) {
    el.innerHTML = `
      <div style="display:flex;min-height:100vh;align-items:center;justify-content:center;font-family:system-ui,sans-serif;padding:24px;">
        <div style="max-width:400px;text-align:center;">
          <h1 style="font-size:1.25rem;font-weight:600;margin-bottom:12px;">Something went wrong</h1>
          <p style="color:#666;margin-bottom:20px;">The app failed to start. Please reload or go to login.</p>
          <button onclick="window.location.reload()" style="padding:8px 20px;border:none;background:#111;color:#fff;border-radius:6px;cursor:pointer;margin-right:8px;">Reload</button>
          <button onclick="window.location.href='/auth'" style="padding:8px 20px;border:1px solid #ccc;background:transparent;border-radius:6px;cursor:pointer;">Go to Login</button>
          <p style="margin-top:16px;font-size:11px;color:#999;">${new Date().toISOString()}</p>
        </div>
      </div>`;
  }
}
