const storageKey = "event-signal-monitor-local-client";
let clientId;
try {
  clientId = sessionStorage.getItem(storageKey) || crypto.randomUUID();
  sessionStorage.setItem(storageKey, clientId);
} catch {
  clientId = crypto.randomUUID();
}

const payload = () => JSON.stringify({ clientId });

async function heartbeat() {
  try {
    await fetch("/api/local-dashboard/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload(),
      cache: "no-store",
      keepalive: true
    });
  } catch {
    // Closing the final page intentionally makes the server unreachable.
  }
}

heartbeat();
const heartbeatTimer = setInterval(heartbeat, 2_000);

addEventListener("pagehide", () => {
  clearInterval(heartbeatTimer);
  navigator.sendBeacon(
    "/api/local-dashboard/release",
    new Blob([payload()], { type: "application/json" })
  );
}, { once: true });
