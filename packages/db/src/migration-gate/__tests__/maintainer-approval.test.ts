import { describe, expect, it } from "vitest";

import { type LabelEvent, labelEvents, maintainerApprover } from "../maintainer-approval.ts";

const MAINTAINER = "mainteneur";

const makeLabelEvent = (overrides: Partial<LabelEvent> = {}): LabelEvent => ({
  id: 1,
  event: "labeled",
  label: "review:needs-approval",
  actor: "github-actions[bot]",
  actorType: "Bot",
  viaApp: false,
  ...overrides,
});

const GATE_POSE = makeLabelEvent({ id: 1 });
const removalBy = (actor: string, overrides: Partial<LabelEvent> = {}): LabelEvent =>
  makeLabelEvent({ id: 2, event: "unlabeled", actor, actorType: "User", ...overrides });

const rolesOf =
  (roles: Readonly<Record<string, string>>) =>
  (login: string): string =>
    roles[login] ?? "none";

const MAINTAINER_ROLES = rolesOf({ [MAINTAINER]: "admin" });

describe("maintainerApprover", () => {
  it.each(["admin", "maintain"])(
    "reconnaît le retrait du label par un utilisateur au rôle %s",
    (role) => {
      expect(
        maintainerApprover({
          events: [GATE_POSE, removalBy(MAINTAINER)],
          roleOf: rolesOf({ [MAINTAINER]: role }),
        }),
      ).toBe(MAINTAINER);
    },
  );

  it.each(["write", "triage", "read", "none"])(
    "refuse le retrait du label par un utilisateur au rôle %s",
    (role) => {
      expect(
        maintainerApprover({
          events: [GATE_POSE, removalBy("contributeur")],
          roleOf: rolesOf({ contributeur: role }),
        }),
      ).toBeUndefined();
    },
  );

  it("refuse le retrait du label par un bot, même d'un rôle admin", () => {
    expect(
      maintainerApprover({
        events: [GATE_POSE, removalBy("github-actions[bot]", { actorType: "Bot" })],
        roleOf: rolesOf({ "github-actions[bot]": "admin" }),
      }),
    ).toBeUndefined();
  });

  it("refuse le retrait fait par une application au nom du mainteneur", () => {
    expect(
      maintainerApprover({
        events: [GATE_POSE, removalBy(MAINTAINER, { viaApp: true })],
        roleOf: MAINTAINER_ROLES,
      }),
    ).toBeUndefined();
  });

  it("ne voit aucune approbation sans retrait du label", () => {
    expect(maintainerApprover({ events: [GATE_POSE], roleOf: MAINTAINER_ROLES })).toBeUndefined();
    expect(maintainerApprover({ events: [], roleOf: MAINTAINER_ROLES })).toBeUndefined();
  });

  it("annule l'approbation du mainteneur quand un bot repose puis retire le label", () => {
    const events = [
      GATE_POSE,
      removalBy(MAINTAINER),
      makeLabelEvent({ id: 3 }),
      makeLabelEvent({ id: 4, event: "unlabeled" }),
    ];

    expect(maintainerApprover({ events, roleOf: MAINTAINER_ROLES })).toBeUndefined();
  });

  it("annule l'approbation quand le label est reposé après son retrait", () => {
    const events = [GATE_POSE, removalBy(MAINTAINER), makeLabelEvent({ id: 3 })];

    expect(maintainerApprover({ events, roleOf: MAINTAINER_ROLES })).toBeUndefined();
  });

  it("annule l'approbation quand le mainteneur repose lui-même le label", () => {
    const events = [
      GATE_POSE,
      removalBy(MAINTAINER),
      makeLabelEvent({ id: 3, actor: MAINTAINER, actorType: "User" }),
    ];

    expect(maintainerApprover({ events, roleOf: MAINTAINER_ROLES })).toBeUndefined();
  });

  it("ignore les événements des autres labels", () => {
    const events = [
      GATE_POSE,
      removalBy(MAINTAINER),
      makeLabelEvent({ id: 3, label: "review:critical" }),
      makeLabelEvent({ id: 4, event: "unlabeled", label: "review:standard" }),
    ];

    expect(maintainerApprover({ events, roleOf: MAINTAINER_ROLES })).toBe(MAINTAINER);
  });

  it("ignore les événements qui ne posent ni ne retirent un label", () => {
    const events = [
      GATE_POSE,
      removalBy(MAINTAINER),
      makeLabelEvent({ id: 3, event: "assigned", actor: "contributeur", actorType: "User" }),
    ];

    expect(maintainerApprover({ events, roleOf: MAINTAINER_ROLES })).toBe(MAINTAINER);
  });

  it("range les événements par identifiant, pas par leur ordre de lecture", () => {
    const events = [removalBy(MAINTAINER, { id: 2 }), makeLabelEvent({ id: 3 }), GATE_POSE];

    expect(maintainerApprover({ events, roleOf: MAINTAINER_ROLES })).toBeUndefined();
    expect(
      maintainerApprover({
        events: [removalBy(MAINTAINER, { id: 3 }), makeLabelEvent({ id: 2 })],
        roleOf: MAINTAINER_ROLES,
      }),
    ).toBe(MAINTAINER);
  });
});

describe("labelEvents", () => {
  it("lit les événements de label sortis en TSV par l'API des événements du ticket", () => {
    const tsv = [
      "11\tlabeled\treview:needs-approval\tgithub-actions[bot]\tBot\tfalse",
      "12\tunlabeled\treview:needs-approval\tmainteneur\tUser\ttrue",
      "",
    ].join("\n");

    expect(labelEvents(tsv)).toEqual([
      makeLabelEvent({ id: 11 }),
      makeLabelEvent({
        id: 12,
        event: "unlabeled",
        actor: "mainteneur",
        actorType: "User",
        viaApp: true,
      }),
    ]);
  });

  it.each([
    ["l'identifiant n'est pas un entier", "12a\tunlabeled\treview:needs-approval\tm\tUser\tfalse"],
    [
      "l'identifiant ne commence pas par un chiffre",
      "a12\tunlabeled\treview:needs-approval\tm\tUser\tfalse",
    ],
    ["le dernier champ manque", "12\tunlabeled\treview:needs-approval\tm\tUser"],
    [
      "le dernier champ n'est pas un booléen",
      "12\tunlabeled\treview:needs-approval\tm\tUser\tnull",
    ],
    ["un champ de trop suit", "12\tunlabeled\treview:needs-approval\tm\tUser\tfalse\tx"],
  ])("écarte une ligne dont %s", (_reason, line) => {
    expect(labelEvents(line)).toEqual([]);
  });
});
