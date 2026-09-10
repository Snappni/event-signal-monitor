const CLOCK_ID = "liveBeijingClock";
const formatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

function ensureClock() {
  let clock = document.getElementById(CLOCK_ID);
  if (clock) return clock;

  const subtitle = document.getElementById("subtitle");
  if (!subtitle) return null;

  clock = document.createElement("p");
  clock.id = CLOCK_ID;
  clock.className = "live-beijing-clock";
  clock.setAttribute("aria-live", "off");
  subtitle.insertAdjacentElement("afterend", clock);
  return clock;
}

function updateClock() {
  const clock = ensureClock();
  if (clock) clock.textContent = `北京时间 ${formatter.format(new Date())}（UTC+8）`;
}

let clockTimer = null;

function scheduleClock() {
  clearTimeout(clockTimer);
  const delay = Math.max(20, 1_000 - (Date.now() % 1_000) + 10);
  clockTimer = setTimeout(() => {
    updateClock();
    scheduleClock();
  }, delay);
}

function syncClock() {
  updateClock();
  scheduleClock();
}

function startClock() {
  syncClock();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncClock();
  });
  window.addEventListener("focus", syncClock);
  window.addEventListener("pageshow", syncClock);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startClock, { once: true });
} else {
  startClock();
}
