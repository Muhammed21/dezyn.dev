import { useQuery } from "@tanstack/react-query";

import type { Result } from "@repo/result";

import type { SpaceFailure, SpaceStorage, SpaceWithStorage } from "../domain/space.ts";

type ReadSpace = (space: {
  readonly spaceId: string;
}) => Promise<Result<SpaceWithStorage, SpaceFailure>>;

const GIGABYTE = 1_000_000_000;

const sizeFormat = (unit: "megabyte" | "gigabyte") =>
  new Intl.NumberFormat("fr-FR", {
    style: "unit",
    unit,
    maximumFractionDigits: 1,
    roundingMode: "floor",
  });

const sizeOf = (bytes: number) =>
  bytes < GIGABYTE
    ? sizeFormat("megabyte").format(bytes / 1_000_000)
    : sizeFormat("gigabyte").format(bytes / GIGABYTE);

const StorageAlert = ({ storage }: { readonly storage: SpaceStorage }) => (
  <section aria-labelledby="stockage-bientot-plein">
    <h2 id="stockage-bientot-plein">Stockage bientôt plein</h2>
    <p>
      Cet espace utilise {Math.floor((storage.usedBytes * 100) / storage.limitBytes)} % de son
      stockage : {sizeOf(storage.usedBytes)} sur {sizeOf(storage.limitBytes)}.
    </p>
    <p>
      À 100 %, dezyn purge les plus anciennes images de snapshots puis l'historique, en commençant
      par le projet qui consomme le plus. Le MCP reste disponible.
    </p>
  </section>
);

export const spaceStorageAlert = ({ readSpace }: { readonly readSpace: ReadSpace }) =>
  function SpaceStorageAlert({ spaceId }: { readonly spaceId: string }) {
    const { data: space } = useQuery({
      queryKey: ["space", spaceId],
      queryFn: () => readSpace({ spaceId }),
    });
    return space?.ok === true && space.value.storage.alertReached ? (
      <StorageAlert storage={space.value.storage} />
    ) : null;
  };
