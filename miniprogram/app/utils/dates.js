function currentWeekId() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getFullYear(), 0, 1));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const dayOffset = Math.floor((today - start.getTime()) / 86400000);
  const week = Math.ceil((dayOffset + start.getUTCDay() + 1) / 7);

  return `${now.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

const days = ["周一", "周二", "周三", "周四", "周五", "周末"];

module.exports = { currentWeekId, days };
