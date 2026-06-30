const { request } = require("./api");

const SMART_BOOK_SUGGEST_IMAGES_KEY = "smart_book_suggest_images";
const SMART_BOOK_SUGGEST_MARKDOWN_KEY = "smart_book_suggest_markdown";

function toBool(value) {
  return value === true || value === "true";
}

async function loadSmartSettings() {
  const settings = await request({ url: "/api/db/settings" });
  return {
    images: toBool(settings[SMART_BOOK_SUGGEST_IMAGES_KEY]),
    markdown: toBool(settings[SMART_BOOK_SUGGEST_MARKDOWN_KEY])
  };
}

async function saveSmartSetting(key, value) {
  await request({
    url: "/api/db/settings",
    method: "POST",
    data: { [key]: String(Boolean(value)) }
  });
}

module.exports = {
  SMART_BOOK_SUGGEST_IMAGES_KEY,
  SMART_BOOK_SUGGEST_MARKDOWN_KEY,
  loadSmartSettings,
  saveSmartSetting
};
