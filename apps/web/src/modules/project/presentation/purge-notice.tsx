const PURGE_DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

export const PurgeNotice = ({ purgedAt }: { readonly purgedAt: Date }) => (
  <p role="status">
    L'historique de ce projet a été purgé le {PURGE_DATE.format(purgedAt)} pour libérer du stockage.
  </p>
);
