import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import type { Result } from "@repo/result";

import type { FreeLimit, SpaceFailure, SpaceWithStorage } from "../domain/space.ts";

type ReadSpace = (space: {
  readonly spaceId: string;
}) => Promise<Result<SpaceWithStorage, SpaceFailure>>;

export const SUSPENDED_EDITOR_ACCESS =
  "Votre accès à cet espace est suspendu : il est gelé jusqu'à son retour au plan Team.";

const EXCEEDED_LIMITS: Readonly<Record<FreeLimit, string>> = {
  projects: "plus de 3 projets",
  storage: "plus de 500 Mo stockés",
  members: "plus d'un membre",
};

const FrozenAlert = ({
  spaceId,
  exceededFreeLimits,
}: {
  readonly spaceId: string;
  readonly exceededFreeLimits: readonly FreeLimit[];
}) => (
  <section aria-labelledby="espace-gele">
    <h2 id="espace-gele">Espace gelé</h2>
    <p>
      L'abonnement Team de cet espace est terminé, et l'espace dépasse les limites du plan Free :{" "}
      {exceededFreeLimits.map((limit) => EXCEEDED_LIMITS[limit]).join(", ")}. Rien n'est supprimé.
      Vos éditeurs sont suspendus, et vous ne pouvez plus créer de projet ni inviter. Repassez au
      plan Team, ou revenez sous les limites Free, pour lever le gel.
    </p>
    <Link to="/espaces/$spaceId/plan" params={{ spaceId }}>
      Repasser au plan Team
    </Link>
  </section>
);

const SuspendedAccess = () => (
  <section aria-labelledby="acces-suspendu">
    <h2 id="acces-suspendu">Accès suspendu</h2>
    <p>
      {SUSPENDED_EDITOR_ACCESS} Rien n'y est supprimé ; un propriétaire peut repasser l'espace au
      plan Team.
    </p>
  </section>
);

export const spaceFrozenAlert = ({ readSpace }: { readonly readSpace: ReadSpace }) =>
  function SpaceFrozenAlert({ spaceId }: { readonly spaceId: string }) {
    const { data: space } = useQuery({
      queryKey: ["space", spaceId],
      queryFn: () => readSpace({ spaceId }),
    });
    if (space?.ok === false && space.error === "frozen") {
      return <SuspendedAccess />;
    }
    return space?.ok === true && space.value.frozen ? (
      <FrozenAlert spaceId={spaceId} exceededFreeLimits={space.value.exceededFreeLimits} />
    ) : null;
  };
