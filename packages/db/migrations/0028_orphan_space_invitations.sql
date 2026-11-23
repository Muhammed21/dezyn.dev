-- La suppression du compte du seul membre d'un espace supprime les invitations de cet espace devenu orphelin, dans la même transaction (ADR 0051, #365).
GRANT DELETE ON "space_invitation" TO app;
