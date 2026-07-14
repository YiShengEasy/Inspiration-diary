import assert from "node:assert/strict";

export async function createSmokeInvite(baseUrl) {
  const email = process.env.SMOKE_ADMIN_EMAIL || process.env.AUTH_BOOTSTRAP_EMAIL || "local-admin@example.com";
  const password = process.env.SMOKE_ADMIN_PASSWORD || process.env.AUTH_BOOTSTRAP_PASSWORD || "";
  assert(password, "SMOKE_ADMIN_PASSWORD or AUTH_BOOTSTRAP_PASSWORD is required for invite-protected Web registration");

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await login.json().catch(() => ({}));
  assert(login.ok, `admin login failed ${login.status}: ${JSON.stringify(loginBody)}`);
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];

  const created = await fetch(`${baseUrl}/api/admin/invite-codes`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const createdBody = await created.json().catch(() => ({}));
  assert(created.ok, `invite creation failed ${created.status}: ${JSON.stringify(createdBody)}`);
  const code = createdBody.inviteCodes?.[0]?.code;
  assert(code, "invite creation did not return a usable code");
  return code;
}
