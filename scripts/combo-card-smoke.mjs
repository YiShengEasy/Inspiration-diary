import assert from "node:assert/strict";

const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3005";
const token = process.env.SMOKE_AUTH_TOKEN || "";
const suffix = Date.now().toString(36);
let cookie = process.env.SMOKE_COOKIE || "";

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

if (!token && !cookie) {
  const user = {
    email: `combo-smoke-${suffix}@example.com`,
    password: "combo-smoke-password-12345",
  };
  const reg = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user),
  });
  const regBody = await reg.json().catch(() => ({}));
  assert(reg.ok, `register failed ${reg.status}: ${JSON.stringify(regBody)}`);
  const rawCookie = reg.headers.get("set-cookie") || "";
  cookie = rawCookie.split(";")[0];
  assert(cookie.includes("inspiration_session="), "missing inspiration_session cookie");
}

const cardId = `smoke_combo_${suffix}`;

const create = await request("/api/db/combo-cards", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    id: cardId,
    weekId: "2026-W27",
    dayIndex: 0,
    title: "Smoke Combo",
    terms: ["组合测试"],
  }),
});

assert.equal(create.res.status, 200, JSON.stringify(create.body));
assert.equal(create.body.card.type, "combo");

const detail = await request(`/api/db/cards/${encodeURIComponent(cardId)}/combo`);
assert.equal(detail.res.status, 200, JSON.stringify(detail.body));
assert.equal(detail.body.card.id, cardId);
assert.deepEqual(detail.body.images, []);
assert.deepEqual(detail.body.generations, []);

const list = await request("/api/db/cards?weekId=all&page=1&pageSize=20&q=组合测试");
assert.equal(list.res.status, 200, JSON.stringify(list.body));
assert((list.body.cards || []).some((card) => card.id === cardId && card.type === "combo"));

const del = await request(`/api/db/cards/${encodeURIComponent(cardId)}`, { method: "DELETE" });
assert.equal(del.res.status, 200, JSON.stringify(del.body));

console.log("combo-card smoke passed");
