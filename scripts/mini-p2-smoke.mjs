import assert from "node:assert/strict";
import { createSmokeInvite } from "./smoke-invite.mjs";

const baseUrl = process.env.MINI_P2_SMOKE_BASE_URL || "http://localhost:3000";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const user = { email: `mini-p2-${suffix}@example.com`, password: "mini-p2-password-12345" };
const weekId = "2026-W29";
const cardIds = [];
let cookie = "";

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {}),
    },
  });
}

try {
  const inviteCode = await createSmokeInvite(baseUrl);
  const register = await request("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...user, inviteCode }),
  });
  const registerText = await register.text();
  assert.equal(register.status, 200, registerText);
  cookie = (register.headers.get("set-cookie") || "").split(";")[0];

  for (let index = 0; index < 25; index += 1) {
    const id = `mini_p2_${suffix}_${index}`;
    cardIds.push(id);
    const save = await request("/api/db/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        weekId,
        dayIndex: index % 2,
        imageUrl: `/fake-${index}.jpg`,
        thumbnailUrl: `/fake-${index}-thumb.jpg`,
        terms: [`term-${index}`],
        decoType: "tape",
        angle: 0,
        createdAt: Date.now() + index,
        type: index % 5 === 0 ? "md" : "image",
        mdContent: index % 5 === 0 ? `markdown ${index}` : "",
      }),
    });
    assert.equal(save.status, 200, await save.text());
  }

  const summaryRes = await request(`/api/db/weeks/${weekId}/summary`);
  const summaryText = await summaryRes.text();
  assert.equal(summaryRes.status, 200, summaryText);
  const summary = JSON.parse(summaryText);
  assert.equal(summary.totalCards, 25);
  assert.equal(summary.mdCount, 5);
  assert.equal(summary.totalTerms, 25);
  assert.equal(summary.days[0].count, 13);
  assert.equal(summary.days[1].count, 12);
  assert(summary.days.every((day) => day.previews.length <= 3));

  const pageOneRes = await request(`/api/db/cards?weekId=${weekId}&dayIndex=0&page=1&pageSize=10`);
  const pageOne = await pageOneRes.json();
  assert.equal(pageOneRes.status, 200);
  assert.equal(pageOne.cards.length, 10);
  assert.equal(pageOne.total, 13);
  assert.equal(pageOne.totalPages, 2);
  assert(pageOne.cards.every((card) => card.dayIndex === 0));

  const pageTwoRes = await request(`/api/db/cards?weekId=${weekId}&dayIndex=0&page=2&pageSize=10`);
  const pageTwo = await pageTwoRes.json();
  assert.equal(pageTwoRes.status, 200);
  assert.equal(pageTwo.cards.length, 3);
  console.log("Mini P2 smoke passed");
} finally {
  await Promise.all(cardIds.map((id) => request(`/api/db/cards/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined)));
}
