const baseUrl = process.env.AUTH_SMOKE_BASE_URL || "http://localhost:3005";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const phone = `139${String(Date.now()).slice(-8)}`;
const password = "mini-password-12345";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

async function json(res) {
  return res.json().catch(() => ({}));
}

const guestStatus = await request("/api/auth/account-status");
const guestBody = await json(guestStatus);
assert(guestStatus.ok, `guest account status failed ${guestStatus.status}: ${JSON.stringify(guestBody)}`);
assert(guestBody.accountState === "guest", `expected guest, got ${guestBody.accountState}`);

const login = await request("/api/auth/wechat-login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: `smoke-${suffix}` }),
});
const loginBody = await json(login);
assert(login.ok, `wechat login failed ${login.status}: ${JSON.stringify(loginBody)}`);
assert(loginBody.token, "wechat login missing token");
assert(
  loginBody.accountState === "wechat_logged_in_unregistered",
  `expected unregistered, got ${loginBody.accountState}`,
);

const token = loginBody.token;

const phoneRes = await request("/api/auth/wechat-phone", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ code: `mock-phone-${phone}` }),
});
const phoneBody = await json(phoneRes);
assert(phoneRes.ok, `wechat phone failed ${phoneRes.status}: ${JSON.stringify(phoneBody)}`);
assert(phoneBody.phone === phone, `expected phone ${phone}, got ${phoneBody.phone}`);

const complete = await request("/api/auth/complete-registration", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ identifier: phone, password, displayName: "Mini Smoke" }),
});
const completeBody = await json(complete);
assert(complete.ok, `complete registration failed ${complete.status}: ${JSON.stringify(completeBody)}`);
assert(completeBody.accountState === "registered", `expected registered, got ${completeBody.accountState}`);

const registeredStatus = await request("/api/auth/account-status", {
  headers: { Authorization: `Bearer ${token}` },
});
const registeredStatusBody = await json(registeredStatus);
assert(
  registeredStatus.ok,
  `registered account status failed ${registeredStatus.status}: ${JSON.stringify(registeredStatusBody)}`,
);
assert(
  registeredStatusBody.accountState === "registered",
  `expected registered status after completion, got ${registeredStatusBody.accountState}`,
);
assert(registeredStatusBody.user?.id === completeBody.user?.id, "registered status returned a different user");

const cards = await request("/api/db/cards?weekId=all&page=1&pageSize=1", {
  headers: { Authorization: `Bearer ${token}` },
});
assert(cards.ok, `mini token cards access failed ${cards.status}: ${JSON.stringify(await json(cards))}`);

const debugLogin = await request("/api/auth/miniprogram-password-login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: phone, password }),
});
const debugLoginBody = await json(debugLogin);
assert(debugLogin.ok, `mini password login failed ${debugLogin.status}: ${JSON.stringify(debugLoginBody)}`);
assert(debugLoginBody.token, "mini password login missing token");
assert(debugLoginBody.accountState === "registered", `expected registered, got ${debugLoginBody.accountState}`);

const debugCards = await request("/api/db/cards?weekId=all&page=1&pageSize=1", {
  headers: { Authorization: `Bearer ${debugLoginBody.token}` },
});
assert(debugCards.ok, `mini password token cards access failed ${debugCards.status}: ${JSON.stringify(await json(debugCards))}`);

const webLogin = await request("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: phone, password }),
});
assert(webLogin.ok, `web phone login failed ${webLogin.status}: ${JSON.stringify(await json(webLogin))}`);

const linkLogin = await request("/api/auth/wechat-login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: `link-${suffix}` }),
});
const linkLoginBody = await json(linkLogin);
assert(linkLogin.ok, `link wechat login failed ${linkLogin.status}: ${JSON.stringify(linkLoginBody)}`);
assert(linkLoginBody.accountState === "wechat_logged_in_unregistered", "link identity should start unregistered");

const wrongLink = await request("/api/auth/link-existing-account", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${linkLoginBody.token}` },
  body: JSON.stringify({ identifier: phone, password: `${password}-wrong` }),
});
assert(wrongLink.status === 401, `wrong link password should return 401, got ${wrongLink.status}`);

const unlinkedStatus = await request("/api/auth/account-status", {
  headers: { Authorization: `Bearer ${linkLoginBody.token}` },
});
const unlinkedStatusBody = await json(unlinkedStatus);
assert(unlinkedStatusBody.accountState === "wechat_logged_in_unregistered", "failed link must not bind identity");

const linked = await request("/api/auth/link-existing-account", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${linkLoginBody.token}` },
  body: JSON.stringify({ identifier: phone, password }),
});
const linkedBody = await json(linked);
assert(linked.ok, `existing account link failed ${linked.status}: ${JSON.stringify(linkedBody)}`);
assert(linkedBody.accountState === "registered", `linked account should be registered, got ${linkedBody.accountState}`);
assert(linkedBody.user?.id === completeBody.user?.id, "linked account user does not match Web user");

const linkedStatus = await request("/api/auth/account-status", {
  headers: { Authorization: `Bearer ${linkLoginBody.token}` },
});
const linkedStatusBody = await json(linkedStatus);
assert(linkedStatusBody.accountState === "registered", "linked mini session should stay registered");
assert(linkedStatusBody.user?.id === completeBody.user?.id, "linked status user does not match Web user");

const logout = await request("/api/auth/miniprogram-logout", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
});
assert(logout.ok, `mini logout failed ${logout.status}: ${JSON.stringify(await json(logout))}`);

console.log("Mini program auth smoke passed");
