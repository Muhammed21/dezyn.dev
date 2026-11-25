const DAY_MS = 24 * 60 * 60 * 1000;

const AGO = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

export const daysSince = ({ since, now }: { readonly since: Date; readonly now: Date }): number =>
  Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS));

export const daysAgoText = (days: number): string => AGO.format(-days, "day");
