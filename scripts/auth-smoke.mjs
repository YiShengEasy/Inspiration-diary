const baseUrl = process.env.AUTH_SMOKE_BASE_URL || "http://localhost:3005";
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const term = `smoke-auth-${suffix}`;
const insightNote = `smoke-insight-${suffix}`;
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

const unauthFavorite = await request("/api/db/cards/missing/favorite", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ favorite: true }),
});
assert(unauthFavorite.status === 401, `expected unauth favorite 401, got ${unauthFavorite.status}`);

const regA = await request("/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(userA),
});
assert(regA.ok, `register A failed ${regA.status}: ${JSON.stringify(await json(regA))}`);
const cookieA = cookieFrom(regA, "user A");

const loginAByIdentifier = await request("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: userA.email, password: userA.password }),
});
assert(loginAByIdentifier.ok, `login A with identifier failed ${loginAByIdentifier.status}: ${JSON.stringify(await json(loginAByIdentifier))}`);
cookieFrom(loginAByIdentifier, "user A identifier login");

const regB = await request("/api/auth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(userB),
});
assert(regB.ok, `register B failed ${regB.status}: ${JSON.stringify(await json(regB))}`);
const cookieB = cookieFrom(regB, "user B");

const loginBByEmail = await request("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: userB.email, password: userB.password }),
});
assert(loginBByEmail.ok, `login B with email failed ${loginBByEmail.status}: ${JSON.stringify(await json(loginBByEmail))}`);
cookieFrom(loginBByEmail, "user B email login");

const cardId = `smoke_${suffix}`;
const cardId2 = `smoke_cover_${suffix}`;
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

const updateInsightA = await request(`/api/db/cards/${encodeURIComponent(cardId)}/insight-note`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookieA },
  body: JSON.stringify({ insightNote }),
});
assert(updateInsightA.ok, `update A insight failed ${updateInsightA.status}: ${JSON.stringify(await json(updateInsightA))}`);

const updateInsightB = await request(`/api/db/cards/${encodeURIComponent(cardId)}/insight-note`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookieB },
  body: JSON.stringify({ insightNote: "should-not-write" }),
});
assert(updateInsightB.status === 404, `expected B update A insight 404, got ${updateInsightB.status}`);

const saveA2 = await request("/api/db/cards", {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieA },
  body: JSON.stringify({
    id: cardId2,
    weekId: "2026-W25",
    dayIndex: 2,
    imageUrl: "/fake-cover-full.jpg",
    thumbnailUrl: "/fake-cover-thumb.jpg",
    photoUid: `${photoUid}_cover`,
    photoHash: `${photoHash}_cover`,
    terms: [`smoke-cover-only-${suffix}`],
    decoType: "pin",
    angle: 0,
    createdAt: Date.now() + 1,
  }),
});
assert(saveA2.ok, `save A cover card failed ${saveA2.status}: ${JSON.stringify(await json(saveA2))}`);

const listA = await request(`/api/db/cards?weekId=all&page=1&pageSize=10&q=${encodeURIComponent(term)}`, {
  headers: { Cookie: cookieA },
});
const bodyA = await json(listA);
assert(listA.ok, `list A failed ${listA.status}: ${JSON.stringify(bodyA)}`);
assert(bodyA.total === 1, `expected A total 1, got ${bodyA.total}`);
assert(bodyA.cards?.[0]?.insightNote === insightNote, `expected A insight note to roundtrip, got ${bodyA.cards?.[0]?.insightNote}`);

const insightSearchA = await request(`/api/db/cards?weekId=all&page=1&pageSize=10&q=${encodeURIComponent(insightNote)}`, {
  headers: { Cookie: cookieA },
});
const insightSearchBodyA = await json(insightSearchA);
assert(insightSearchA.ok, `A insight search failed ${insightSearchA.status}: ${JSON.stringify(insightSearchBodyA)}`);
assert(insightSearchBodyA.total === 1, `expected A insight search total 1, got ${insightSearchBodyA.total}`);

const invalidFavoriteA = await request(`/api/db/cards/${encodeURIComponent(cardId)}/favorite`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookieA },
  body: JSON.stringify({ favorite: "yes" }),
});
assert(invalidFavoriteA.status === 400, `expected invalid favorite 400, got ${invalidFavoriteA.status}`);

const favoriteByB = await request(`/api/db/cards/${encodeURIComponent(cardId)}/favorite`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookieB },
  body: JSON.stringify({ favorite: true }),
});
assert(favoriteByB.status === 404, `expected B favorite A card 404, got ${favoriteByB.status}`);

