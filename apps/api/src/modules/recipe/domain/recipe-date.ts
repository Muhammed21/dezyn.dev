const MONTH = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });

export const recipeDateOf = (today: Date): string => {
  const day = today.getUTCDate();
  return `${day === 1 ? "1er" : String(day)} ${MONTH.format(today)}`;
};
