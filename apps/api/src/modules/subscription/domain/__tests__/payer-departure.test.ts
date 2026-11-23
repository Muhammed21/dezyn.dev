import { describe, expect, it } from "vitest";

import { type DepartedSubscription, payerDepartureOf } from "../payer-departure.ts";

const PAYER_ID = "4f2a9c1e-7b3d-4e8a-9f10-2c5d6e7f8a9b";

const OWNER_ID = "7b3d4e8a-9f10-4c5d-8e7f-8a9b4f2a9c1e";

const makeDepartedSubscription = (
  overrides: Partial<DepartedSubscription> = {},
): DepartedSubscription => ({
  id: "polar-subscription-1",
  payerId: PAYER_ID,
  payerName: "Ada Lovelace",
  status: "active",
  currentPeriodEnd: new Date("2026-12-22T10:00:00.000Z"),
  spaceId: "6d1f0c2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f",
  spaceName: "Studio Ada",
  ...overrides,
});

const planUrl = "https://dezyn.dev/espaces/6d1f0c2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f/plan";

describe("le départ du payeur résilie l'abonnement en fin de période (ADR 0050 §3)", () => {
  it.each(["active", "past_due"] as const)(
    "le payeur d'un abonnement %s qui part demande la résiliation et prévient les propriétaires",
    (status) => {
      const departure = payerDepartureOf({
        subscription: makeDepartedSubscription({ status }),
        leaverId: PAYER_ID,
        webUrl: "https://dezyn.dev",
      });

      expect(departure).toMatchObject({
        subscriptionId: "polar-subscription-1",
        cancel: true,
        notice: expect.any(Object),
      });
    },
  );

  it("le payeur d'un abonnement déjà résilié prévient les propriétaires, sans nouvelle demande", () => {
    const departure = payerDepartureOf({
      subscription: makeDepartedSubscription({ status: "canceling" }),
      leaverId: PAYER_ID,
      webUrl: "https://dezyn.dev",
    });

    expect(departure).toMatchObject({ cancel: false, notice: expect.any(Object) });
  });

  it("le payeur d'un abonnement terminé part sans rien demander ni prévenir", () => {
    expect(
      payerDepartureOf({
        subscription: makeDepartedSubscription({ status: "ended" }),
        leaverId: PAYER_ID,
        webUrl: "https://dezyn.dev",
      }),
    ).toBeUndefined();
  });

  it("un propriétaire qui ne paie pas part sans toucher l'abonnement", () => {
    expect(
      payerDepartureOf({
        subscription: makeDepartedSubscription(),
        leaverId: OWNER_ID,
        webUrl: "https://dezyn.dev",
      }),
    ).toBeUndefined();
  });

  it("un départ d'un espace sans abonnement ne demande rien", () => {
    expect(
      payerDepartureOf({
        subscription: undefined,
        leaverId: PAYER_ID,
        webUrl: "https://dezyn.dev",
      }),
    ).toBeUndefined();
  });

  it("l'email nomme le payeur, l'espace, la date de fin et la page « Plan »", () => {
    const departure = payerDepartureOf({
      subscription: makeDepartedSubscription(),
      leaverId: PAYER_ID,
      webUrl: "https://dezyn.dev",
    });

    expect(departure?.notice).toEqual({
      subject: "L'abonnement Team de l'espace « Studio Ada » prend fin le 22 décembre 2026",
      text: [
        "Ada Lovelace a quitté l'espace « Studio Ada ». Ada Lovelace en payait l'abonnement Team : il est résilié et prend fin le 22 décembre 2026.",
        "Jusqu'à cette date, l'espace reste au plan Team. Après cette date, souscrivez à nouveau au plan Team pour le garder.",
        `Page « Plan » de l'espace : ${planUrl}`,
      ].join("\n\n"),
    });
  });

  it("sans date de fin connue, l'email parle de la fin de la période payée", () => {
    const departure = payerDepartureOf({
      subscription: makeDepartedSubscription({ currentPeriodEnd: undefined }),
      leaverId: PAYER_ID,
      webUrl: "https://dezyn.dev",
    });

    expect(departure?.notice).toEqual({
      subject:
        "L'abonnement Team de l'espace « Studio Ada » prend fin à la fin de la période payée",
      text: [
        "Ada Lovelace a quitté l'espace « Studio Ada ». Ada Lovelace en payait l'abonnement Team : il est résilié et prend fin à la fin de la période payée.",
        "Jusqu'à cette date, l'espace reste au plan Team. Après cette date, souscrivez à nouveau au plan Team pour le garder.",
        `Page « Plan » de l'espace : ${planUrl}`,
      ].join("\n\n"),
    });
  });

  it("le payeur qui supprime son compte : l'email dit qu'il a supprimé son compte", () => {
    const departure = payerDepartureOf({
      subscription: makeDepartedSubscription(),
      leaverId: PAYER_ID,
      webUrl: "https://dezyn.dev",
      reason: "account_deleted",
    });

    expect(departure).toEqual({
      subscriptionId: "polar-subscription-1",
      cancel: true,
      notice: {
        subject: "L'abonnement Team de l'espace « Studio Ada » prend fin le 22 décembre 2026",
        text: [
          "Ada Lovelace a supprimé son compte dezyn. Ada Lovelace payait l'abonnement Team de l'espace « Studio Ada » : il est résilié et prend fin le 22 décembre 2026.",
          "Jusqu'à cette date, l'espace reste au plan Team. Après cette date, souscrivez à nouveau au plan Team pour le garder.",
          `Page « Plan » de l'espace : ${planUrl}`,
        ].join("\n\n"),
      },
    });
  });

  it("le payeur rendu éditeur : l'email dit qu'il n'est plus propriétaire de l'espace", () => {
    const departure = payerDepartureOf({
      subscription: makeDepartedSubscription(),
      leaverId: PAYER_ID,
      webUrl: "https://dezyn.dev",
      reason: "demoted",
    });

    expect(departure).toEqual({
      subscriptionId: "polar-subscription-1",
      cancel: true,
      notice: {
        subject: "L'abonnement Team de l'espace « Studio Ada » prend fin le 22 décembre 2026",
        text: [
          "Ada Lovelace n'est plus propriétaire de l'espace « Studio Ada ». Ada Lovelace en payait l'abonnement Team : il est résilié et prend fin le 22 décembre 2026.",
          "Jusqu'à cette date, l'espace reste au plan Team. Après cette date, souscrivez à nouveau au plan Team pour le garder.",
          `Page « Plan » de l'espace : ${planUrl}`,
        ].join("\n\n"),
      },
    });
  });
});
