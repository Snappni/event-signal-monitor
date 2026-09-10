import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createDashboardAuth, hashDashboardPassword } from "./dashboard-auth.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "event-signal-dashboard-auth-test-"));
const port = 28_998;
const baseUrl = `http://127.0.0.1:${port}`;
const testPassword = "test-only-password";
const passwordHash = await hashDashboardPassword(testPassword, { N: 2 ** 13, r: 8, p: 1 });
let output = "";
let child = null;

function startServer() {
  const server = spawn(process.execPath, ["./scripts/serve-dashboard.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      SIGNAL_DASHBOARD_PORT: String(port),
      SIGNAL_RUNTIME_DIR: runtime,
      SIGNAL_DASHBOARD_AUTO_START_SERVICE: "false",
      DASHBOARD_AUTH_ENABLED: "1",
      DASHBOARD_AUTH_USERNAME: "adminroot",
      DASHBOARD_AUTH_PASSWORD_HASH: passwordHash,
      DASHBOARD_AUTH_COOKIE_SECURE: "0"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  return server;
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await once(child, "exit");
}

async function waitForLogin() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/login`);
      if (response.status === 200) return response;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`auth dashboard did not start\n${output}`);
}

function cookieFrom(response) {
  return String(response.headers.get("set-cookie") || "").split(";")[0];
}

async function login(body) {
  return fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify(body)
  });
}

async function testUnavailableLoginTemplate() {
  const template = path.join(runtime, "login-template.html");
  const env = { DASHBOARD_AUTH_ENABLED: "1", DASHBOARD_AUTH_PASSWORD_HASH: passwordHash };
  const warnings = [];
  const makeResponse = () => ({
    headers: {}, status: null, body: null,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    writeHead(status, headers) {
      this.status = status;
      for (const [key, value] of Object.entries(headers)) this.setHeader(key, value);
    },
    end(body) { this.body = body; }
  });
  const request = { method: "GET", headers: {}, socket: {} };
  for (const code of ["ENOENT", "EACCES"]) {
    const auth = createDashboardAuth({ env, loginHtmlPath: template, logger: { error: (line) => warnings.push(line) } });
    const read = fs.readFileSync;
    fs.readFileSync = (file, ...args) => {
      if (file === template) throw Object.assign(new Error("fixture path must not leak"), { code });
      return read(file, ...args);
    };
    try {
      for (const method of ["GET", "HEAD"]) {
        const response = makeResponse();
        assert.equal(await auth.handlePublic({ ...request, method }, response, new URL("/login.html", baseUrl)), true);
        assert.equal(response.status, 503);
        assert.equal(response.headers["cache-control"], "no-store");
        assert.equal(response.headers["x-frame-options"], "DENY");
        assert.doesNotMatch(response.body || "", /fixture|ENOENT|EACCES|login-template/);
        if (method === "HEAD") assert.equal(response.body, undefined);
      }
    } finally {
      fs.readFileSync = read;
    }
    for (const [target, status] of [["/index.html", 303], ["/api/status", 401]]) {
      const response = makeResponse();
      assert.equal(auth.authorize(request, response, new URL(target, baseUrl)), false);
      assert.equal(response.status, status);
    }
    fs.writeFileSync(template, '<script nonce="{{SCRIPT_NONCE}}"></script>');
    const recovered = makeResponse();
    assert.equal(await auth.handlePublic(request, recovered, new URL("/login.html", baseUrl)), true);
    assert.equal(recovered.status, 200, "same auth instance retries after template repair");
    assert.doesNotMatch(recovered.body, /\{\{SCRIPT_NONCE\}\}/);
    fs.unlinkSync(template);
  }
  assert.equal(warnings.length, 4);
  const disabled = createDashboardAuth({ env: {}, loginHtmlPath: template });
  assert.equal(await disabled.handlePublic(request, makeResponse(), new URL("/login.html", baseUrl)), false);
  assert.equal(disabled.authorize(request, makeResponse(), new URL("/index.html", baseUrl)), true);
}

try {
  await testUnavailableLoginTemplate();
  child = startServer();
  const loginPage = await waitForLogin();
  const loginHtml = await loginPage.text();
  assert.match(loginHtml, /id="username"/);
  assert.match(loginHtml, /id="password"/);
  assert.match(loginHtml, /id="remember"/);
  assert.match(loginHtml, /记住密码/);
  assert.doesNotMatch(loginHtml, /注册|sign.?up/i);
  assert.ok(loginPage.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
  assert.equal(loginPage.headers.get("x-frame-options"), "DENY");

  for (const target of ["/", "/index.html", "/summary.html", "/styles.css"]) {
    const response = await fetch(`${baseUrl}${target}`, { redirect: "manual" });
    assert.equal(response.status, 303, `${target} must require authentication`);
    assert.match(response.headers.get("location") || "", /^\/login\?next=/);
  }
  const anonymousApi = await fetch(`${baseUrl}/api/status`);
  assert.equal(anonymousApi.status, 401);
  const anonymousResearch = await fetch(`${baseUrl}/api/factors/research`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "mine" }) });
  assert.equal(anonymousResearch.status, 401, "research actions must remain behind server authentication");
  assert.deepEqual(await anonymousApi.json(), { error: "authentication_required" });

  const injectionAttempt = await login({
    username: "adminroot' OR '1'='1",
    password: testPassword,
    remember: true,
    next: "/index.html"
  });
  assert.equal(injectionAttempt.status, 401, "SQL-style input must not bypass exact username comparison");

  const authenticated = await login({
    username: "adminroot",
    password: testPassword,
    remember: true,
    next: "https://attacker.example/steal"
  });
  assert.equal(authenticated.status, 200);
  const authenticatedBody = await authenticated.json();
  assert.equal(authenticatedBody.next, "/", "external redirects must be rejected");
  const setCookie = authenticated.headers.get("set-cookie") || "";
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Max-Age=2592000/i, "remember must persist only this authenticated session");
  assert.doesNotMatch(setCookie, new RegExp(testPassword));
  const cookie = cookieFrom(authenticated);
  assert.ok(cookie.startsWith("esm_dashboard_session="));

  const protectedPage = await fetch(`${baseUrl}/index.html`, { headers: { Cookie: cookie } });
  assert.equal(protectedPage.status, 200);
  assert.match(await protectedPage.text(), /id="accountForm"/);
  const protectedApi = await fetch(`${baseUrl}/api/status`, { headers: { Cookie: cookie } });
  assert.equal(protectedApi.status, 200);
  const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } });
  assert.deepEqual(await session.json(), {
    enabled: true,
    authenticated: true,
    username: "adminroot",
    remembered: true
  });

  const temporaryLogin = await login({
    username: "adminroot",
    password: testPassword,
    remember: false,
    next: "/"
  });
  assert.equal(temporaryLogin.status, 200);
  assert.doesNotMatch(temporaryLogin.headers.get("set-cookie") || "", /Max-Age=/i);
  const temporaryCookie = cookieFrom(temporaryLogin);
  const temporarySession = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: temporaryCookie } });
  assert.equal((await temporarySession.json()).remembered, false);
  const rememberedSessionStillActive = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } });
  assert.equal((await rememberedSessionStillActive.json()).remembered, true, "remember must be scoped to the selected session");

  await stopServer();
  child = startServer();
  await waitForLogin();
  const rememberedSessionAfterRestart = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } });
  assert.deepEqual(await rememberedSessionAfterRestart.json(), {
    enabled: true,
    authenticated: true,
    username: "adminroot",
    remembered: true
  }, "remembered session must survive a dashboard restart");

  const csrfAttempt = await fetch(`${baseUrl}/api/account/stop`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: "https://attacker.example" }
  });
  assert.equal(csrfAttempt.status, 403);

  const logout = await fetch(`${baseUrl}/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: baseUrl }
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") || "", /Max-Age=0/i);
  const afterLogout = await fetch(`${baseUrl}/api/status`, { headers: { Cookie: cookie } });
  assert.equal(afterLogout.status, 401, "logout must invalidate the server-side session");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rejected = await login({ username: "adminroot", password: `wrong-${attempt}` });
    assert.equal(rejected.status, 401);
  }
  const rateLimited = await login({ username: "adminroot", password: "wrong-again" });
  assert.equal(rateLimited.status, 429);
  assert.ok(Number(rateLimited.headers.get("retry-after")) > 0);

  console.log(JSON.stringify({
    passed: true,
    missingTemplate: 503,
    unreadableTemplate: 503,
    templateRecoveryWithoutRestart: true,
    anonymousIndex: 303,
    anonymousApi: 401,
    injectionAttempt: 401,
    authenticatedIndex: 200,
    rememberedSessionSeconds: 2_592_000,
    rememberScopedToSession: true,
    rememberSurvivedRestart: true,
    csrfAttempt: 403,
    afterLogout: 401,
    rateLimited: 429
  }));
} finally {
  await stopServer();
  fs.rmSync(runtime, { recursive: true, force: true });
}
