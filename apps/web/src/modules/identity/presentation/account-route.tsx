import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type AnyRootRoute, createRoute, Link, Navigate } from "@tanstack/react-router";

import type { Result } from "@repo/result";

import type {
  AccountDeletion,
  AccountDeletionFailure,
  DeleteAccountFailure,
  PaidSpace,
  SpaceRef,
} from "../domain/account.ts";

type ReadDeletion = () => Promise<Result<AccountDeletion, AccountDeletionFailure>>;
type DeleteAccount = () => Promise<Result<undefined, DeleteAccountFailure>>;

const UNAVAILABLE = "La suppression du compte est indisponible pour le moment.";

const LAST_OWNER =
  "Vous êtes le dernier propriétaire de ces espaces : nommez un autre propriétaire avant de supprimer votre compte.";

const PERIOD_DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

const endOf = (currentPeriodEnd: Date | undefined) =>
  currentPeriodEnd === undefined
    ? "à la fin de la période payée"
    : `le ${PERIOD_DATE.format(currentPeriodEnd)}`;

const SpacesToHandOver = ({ spaces }: { readonly spaces: readonly SpaceRef[] }) => (
  <ul aria-label="Espaces à transmettre">
    {spaces.map(({ id, name }) => (
      <li key={id}>
        <Link to="/espaces/$spaceId" params={{ spaceId: id }}>
          {name}
        </Link>
      </li>
    ))}
  </ul>
);

const CanceledSubscriptions = ({ paidSpaces }: { readonly paidSpaces: readonly PaidSpace[] }) =>
  paidSpaces.length === 0 ? null : (
    <ul aria-label="Abonnements résiliés">
      {paidSpaces.map(({ id, name, currentPeriodEnd }) => (
        <li key={id}>
          L'abonnement Team de « {name} » sera résilié : il prendra fin {endOf(currentPeriodEnd)}.
        </li>
      ))}
    </ul>
  );

const Confirmation = ({
  paidSpaces,
  deleteAccount,
}: {
  readonly paidSpaces: readonly PaidSpace[];
  readonly deleteAccount: DeleteAccount;
}) => {
  const queryClient = useQueryClient();
  const { data, isPending, mutate } = useMutation({
    mutationFn: deleteAccount,
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.removeQueries();
      }
    },
  });
  const failure = !isPending && data?.ok === false ? data.error : undefined;
  if (data?.ok === true || failure?.kind === "unauthenticated") {
    return <Navigate to="/connexion" />;
  }
  return (
    <>
      <CanceledSubscriptions paidSpaces={paidSpaces} />
      <button type="button" disabled={isPending} onClick={() => mutate()}>
        Supprimer définitivement mon compte
      </button>
      {failure?.kind === "last_owner" && (
        <>
          <p role="alert">{LAST_OWNER}</p>
          <SpacesToHandOver spaces={failure.spaces} />
        </>
      )}
      {failure !== undefined && failure.kind !== "last_owner" && <p role="alert">{UNAVAILABLE}</p>}
    </>
  );
};

const Account = ({
  accountDeletion,
  deleteAccount,
}: {
  readonly accountDeletion: ReadDeletion;
  readonly deleteAccount: DeleteAccount;
}) => {
  const { data } = useQuery({ queryKey: ["account-deletion"], queryFn: accountDeletion });
  if (data === undefined) {
    return <p>Chargement…</p>;
  }
  if (!data.ok) {
    return data.error === "unauthenticated" ? (
      <Navigate to="/connexion" />
    ) : (
      <p role="alert">{UNAVAILABLE}</p>
    );
  }
  const { paidSpaces, lastOwnerSpaces } = data.value;
  return (
    <main>
      <h1>Supprimer mon compte</h1>
      <p>
        Vos actions restent dans l'historique des projets, sous un membre supprimé, sans votre nom.
      </p>
      {lastOwnerSpaces.length > 0 ? (
        <>
          <p>{LAST_OWNER}</p>
          <SpacesToHandOver spaces={lastOwnerSpaces} />
        </>
      ) : (
        <Confirmation paidSpaces={paidSpaces} deleteAccount={deleteAccount} />
      )}
    </main>
  );
};

export const accountRoute = ({
  parent,
  accountDeletion,
  deleteAccount,
}: {
  readonly parent: AnyRootRoute;
  readonly accountDeletion: ReadDeletion;
  readonly deleteAccount: DeleteAccount;
}) =>
  createRoute({
    getParentRoute: () => parent,
    path: "/compte",
    component: () => <Account accountDeletion={accountDeletion} deleteAccount={deleteAccount} />,
  });
