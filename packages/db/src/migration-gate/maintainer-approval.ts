export const APPROVAL_LABEL = "review:needs-approval";

export type LabelEvent = {
  readonly id: number;
  readonly event: string;
  readonly label: string;
  readonly actor: string;
  readonly actorType: string;
  readonly viaApp: boolean;
};

const MAINTAINER_ROLES = new Set(["admin", "maintain"]);
const LABEL_CHANGES = new Set(["labeled", "unlabeled"]);
const EVENT_LINE = /^(\d+)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t([^\t]*)\t(true|false)$/;

export const labelEvents = (tsv: string): readonly LabelEvent[] =>
  tsv.split("\n").flatMap((line) => {
    const match = EVENT_LINE.exec(line);
    if (match === null) return [];
    const [id, event, label, actor, actorType, viaApp] = match.slice(1);
    return [
      {
        id: Number(id),
        event: String(event),
        label: String(label),
        actor: String(actor),
        actorType: String(actorType),
        viaApp: viaApp === "true",
      },
    ];
  });

export const maintainerApprover = ({
  events,
  roleOf,
}: {
  readonly events: readonly LabelEvent[];
  readonly roleOf: (login: string) => string;
}): string | undefined => {
  const last = events
    .filter(({ event, label }) => LABEL_CHANGES.has(event) && label === APPROVAL_LABEL)
    .toSorted((first, second) => first.id - second.id)
    .at(-1);
  if (last === undefined || last.event !== "unlabeled") return undefined;
  if (last.actorType !== "User" || last.viaApp) return undefined;
  return MAINTAINER_ROLES.has(roleOf(last.actor)) ? last.actor : undefined;
};
