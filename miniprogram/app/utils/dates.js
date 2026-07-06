function currentWeekId() {
  return weekIdFromDate(new Date());
}

function padWeek(week) {
  return String(week).padStart(2, "0");
}

function isoWeeksInYear(year) {
  const decTwentyEight = new Date(Date.UTC(year, 11, 28));
  return Number(weekIdFromDate(decTwentyEight).split("-W")[1]);
}

function weekIdFromDate(date) {
  const normalized = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = normalized.getUTCDay() || 7;
  normalized.setUTCDate(normalized.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(normalized.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((normalized - yearStart) / 86400000) + 1) / 7);

  return `${normalized.getUTCFullYear()}-W${padWeek(week)}`;
}

function shiftWeekId(weekId, offset) {
  const match = String(weekId || "").match(/^(\d{4})-W(\d{1,2})$/);
  if (!match) return currentWeekId();

  let year = Number(match[1]);
  let week = Number(match[2]) + Number(offset || 0);

  while (week < 1) {
    year -= 1;
    week += isoWeeksInYear(year);
  }

  while (week > isoWeeksInYear(year)) {
    week -= isoWeeksInYear(year);
    year += 1;
  }

  return `${year}-W${padWeek(week)}`;
}

const days = ["周一", "周二", "周三", "周四", "周五", "周末"];

module.exports = { currentWeekId, shiftWeekId, days };
