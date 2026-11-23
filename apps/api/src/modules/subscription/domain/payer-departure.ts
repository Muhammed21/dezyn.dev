import type { SubscriptionStatus } from "./subscription.ts";

export type DepartedSubscription = {
  readonly id: string;
  readonly payerId: string;
  readonly payerName: string;
  readonly status: SubscriptionStatus;
  readonly currentPeriodEnd: Date | undefined;
  readonly spaceId: string;
  readonly spaceName: string;
};

export type PayerDepartureReason = "left" | "demoted" | "account_deleted";

export type PayerDepartureNotice = { readonly subject: string; readonly text: string };

export type PayerDeparture = {
  readonly subscriptionId: string;
  readonly cancel: boolean;
  readonly notice: PayerDepartureNotice;
};

export const CANCELABLE_STATUSES = [
  "active",
  "past_due",
] as const satisfies readonly SubscriptionStatus[];

const CANCELABLE: ReadonlySet<SubscriptionStatus> = new Set(CANCELABLE_STATUSES);

export const isCancelable = (status: SubscriptionStatus) => CANCELABLE.has(status);

const endOf = (currentPeriodEnd: Date | undefined) =>
  currentPeriodEnd === undefined
    ? "à la fin de la période payée"
    : `le ${currentPeriodEnd.toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })}`;

const departureOf = ({
  reason,
  payerName,
  spaceName,
  end,
}: {
  readonly reason: PayerDepartureReason;
  readonly payerName: string;
  readonly spaceName: string;
  readonly end: string;
}) =>
  ({
    left: `${payerName} a quitté l'espace « ${spaceName} ». ${payerName} en payait l'abonnement Team : il est résilié et prend fin ${end}.`,
    demoted: `${payerName} n'est plus propriétaire de l'espace « ${spaceName} ». ${payerName} en payait l'abonnement Team : il est résilié et prend fin ${end}.`,
    account_deleted: `${payerName} a supprimé son compte dezyn. ${payerName} payait l'abonnement Team de l'espace « ${spaceName} » : il est résilié et prend fin ${end}.`,
  })[reason];

const noticeOf = (
  { payerName, spaceId, spaceName, currentPeriodEnd }: DepartedSubscription,
  webUrl: string,
  reason: PayerDepartureReason,
): PayerDepartureNotice => {
  const end = endOf(currentPeriodEnd);
  return {
    subject: `L'abonnement Team de l'espace « ${spaceName} » prend fin ${end}`,
    text: [
      departureOf({ reason, payerName, spaceName, end }),
      "Jusqu'à cette date, l'espace reste au plan Team. Après cette date, souscrivez à nouveau au plan Team pour le garder.",
      `Page « Plan » de l'espace : ${webUrl}/espaces/${spaceId}/plan`,
    ].join("\n\n"),
  };
};

export const payerDepartureOf = ({
  subscription,
  leaverId,
  webUrl,
  reason = "left",
}: {
  readonly subscription: DepartedSubscription | undefined;
  readonly leaverId: string;
  readonly webUrl: string;
  readonly reason?: PayerDepartureReason;
}): PayerDeparture | undefined => {
  if (
    subscription === undefined ||
    subscription.payerId !== leaverId ||
    subscription.status === "ended"
  ) {
    return undefined;
  }
  return {
    subscriptionId: subscription.id,
    cancel: isCancelable(subscription.status),
    notice: noticeOf(subscription, webUrl, reason),
  };
};