const favoriteA = await request(`/api/db/cards/${encodeURIComponent(cardId)}/favorite`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookieA },
  body: JSON.stringify({ favorite: true }),
});
const favoriteBodyA = await json(favoriteA);
assert(favoriteA.ok, `favorite A card failed ${favoriteA.status}: ${JSON.stringify(favoriteBodyA)}`);
assert(favoriteBodyA.id === cardId, `expected favorite response id ${cardId}, got ${favoriteBodyA.id}`);
assert(favoriteBodyA.isFavorite === true, "expected favorite response isFavorite true");
assert(typeof favoriteBodyA.favoritedAt === "number", `expected numeric favoritedAt, got ${favoriteBodyA.favoritedAt}`);

const favoriteSearchA = await request(`/api/db/cards?weekId=all&page=1&pageSize=10&favorite=true&q=${encodeURIComponent(term)}`, {
  headers: { Cookie: cookieA },
});
const favoriteSearchBodyA = await json(favoriteSearchA);
assert(favoriteSearchA.ok, `A favorite search failed ${favoriteSearchA.status}: ${JSON.stringify(favoriteSearchBodyA)}`);
assert(favoriteSearchBodyA.total === 1, `expected A favorite search total 1, got ${favoriteSearchBodyA.total}`);
assert(favoriteSearchBodyA.cards?.[0]?.isFavorite === true, "expected favorite search card to be marked favorite");

const favoriteCurrentWeekA = await request(`/api/db/cards?weekId=2026-W25&favorite=true&q=${encodeURIComponent(term)}`, {
  headers: { Cookie: cookieA },
});
const favoriteCurrentWeekBodyA = await json(favoriteCurrentWeekA);
assert(favoriteCurrentWeekA.ok, `A current week favorite search failed ${favoriteCurrentWeekA.status}: ${JSON.stringify(favoriteCurrentWeekBodyA)}`);
assert(favoriteCurrentWeekBodyA.total === 1, `expected current week favorite total 1, got ${favoriteCurrentWeekBodyA.total}`);
assert(favoriteCurrentWeekBodyA.cards?.length === 1, `expected current week favorite length 1, got ${favoriteCurrentWeekBodyA.cards?.length}`);
assert(favoriteCurrentWeekBodyA.cards?.[0]?.id === cardId, `expected current week favorite card ${cardId}, got ${favoriteCurrentWeekBodyA.cards?.[0]?.id}`);

const favoriteSearchMissA = await request(`/api/db/cards?weekId=all&page=1&pageSize=10&favorite=true&q=${encodeURIComponent(`smoke-cover-only-${suffix}`)}`, {
  headers: { Cookie: cookieA },
});
const favoriteSearchMissBodyA = await json(favoriteSearchMissA);
assert(favoriteSearchMissA.ok, `A favorite miss search failed ${favoriteSearchMissA.status}: ${JSON.stringify(favoriteSearchMissBodyA)}`);
assert(favoriteSearchMissBodyA.total === 0, `expected A favorite miss total 0, got ${favoriteSearchMissBodyA.total}`);

const listB = await request(`/api/db/cards?weekId=all&page=1&pageSize=10&q=${encodeURIComponent(term)}`, {
  headers: { Cookie: cookieB },
});
const bodyB = await json(listB);
assert(listB.ok, `list B failed ${listB.status}: ${JSON.stringify(bodyB)}`);
assert(bodyB.total === 0, `expected B total 0, got ${bodyB.total}`);

const favoriteSearchB = await request(`/api/db/cards?weekId=all&page=1&pageSize=10&favorite=true&q=${encodeURIComponent(term)}`, {
  headers: { Cookie: cookieB },
});
const favoriteSearchBodyB = await json(favoriteSearchB);
assert(favoriteSearchB.ok, `B favorite search failed ${favoriteSearchB.status}: ${JSON.stringify(favoriteSearchBodyB)}`);
assert(favoriteSearchBodyB.total === 0, `expected B favorite search total 0, got ${favoriteSearchBodyB.total}`);

const unfavoriteA = await request(`/api/db/cards/${encodeURIComponent(cardId)}/favorite`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookieA },
  body: JSON.stringify({ favorite: false }),
});
const unfavoriteBodyA = await json(unfavoriteA);
assert(unfavoriteA.ok, `unfavorite A card failed ${unfavoriteA.status}: ${JSON.stringify(unfavoriteBodyA)}`);
assert(unfavoriteBodyA.isFavorite === false, "expected unfavorite response isFavorite false");
assert(unfavoriteBodyA.favoritedAt === null, `expected null favoritedAt after unfavorite, got ${unfavoriteBodyA.favoritedAt}`);

