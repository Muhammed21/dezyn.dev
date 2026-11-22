import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import type { Result } from "@repo/result";

import type { SpaceFailure, SpaceWithStorage } from "../domain/space.ts";

type ReadSpace = (space: {
  readonly spaceId: string;
}) => Promise<Result<SpaceWithStorage, SpaceFailure>>;

const PaymentAlert = ({ spaceId }: { readonly spaceId: string }) => (
  <section aria-labelledby="paiement-echoue">
    <h2 id="paiement-echoue">Paiement échoué</h2>
    <p>
      Le dernier paiement du plan Team a échoué. L'espace reste au plan Team pendant que Polar
      relance le paiement : mettez à jour le moyen de paiement pour le garder.
    </p>
    <Link to="/espaces/$spaceId/plan" params={{ spaceId }}>
      Mettre à jour le moyen de paiement
    </Link>
  </section>
);

export const spacePaymentAlert = ({ readSpace }: { readonly readSpace: ReadSpace }) =>
  function SpacePaymentAlert({ spaceId }: { readonly spaceId: string }) {
    const { data: space } = useQuery({
      queryKey: ["space", spaceId],
      queryFn: () => readSpace({ spaceId }),
    });
    return space?.ok === true && space.value.subscription?.status === "past_due" ? (
      <PaymentAlert spaceId={spaceId} />
    ) : null;
  };
