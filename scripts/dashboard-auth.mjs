import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const PASSWORD_FORMAT = "scrypt-v1";
const DEFAULT_SCRYPT = Object.freeze({ N: 2 ** 15, r: 8, p: 3, keyLength: 32 });
const LOGIN_BODY_LIMIT = 8 * 1024;
const SESSION_COOKIE = "esm_dashboard_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1_000;
const REMEMBERED_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1_000;
const LOCK_DURATION_MS = 15 * 60 * 1_000;
const MAX_FAILED_ATTEMPTS = 5;

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseStoredPassword(stored) {
  const [format, nText, rText, pText, saltText, derivedText] = String(stored || "").split("$");
  if (format !== PASSWORD_FORMAT || !saltText || !derivedText) return null;
  const N = safeInteger(Number(nText), 0);
  const r = safeInteger(Number(rText), 0);
  const p = safeInteger(Number(pText), 0);
  if (!N || !r || !p || (N & (N - 1)) !== 0) return null;
  try {
    const salt = Buffer.from(saltText, "base64url");
    const derived = Buffer.from(derivedText, "base64url");
    if (salt.length < 16 || derived.length < 32) return null;
    return { N, r, p, salt, derived };
  } catch {
    return null;
  }
}

export async function hashDashboardPassword(password, options = {}) {
  const value = String(password ?? "");
  if (!value || Buffer.byteLength(value, "utf8") > 1_024) {
    throw new Error("Password must contain between 1 and 1024 UTF-8 bytes.");
  }
  const N = safeInteger(options.N, DEFAULT_SCRYPT.N);
  const r = safeInteger(options.r, DEFAULT_SCRYPT.r);
  const p = safeInteger(options.p, DEFAULT_SCRYPT.p);
  const keyLength = safeInteger(options.keyLength, DEFAULT_SCRYPT.keyLength);
  const salt = options.salt ? Buffer.from(options.salt) : randomBytes(16);
  const maxmem = Math.max(128 * N * r + 16 * 1024 * 1024, 64 * 1024 * 1024);
  const derived = await scrypt(value, salt, keyLength, { N, r, p, maxmem });
  return [PASSWORD_FORMAT, N, r, p, base64Url(salt), base64Url(derived)].join("$");
}

async function verifyPassword(password, stored) {
  const parsed = parseStoredPassword(stored);
  if (!parsed) return false;
  const maxmem = Math.max(128 * parsed.N * parsed.r + 16 * 1024 * 1024, 64 * 1024 * 1024);
  try {
    const candidate = await scrypt(String(password ?? ""), parsed.salt, parsed.derived.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem
    });
    return candidate.length === parsed.derived.length && timingSafeEqual(candidate, parsed.derived);
  } catch {
    return false;
  }
}

