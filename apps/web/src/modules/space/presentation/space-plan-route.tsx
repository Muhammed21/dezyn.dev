import { useMutation, useQuery } from "@tanstack/react-query";
import { type AnyRootRoute, createRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import type { Result } from "@repo/result";

import type {
  Checkout,
  CheckoutFailure,
  Plan,
  SpaceFailure,
  SpaceWithStorage,
} from "../domain/space.ts";

type ReadSpace = (space: {
  readonly spaceId: string;
}) => Promise<Result<SpaceWithStorage, SpaceFailure>>;
type StartCheckout = (space: {
  readonly spaceId: string;
}) => Promise<Result<Checkout, CheckoutFailure>>;
type GoTo = (url: string) => void;
type Polling = { readonly intervalMs: number; readonly timeoutMs: number };

const OWNER_ONLY = "Seul un propriétaire de l'espace peut passer au plan Team.";
const UNKNOWN_SPACE = "Cet espace est introuvable.";
const PAYMENT_UNAVAILABLE = "Le paiement est indisponible pour le moment.";
const PLAN_UNAVAILABLE = "Le plan de l'espace est indisponible pour le moment.";

const PLAN_NAMES: Readonly<Record<Plan, string>> = {
  free: "Free",
  team: "Team",
  unknown: "inconnu",
};

const READ_MESSAGES: Readonly<Record<Exclude<SpaceFailure, "unauthenticated">, string>> = {
  not_found: UNKNOWN_SPACE,
  unavailable: PLAN_UNAVAILABLE,
  invalid_response: PLAN_UNAVAILABLE,
};

const CHECKOUT_MESSAGES: Readonly<Record<Exclude<CheckoutFailure, "unauthenticated">, string>> = {
  already_team: "Cet espace est déjà au plan Team.",
  forbidden: OWNER_ONLY,
  not_found: UNKNOWN_SPACE,
  unavailable: PAYMENT_UNAVAILABLE,
  invalid_response: PAYMENT_UNAVAILABLE,
};

const TeamOffer = () => (
  <section aria-labelledby="plan-team">
    <h2 id="plan-team">Plan Team</h2>
    <p>34,99 € HT par mois et par espace, sans engagement.</p>
    <ul aria-label="Ce qu'apporte le plan Team">
      <li>Projets illimités, au lieu de 3</li>
      <li>20 Go de stockage, au lieu de 500 Mo</li>
      <li>Des éditeurs invités dans l'espace, au lieu d'un seul membre</li>
    </ul>
  </section>
);

const UpgradeButton = ({
  spaceId,
  startCheckout,
  goTo,
}: {
  readonly spaceId: string;
  readonly startCheckout: StartCheckout;
  readonly goTo: GoTo;
}) => {
  const { data, isPending, mutate } = useMutation({
    mutationFn: startCheckout,
    onSuccess: (result) => {
      if (result.ok) {
        goTo(result.value.url);
      }
    },
  });
  const failure = !isPending && data?.ok === false ? data.error : undefined;
  if (failure === "unauthenticated") {
    return <Navigate to="/connexion" />;
  }
  return (
    <>
      <button type="button" disabled={isPending} onClick={() => mutate({ spaceId })}>
        Passer au plan Team
      </button>
      {failure !== undefined && <p role="alert">{CHECKOUT_MESSAGES[failure]}</p>}
    </>
  );
};

const useDeadline = (timeoutMs: number) => {
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setPassed(true), timeoutMs);
    return () => clearTimeout(timer);
  }, [timeoutMs]);
  return passed;
};

const CheckoutReturn = ({ plan, expired }: { readonly plan: Plan; readonly expired: boolean }) => {
  if (plan === "team") {
    return <p role="status">Votre espace est passé au plan Team.</p>;
  }
  return expired ? (
    <p role="status">
      Paiement reçu, activation en cours. L'espace passera au plan Team dans quelques minutes.
    </p>
  ) : (
    <p role="status">Paiement reçu, confirmation de l'activation…</p>
  );
};

const SpacePlan = ({
  spaceId,
  returning,
  readSpace,
  startCheckout,
  goTo,
  polling,
}: {
  readonly spaceId: string;
  readonly returning: boolean;
  readonly readSpace: ReadSpace;
  readonly startCheckout: StartCheckout;
  readonly goTo: GoTo;
  readonly polling: Polling;
}) => {
  const expired = useDeadline(polling.timeoutMs);
  const { data } = useQuery({
    queryKey: ["space", spaceId],
    queryFn: () => readSpace({ spaceId }),
    refetchInterval: (query) => {
      const space = query.state.data;
      const team = space?.ok === true && space.value.plan === "team";
      return returning && !expired && !team ? polling.intervalMs : false;
    },
  });
  if (data === undefined) {
    return <p>Chargement du plan…</p>;
  }
  if (!data.ok) {
    return data.error === "unauthenticated" ? (
      <Navigate to="/connexion" />
    ) : (
      <p role="alert">{READ_MESSAGES[data.error]}</p>
    );
  }
  const { plan, allowedActions } = data.value;
  const canUpgrade = plan === "free" && !returning;
  return (
    <main>
      <h1>Plan</h1>
      <p>Plan actuel : {PLAN_NAMES[plan]}</p>
      {returning && <CheckoutReturn plan={plan} expired={expired} />}
      <TeamOffer />
      {canUpgrade && allowedActions.includes("subscription.checkout") && (
        <UpgradeButton spaceId={spaceId} startCheckout={startCheckout} goTo={goTo} />
      )}
      {canUpgrade && !allowedActions.includes("subscription.checkout") && <p>{OWNER_ONLY}</p>}
      <Link to="/espaces/$spaceId" params={{ spaceId }}>
        Retour aux projets
      </Link>
    </main>
  );
};

const checkoutIdOf = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : undefined;

export const spacePlanRoute = ({
  parent,
  readSpace,
  startCheckout,
  goTo,
  polling,
}: {
  readonly parent: AnyRootRoute;
  readonly readSpace: ReadSpace;
  readonly startCheckout: StartCheckout;
  readonly goTo: GoTo;
  readonly polling: Polling;
}) => {
  const route = createRoute({
    getParentRoute: () => parent,
    path: "/espaces/$spaceId/plan",
    validateSearch: (search: Readonly<Record<string, unknown>>) => ({
      checkout: checkoutIdOf(search["checkout"]),
    }),
    component: function SpacePlanPage() {
      const { spaceId } = route.useParams();
      const { checkout } = route.useSearch();
      return (
        <SpacePlan
          key={spaceId}
          spaceId={spaceId}
          returning={checkout !== undefined}
          readSpace={readSpace}
          startCheckout={startCheckout}
          goTo={goTo}
          polling={polling}
        />
      );
    },
  });
  return route;
};
