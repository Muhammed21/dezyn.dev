import { describe, expect, it } from "vitest";

import {
  figmaSurveyAgeOf,
  type ListedProject,
  type ProjectDetails,
  recentPurgeOf,
} from "../project.ts";

const PURGED_AT = new Date("2026-11-10T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

const after = (milliseconds: number) => new Date(PURGED_AT.getTime() + milliseconds);

const makeListedProject = (overrides: Partial<ListedProject> = {}): ListedProject => ({
  id: "0b6f3c2a-8d4e-4f1a-9c7b-5e2d1a0f9b8c",
  spaceId: "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b",
  name: "Site vitrine",
  createdAt: new Date("2026-09-01T12:00:00.000Z"),
  historyPurgedAt: undefined,
  figmaFile: undefined,
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

const SURVEYED_AT = new Date("2026-11-02T09:00:00.000Z");

const afterSurvey = (milliseconds: number) => new Date(SURVEYED_AT.getTime() + milliseconds);

const makeProjectDetails = (overrides: Partial<ProjectDetails> = {}): ProjectDetails => ({
  ...makeListedProject(),
  lastFigmaSurveyAt: undefined,
  ...overrides,
});

const SURVEYED = { lastFigmaSurveyAt: SURVEYED_AT };

describe("âge du dernier relevé Figma, mis en avant au-delà de 14 jours (ADR 0059 §6)", () => {
  it("n'a pas d'âge pour un projet jamais relevé", () => {
    expect(figmaSurveyAgeOf({ project: makeProjectDetails(), now: SURVEYED_AT })).toBeUndefined();
  });

  it.each([
    ["au moment du relevé", 0, 0],
    ["une milliseconde avant le lendemain", DAY_MS - 1, 0],
    ["le lendemain", DAY_MS, 1],
    ["à 14 jours tout juste", 14 * DAY_MS, 14],
    ["une milliseconde avant le 15e jour", 15 * DAY_MS - 1, 14],
  ])("compte les jours entiers écoulés, sans mise en avant, %s", (_moment, elapsed, days) => {
    const project = makeProjectDetails(SURVEYED);

    expect(figmaSurveyAgeOf({ project, now: afterSurvey(elapsed) })).toEqual({
      days,
      stale: false,
    });
  });

  it("met en avant un relevé de 15 jours", () => {
    const project = makeProjectDetails(SURVEYED);

    expect(figmaSurveyAgeOf({ project, now: afterSurvey(15 * DAY_MS) })).toEqual({
      days: 15,
      stale: true,
    });
  });

  it("dit aujourd'hui quand l'horloge du navigateur retarde sur celle de l'API", () => {
    const project = makeProjectDetails(SURVEYED);

    expect(figmaSurveyAgeOf({ project, now: afterSurvey(-DAY_MS / 2) })).toEqual({
      days: 0,
      stale: false,
    });
  });
});