function parseCookies(header) {
  const cookies = new Map();
  for (const pair of String(header || "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (name) cookies.set(name, value);
  }
  return cookies;
}

function normalizeReturnTo(value) {
  const target = String(value || "/");
  if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\")) return "/";
  try {
    const parsed = new URL(target, "http://dashboard.local");
    if (parsed.origin !== "http://dashboard.local") return "/";
    if (["/login", "/login.html", "/auth/login", "/auth/logout"].includes(parsed.pathname)) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

function requestIp(request) {
  return String(request.socket?.remoteAddress || "unknown").slice(0, 128);
}

function requestProtocol(request, trustProxy) {
  if (trustProxy) {
    const forwarded = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
    if (forwarded === "https" || forwarded === "http") return forwarded;
  }
  return request.socket?.encrypted ? "https" : "http";
}

function sameOrigin(request, trustProxy, publicOrigin) {
  const supplied = String(request.headers.origin || "");
  if (!supplied) return true;
  let expected = publicOrigin;
  if (!expected) {
    const host = String(request.headers.host || "");
    if (!host) return false;
    expected = `${requestProtocol(request, trustProxy)}://${host}`;
  }
  try {
    return new URL(supplied).origin === new URL(expected).origin;
  } catch {
    return false;
  }
}

async function readLimitedJson(request) {
  if (!String(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) {
    const error = new Error("Content-Type must be application/json.");
    error.statusCode = 415;
    throw error;
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > LOGIN_BODY_LIMIT) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("Invalid JSON request.");
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(response, payload, statusCode = 200, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function redirect(response, location, headers = {}) {
  response.writeHead(303, { Location: location, "Cache-Control": "no-store", ...headers });
  response.end();
}

export function createDashboardAuth({ env = process.env, loginHtmlPath, sessionFilePath = null, logger = console } = {}) {
  const enabled = env.DASHBOARD_AUTH_ENABLED === "1";
  const username = String(env.DASHBOARD_AUTH_USERNAME || "adminroot");
  const passwordHash = String(env.DASHBOARD_AUTH_PASSWORD_HASH || "");
  const secureCookie = env.DASHBOARD_AUTH_COOKIE_SECURE !== "0";
  const trustProxy = env.DASHBOARD_AUTH_TRUST_PROXY === "1";
  const publicOrigin = String(env.DASHBOARD_AUTH_PUBLIC_ORIGIN || "").replace(/\/$/, "");
  const credentialVersion = sha256(passwordHash);
  if (enabled && !parseStoredPassword(passwordHash)) {
    throw new Error("DASHBOARD_AUTH_ENABLED=1 requires a valid DASHBOARD_AUTH_PASSWORD_HASH.");
  }

  const sessions = new Map();
  const failedAttempts = new Map();
  let loginTemplate = null;

  function persistSessions() {
    if (!enabled || !sessionFilePath) return;
    const directory = path.dirname(sessionFilePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporary = `${sessionFilePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = {
      version: 1,
      sessions: [...sessions.entries()].map(([tokenHash, session]) => ({ tokenHash, ...session }))
    };
    fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
    if (process.platform !== "win32") fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, sessionFilePath);
  }

  function loadSessions() {
    if (!enabled || !sessionFilePath) return;
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(sessionFilePath, "utf8"));
    } catch {
      return;
    }
    const now = Date.now();
    for (const item of Array.isArray(payload?.sessions) ? payload.sessions : []) {
      if (
        !/^[a-f0-9]{64}$/.test(String(item?.tokenHash || "")) ||
        item?.username !== username ||
        item?.credentialVersion !== credentialVersion ||
        !Number.isFinite(Number(item?.expiresAt)) ||
        Number(item.expiresAt) <= now
      ) continue;
      sessions.set(item.tokenHash, {
        username,
        credentialVersion,
        createdAt: Number(item.createdAt) || now,
        lastSeenAt: Number(item.lastSeenAt) || now,
        expiresAt: Number(item.expiresAt),
        remembered: item.remembered === true
      });
    }
  }

  loadSessions();

  function applySecurityHeaders(_request, response, nonce = null) {
    const scriptSource = nonce ? `'nonce-${nonce}'` : "'self'";
    response.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src ${scriptSource}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`
    );
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if (secureCookie) response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  function cookieHeader(token, remember) {
    const parts = [
      `${SESSION_COOKIE}=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict"
    ];
    if (secureCookie) parts.push("Secure");
    if (remember) parts.push(`Max-Age=${Math.floor(REMEMBERED_SESSION_TTL_MS / 1_000)}`);
    return parts.join("; ");
  }

  function clearCookieHeader() {
    return [
      `${SESSION_COOKIE}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      secureCookie ? "Secure" : null,
      "Max-Age=0"
    ].filter(Boolean).join("; ");
  }

  function sessionFor(request) {
    const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    if (!token || token.length > 256) return null;
    const tokenHash = sha256(token);
    const session = sessions.get(tokenHash);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(tokenHash);
      persistSessions();
      return null;
    }
    session.lastSeenAt = Date.now();
    return { tokenHash, session };
  }

  function createSession(remember) {
    const token = base64Url(randomBytes(32));
    const now = Date.now();
    sessions.set(sha256(token), {
      username,
      credentialVersion,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + (remember ? REMEMBERED_SESSION_TTL_MS : SESSION_TTL_MS),
      remembered: remember
    });
    persistSessions();
    return token;
  }

  function attemptState(ip) {
    const now = Date.now();
    const current = failedAttempts.get(ip);
    if (!current || now - current.windowStartedAt > ATTEMPT_WINDOW_MS) {
      const fresh = { count: 0, windowStartedAt: now, lockedUntil: 0 };
      failedAttempts.set(ip, fresh);
      return fresh;
    }
    return current;
  }

  function registerFailure(ip) {
    const state = attemptState(ip);
    state.count += 1;
    if (state.count >= MAX_FAILED_ATTEMPTS) state.lockedUntil = Date.now() + LOCK_DURATION_MS;
    return state;
  }

  function isApiPath(pathname) {
    return pathname.startsWith("/api/") || pathname.startsWith("/auth/");
  }

  function serveLogin(request, response, url) {
    if (sessionFor(request)) {
      redirect(response, normalizeReturnTo(url.searchParams.get("next")));
      return;
    }
    if (!loginTemplate) loginTemplate = fs.readFileSync(loginHtmlPath, "utf8");
    const nonce = base64Url(randomBytes(18));
    applySecurityHeaders(request, response, nonce);
    const html = loginTemplate.replaceAll("{{SCRIPT_NONCE}}", nonce);
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache"
    });
    response.end(html);
  }

  async function handlePublic(request, response, url) {
    if (!enabled) return false;
    if ((url.pathname === "/login" || url.pathname === "/login.html") && ["GET", "HEAD"].includes(request.method)) {
      serveLogin(request, response, url);
      return true;
    }
    if (url.pathname === "/api/auth/session" && request.method === "GET") {
      const active = sessionFor(request);
      sendJson(response, {
        enabled: true,
        authenticated: Boolean(active),
        username: active ? username : null,
        remembered: active?.session.remembered === true
      });
      return true;
    }
    if (url.pathname === "/auth/login" && request.method === "POST") {
      if (!sameOrigin(request, trustProxy, publicOrigin)) {
        sendJson(response, { error: "request_origin_rejected" }, 403);
        return true;
      }
      const ip = requestIp(request);
      const attempt = attemptState(ip);
      if (attempt.lockedUntil > Date.now()) {
        const retryAfter = Math.max(1, Math.ceil((attempt.lockedUntil - Date.now()) / 1_000));
        response.setHeader("Retry-After", String(retryAfter));
        sendJson(response, { error: "too_many_attempts", retryAfter }, 429);
        return true;
      }
      try {
        const body = await readLimitedJson(request);
        const suppliedUsername = typeof body.username === "string" ? body.username : "";
        const suppliedPassword = typeof body.password === "string" ? body.password : "";
        const remember = body.remember === true;
        const usernameMatches = suppliedUsername.length <= 128 && suppliedUsername === username;
        const passwordMatches = suppliedPassword.length <= 1_024 && await verifyPassword(suppliedPassword, passwordHash);
        if (!usernameMatches || !passwordMatches) {
          const failed = registerFailure(ip);
          logger.warn?.(`Dashboard login rejected from ${ip}; failedAttempts=${failed.count}`);
          await new Promise((resolve) => setTimeout(resolve, 120));
          sendJson(response, { error: "invalid_credentials" }, 401);
          return true;
        }
        failedAttempts.delete(ip);
        const token = createSession(remember);
        const next = normalizeReturnTo(body.next);
        logger.info?.(`Dashboard login accepted from ${ip}; remembered=${remember}`);
        sendJson(response, { authenticated: true, next }, 200, { "Set-Cookie": cookieHeader(token, remember) });
      } catch (error) {
        sendJson(response, { error: "invalid_request" }, error?.statusCode || 400);
      }
      return true;
    }
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      if (!sameOrigin(request, trustProxy, publicOrigin)) {
        sendJson(response, { error: "request_origin_rejected" }, 403);
        return true;
      }
      const active = sessionFor(request);
      if (active) {
        sessions.delete(active.tokenHash);
        persistSessions();
      }
      sendJson(response, { authenticated: false }, 200, { "Set-Cookie": clearCookieHeader() });
      return true;
    }
    return false;
  }

  function authorize(request, response, url) {
    if (!enabled) return true;
    const active = sessionFor(request);
    if (active) {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !sameOrigin(request, trustProxy, publicOrigin)) {
        sendJson(response, { error: "request_origin_rejected" }, 403);
        return false;
      }
      return true;
    }
    response.setHeader("Set-Cookie", clearCookieHeader());
    if (isApiPath(url.pathname)) {
      sendJson(response, { error: "authentication_required" }, 401);
      return false;
    }
    if (["GET", "HEAD"].includes(request.method)) {
      const next = normalizeReturnTo(`${url.pathname}${url.search}`);
      redirect(response, `/login?next=${encodeURIComponent(next)}`);
      return false;
    }
    sendJson(response, { error: "authentication_required" }, 401);
    return false;
  }

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    let sessionsChanged = false;
    for (const [key, session] of sessions) {
      if (session.expiresAt <= now) {
        sessions.delete(key);
        sessionsChanged = true;
      }
    }
    if (sessionsChanged) persistSessions();
    for (const [ip, state] of failedAttempts) {
      if (state.lockedUntil <= now && now - state.windowStartedAt > ATTEMPT_WINDOW_MS) failedAttempts.delete(ip);
    }
  }, 60_000);
  cleanupTimer.unref();

  return {
    enabled,
    applySecurityHeaders,
    handlePublic,
    authorize,
    close() {
      clearInterval(cleanupTimer);
      failedAttempts.clear();
    }
  };
}
