import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { useState } from "react";

import type { Result } from "@repo/result";

import type {
  LeaveFailure,
  SpaceFailure,
  SpaceSubscription,
  SpaceWithStorage,
} from "../domain/space.ts";

type ReadSpace = (space: {
  readonly spaceId: string;
}) => Promise<Result<SpaceWithStorage, SpaceFailure>>;

type LeaveSpace = (space: { readonly spaceId: string }) => Promise<Result<undefined, LeaveFailure>>;

const LEAVE_UNAVAILABLE = "Le départ est indisponible pour le moment.";

const LEAVE_MESSAGES: Readonly<Record<Exclude<LeaveFailure, "unauthenticated">, string>> = {
  last_owner:
    "Vous êtes le dernier propriétaire de l'espace : nommez un autre propriétaire avant de partir.",
  not_found: "Cet espace est introuvable.",
  unavailable: LEAVE_UNAVAILABLE,
  invalid_response: LEAVE_UNAVAILABLE,
};

const AFTER_END =
  "L'espace reste au plan Team jusque-là, puis les autres propriétaires devront souscrire à nouveau.";

const endOf = (currentPeriodEnd: Date | undefined) =>
  currentPeriodEnd === undefined
    ? "à la fin de la période payée"
    : `le ${currentPeriodEnd.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}`;

const PayerWarning = ({
  subscription,
}: {
  readonly subscription: SpaceSubscription | undefined;
}) => {
  if (subscription === undefined || !subscription.payer.you || subscription.status === "ended") {
    return null;
  }
  const end = endOf(subscription.currentPeriodEnd);
  return subscription.status === "canceling" ? (
    <p>
      Vous payez l'abonnement Team de cet espace, déjà résilié : il prend fin {end}. {AFTER_END}
    </p>
  ) : (
    <p>
      Vous payez l'abonnement Team de cet espace : en partant, il sera résilié et prendra fin {end}.{" "}
      {AFTER_END}
    </p>
  );
};

const LeaveConfirmation = ({
  space,
  leaveSpace,
  onCancel,
}: {
  readonly space: SpaceWithStorage;
  readonly leaveSpace: LeaveSpace;
  readonly onCancel: () => void;
}) => {
  const queryClient = useQueryClient();
  const { data, isPending, mutate } = useMutation({
    mutationFn: leaveSpace,
    onSuccess: async (result) => {
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: ["my-spaces"] });
      }
    },
  });
  if (data?.ok === true) {
    return <Navigate to="/" />;
  }
  const failure = !isPending && data?.ok === false ? data.error : undefined;
  if (failure === "unauthenticated") {
    return <Navigate to="/connexion" />;
  }
  return (
    <section aria-labelledby="quitter-espace">
      <h3 id="quitter-espace">Quitter l'espace</h3>
      <p>Quitter l'espace « {space.name} » ?</p>
      <PayerWarning subscription={space.subscription} />
      <button type="button" disabled={isPending} onClick={() => mutate({ spaceId: space.id })}>
        Confirmer le départ
      </button>
      <button type="button" onClick={onCancel}>
        Annuler
      </button>
      {failure !== undefined && <p role="alert">{LEAVE_MESSAGES[failure]}</p>}
    </section>
  );
};

export const leaveSpaceAction = ({
  readSpace,
  leaveSpace,
}: {
  readonly readSpace: ReadSpace;
  readonly leaveSpace: LeaveSpace;
}) =>
  function LeaveSpaceAction({ spaceId }: { readonly spaceId: string }) {
    const [confirming, setConfirming] = useState(false);
    const { data: space } = useQuery({
      queryKey: ["space", spaceId],
      queryFn: () => readSpace({ spaceId }),
    });
    if (space?.ok !== true || !space.value.allowedActions.includes("member.leave")) {
      return null;
    }
    return confirming ? (
      <LeaveConfirmation
        space={space.value}
        leaveSpace={leaveSpace}
        onCancel={() => setConfirming(false)}
      />
    ) : (
      <button type="button" onClick={() => setConfirming(true)}>
        Quitter l'espace
      </button>
    );
  };
