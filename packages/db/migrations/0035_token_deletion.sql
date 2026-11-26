-- Un membre supprime un token, ou valide la suppression proposée par l'IA : l'app retire le token, ses valeurs (DELETE sur token_value depuis 0008, leurs références par la cascade de 0010) et son état Figma (ADR 0026 §3, #435).
GRANT DELETE ON "token", "token_figma_state" TO app;