const favoriteAfterUnfavoriteA = await request(`/api/db/cards?weekId=all&page=1&pageSize=10&favorite=true&q=${encodeURIComponent(term)}`, {
  headers: { Cookie: cookieA },
});
const favoriteAfterUnfavoriteBodyA = await json(favoriteAfterUnfavoriteA);
assert(favoriteAfterUnfavoriteA.ok, `A favorite after unfavorite failed ${favoriteAfterUnfavoriteA.status}: ${JSON.stringify(favoriteAfterUnfavoriteBodyA)}`);
assert(favoriteAfterUnfavoriteBodyA.total === 0, `expected favorite total 0 after unfavorite, got ${favoriteAfterUnfavoriteBodyA.total}`);

const regularAfterUnfavoriteA = await request(`/api/db/cards?weekId=all&page=1&pageSize=10&q=${encodeURIComponent(term)}`, {
  headers: { Cookie: cookieA },
});
const regularAfterUnfavoriteBodyA = await json(regularAfterUnfavoriteA);
assert(regularAfterUnfavoriteA.ok, `A regular after unfavorite failed ${regularAfterUnfavoriteA.status}: ${JSON.stringify(regularAfterUnfavoriteBodyA)}`);
assert(regularAfterUnfavoriteBodyA.total === 1, `expected regular total 1 after unfavorite, got ${regularAfterUnfavoriteBodyA.total}`);
assert(regularAfterUnfavoriteBodyA.cards?.[0]?.isFavorite === false, "expected regular card to remain visible and not favorite after unfavorite");

const unauthBooks = await request("/api/db/books");
assert(unauthBooks.status === 401, `expected unauth books 401, got ${unauthBooks.status}`);

const createBookA = await request("/api/db/books", {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieA },
  body: JSON.stringify({
    title: `Smoke Book ${suffix}`,
    description: "Auth isolation smoke test book",
  }),
});
const bookA = await json(createBookA);
assert(createBookA.ok, `create A book failed ${createBookA.status}: ${JSON.stringify(bookA)}`);
assert(bookA.id, "created A book missing id");

const addCardToBookA = await request(`/api/db/books/${encodeURIComponent(bookA.id)}/cards`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieA },
  body: JSON.stringify({ cardId }),
});
assert(addCardToBookA.ok, `add A card to book failed ${addCardToBookA.status}: ${JSON.stringify(await json(addCardToBookA))}`);

const booksAfterFirstAddA = await request("/api/db/books", {
  headers: { Cookie: cookieA },
});
const booksAfterFirstAddBodyA = await json(booksAfterFirstAddA);
assert(booksAfterFirstAddA.ok, `list A books after first add failed ${booksAfterFirstAddA.status}: ${JSON.stringify(booksAfterFirstAddBodyA)}`);
const firstBookA = booksAfterFirstAddBodyA.find((book) => book.id === bookA.id);
assert(firstBookA?.coverCard?.id === cardId, `expected first added card as default cover, got ${firstBookA?.coverCard?.id}`);

const addCoverCardToBookA = await request(`/api/db/books/${encodeURIComponent(bookA.id)}/cards`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieA },
  body: JSON.stringify({ cardId: cardId2 }),
});
assert(addCoverCardToBookA.ok, `add A cover card to book failed ${addCoverCardToBookA.status}: ${JSON.stringify(await json(addCoverCardToBookA))}`);

const setCoverA = await request(`/api/db/books/${encodeURIComponent(bookA.id)}/cover`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookieA },
  body: JSON.stringify({ cardId: cardId2 }),
});
assert(setCoverA.ok, `set A book cover failed ${setCoverA.status}: ${JSON.stringify(await json(setCoverA))}`);

const setCoverB = await request(`/api/db/books/${encodeURIComponent(bookA.id)}/cover`, {
  method: "PUT",
  headers: { "Content-Type": "application/json", Cookie: cookieB },
  body: JSON.stringify({ cardId: cardId2 }),
});
assert(setCoverB.status === 404, `expected B set A book cover 404, got ${setCoverB.status}`);

