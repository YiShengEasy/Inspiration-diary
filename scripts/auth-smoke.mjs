const baseUrl = process.env.AUTH_SMOKE_BASE_URL || "http://localhost:3005";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const term = `smoke-auth-${suffix}`;
const userA = { email: `auth-a-${suffix}@example.com`, password: "password-a-12345" };
const userB = { email: `auth-b-${suffix}@example.com`, password: "password-b-12345" };

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function cookieFrom(res, label) {
  const raw = res.headers.get("set-cookie") || "";
  const cookie = raw.split(";")[0];
  assert(cookie.includes("inspiration_session="), `missing session cookie for ${label}`);
  return cookie;
}

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options);
}

async function json(res) {
  return res.json().catch(() => ({}));
}

const unauth = await request("/api/db/cards?weekId=all&page=1&pageSize=1");
assert(unauth.status === 401, `expected unauth cards 401, got ${unauth.status}`);

const regA = await request("/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(userA),
});
assert(regA.ok, `register A failed ${regA.status}: ${JSON.stringify(await json(regA))}`);
const cookieA = cookieFrom(regA, "user A");

const regB = await request("/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(userB),
});
assert(regB.ok, `register B failed ${regB.status}: ${JSON.stringify(await json(regB))}`);
const cookieB = cookieFrom(regB, "user B");

const cardId = `smoke_${suffix}`;
const photoUid = `photo_${suffix}`;
const photoHash = `hash_${suffix}`;
const saveA = await request("/api/db/cards", {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieA },
  body: JSON.stringify({
    id: cardId,
    weekId: "2026-W25",
    dayIndex: 1,
    imageUrl: "/fake-full.jpg",
    thumbnailUrl: "/fake-thumb.jpg",
    photoUid,
    photoHash,
    terms: [term],
    decoType: "tape",
    angle: 0,
    createdAt: Date.now(),
  }),
});
assert(saveA.ok, `save A card failed ${saveA.status}: ${JSON.stringify(await json(saveA))}`);

const listA = await request(`/api/db/cards?weekId=all&page=1&pageSize=10&q=${encodeURIComponent(term)}`, {
  headers: { Cookie: cookieA },
});
const bodyA = await json(listA);
assert(listA.ok, `list A failed ${listA.status}: ${JSON.stringify(bodyA)}`);
assert(bodyA.total === 1, `expected A total 1, got ${bodyA.total}`);

const listB = await request(`/api/db/cards?weekId=all&page=1&pageSize=10&q=${encodeURIComponent(term)}`, {
  headers: { Cookie: cookieB },
});
const bodyB = await json(listB);
assert(listB.ok, `list B failed ${listB.status}: ${JSON.stringify(bodyB)}`);
assert(bodyB.total === 0, `expected B total 0, got ${bodyB.total}`);

const deleteB = await request(`/api/db/cards/${encodeURIComponent(cardId)}`, {
  method: "DELETE",
  headers: { Cookie: cookieB },
});
assert(deleteB.status === 404, `expected B delete 404, got ${deleteB.status}`);

const logoutA = await request("/api/auth/logout", {
  method: "POST",
  headers: { Cookie: cookieA },
});
assert(logoutA.ok, `logout A failed ${logoutA.status}: ${JSON.stringify(await json(logoutA))}`);

const afterLogout = await request("/api/db/cards?weekId=all&page=1&pageSize=1", {
  headers: { Cookie: cookieA },
});
assert(afterLogout.status === 401, `expected after logout 401, got ${afterLogout.status}`);

console.log("auth smoke passed");
