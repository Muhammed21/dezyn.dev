import { describe, expect, it } from "vitest";

import { type ListedProject, recentPurgeOf } from "../project.ts";

const PURGED_AT = new Date("2026-11-10T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const after = (milliseconds: number) => new Date(PURGED_AT.getTime() + milliseconds);

const makeListedProject = (overrides: Partial<ListedProject> = {}): ListedProject => ({
  id: "0b6f3c2a-8d4e-4f1a-9c7b-5e2d1a0f9b8c",
  spaceId: "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
  name: "Site vitrine",
  createdAt: new Date("2026-09-01T12:00:00.000Z"),
  historyPurgedAt: undefined,
  ...overrides,
});

describe("purge récente d'un projet, montrée 7 jours (ADR 0042 §6)", () => {
  it("n'a pas de purge récente quand le projet n'a jamais été purgé", () => {
    expect(recentPurgeOf({ project: makeListedProject(), now: PURGED_AT })).toBeUndefined();
  });

  it.each([
    ["au moment de la purge", 0],
    ["le lendemain", DAY_MS],
    ["une milliseconde avant les 7 jours", 7 * DAY_MS - 1],
  ])("donne la date de la purge %s", (_moment, elapsed) => {
    const project = makeListedProject({ historyPurgedAt: PURGED_AT });

    expect(recentPurgeOf({ project, now: after(elapsed) })).toEqual(PURGED_AT);
  });

  it.each([
    ["à 7 jours tout juste", 7 * DAY_MS],
    ["au-delà de 7 jours", 30 * DAY_MS],
  ])("n'a plus de purge récente %s", (_moment, elapsed) => {
    const project = makeListedProject({ historyPurgedAt: PURGED_AT });

    expect(recentPurgeOf({ project, now: after(elapsed) })).toBeUndefined();
  });

  it("garde la purge récente quand l'horloge du navigateur retarde sur celle de l'API", () => {
    const project = makeListedProject({ historyPurgedAt: PURGED_AT });

    expect(recentPurgeOf({ project, now: after(-DAY_MS) })).toEqual(PURGED_AT);
  });
});