const booksAfterManualCoverA = await request("/api/db/books", {
  headers: { Cookie: cookieA },
});
const booksAfterManualCoverBodyA = await json(booksAfterManualCoverA);
assert(booksAfterManualCoverA.ok, `list A books after cover failed ${booksAfterManualCoverA.status}: ${JSON.stringify(booksAfterManualCoverBodyA)}`);
const coveredBookA = booksAfterManualCoverBodyA.find((book) => book.id === bookA.id);
assert(coveredBookA?.coverCardId === cardId2, `expected manual cover id ${cardId2}, got ${coveredBookA?.coverCardId}`);
assert(coveredBookA?.coverCard?.id === cardId2, `expected manual cover card ${cardId2}, got ${coveredBookA?.coverCard?.id}`);

const bookCardsA = await request(`/api/db/books/${encodeURIComponent(bookA.id)}/cards?page=1&pageSize=5&q=${encodeURIComponent(term)}`, {
  headers: { Cookie: cookieA },
});
const bookCardsBodyA = await json(bookCardsA);
assert(bookCardsA.ok, `list A book cards failed ${bookCardsA.status}: ${JSON.stringify(bookCardsBodyA)}`);
assert(bookCardsBodyA.total === 1, `expected A book cards total 1, got ${bookCardsBodyA.total}`);
assert(bookCardsBodyA.cards?.[0]?.id === cardId, `expected A book card ${cardId}, got ${bookCardsBodyA.cards?.[0]?.id}`);

const membershipA = await request(`/api/db/cards/${encodeURIComponent(cardId)}/books`, {
  headers: { Cookie: cookieA },
});
const membershipBodyA = await json(membershipA);
assert(membershipA.ok, `A membership failed ${membershipA.status}: ${JSON.stringify(membershipBodyA)}`);
assert(
  membershipBodyA.some((book) => book.id === bookA.id && book.containsCard === true),
  "expected A membership to include created book",
);

const booksB = await request("/api/db/books", {
  headers: { Cookie: cookieB },
});
const booksBodyB = await json(booksB);
assert(booksB.ok, `list B books failed ${booksB.status}: ${JSON.stringify(booksBodyB)}`);
assert(Array.isArray(booksBodyB) && booksBodyB.length === 0, `expected B books empty, got ${JSON.stringify(booksBodyB)}`);

const bookCardsB = await request(`/api/db/books/${encodeURIComponent(bookA.id)}/cards?page=1&pageSize=5`, {
  headers: { Cookie: cookieB },
});
assert(bookCardsB.status === 404, `expected B list A book cards 404, got ${bookCardsB.status}`);

const addCardToBookB = await request(`/api/db/books/${encodeURIComponent(bookA.id)}/cards`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieB },
  body: JSON.stringify({ cardId }),
});
assert(addCardToBookB.status === 404, `expected B add A card to A book 404, got ${addCardToBookB.status}`);

const membershipB = await request(`/api/db/cards/${encodeURIComponent(cardId)}/books`, {
  headers: { Cookie: cookieB },
});
assert(membershipB.status === 404, `expected B membership for A card 404, got ${membershipB.status}`);

const removeCoverCardFromBookA = await request(`/api/db/books/${encodeURIComponent(bookA.id)}/cards/${encodeURIComponent(cardId2)}`, {
  method: "DELETE",
  headers: { Cookie: cookieA },
});
assert(removeCoverCardFromBookA.ok, `remove A cover card from book failed ${removeCoverCardFromBookA.status}: ${JSON.stringify(await json(removeCoverCardFromBookA))}`);

const booksAfterCoverRemovalA = await request("/api/db/books", {
  headers: { Cookie: cookieA },
});
const booksAfterCoverRemovalBodyA = await json(booksAfterCoverRemovalA);
assert(booksAfterCoverRemovalA.ok, `list A books after cover removal failed ${booksAfterCoverRemovalA.status}: ${JSON.stringify(booksAfterCoverRemovalBodyA)}`);
const fallbackBookA = booksAfterCoverRemovalBodyA.find((book) => book.id === bookA.id);
assert(fallbackBookA?.coverCard?.id === cardId, `expected fallback cover ${cardId}, got ${fallbackBookA?.coverCard?.id}`);

const removeCardFromBookA = await request(`/api/db/books/${encodeURIComponent(bookA.id)}/cards/${encodeURIComponent(cardId)}`, {
  method: "DELETE",
  headers: { Cookie: cookieA },
});
assert(removeCardFromBookA.ok, `remove A card from book failed ${removeCardFromBookA.status}: ${JSON.stringify(await json(removeCardFromBookA))}`);

const deleteBookA = await request(`/api/db/books/${encodeURIComponent(bookA.id)}`, {
  method: "DELETE",
  headers: { Cookie: cookieA },
});
assert(deleteBookA.ok, `delete A book failed ${deleteBookA.status}: ${JSON.stringify(await json(deleteBookA))}`);

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
