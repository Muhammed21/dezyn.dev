# 0047 — Les tests visuels de l'app web capturent dans le Chromium de l'image Docker de Playwright

- Statut : Accepté
- Date : 2026-11-19
- Décideurs : Muhammed Cavus

## Contexte et problématique

La relecture d'une proposition dessine la valeur avant et après selon le type du token : pastille, barre, carte ombrée, texte d'exemple, bande (#275). Les tests navigateur de l'app web (Vitest Browser Mode, Playwright, Chromium installé sur l'hôte) vérifient ce que l'éditeur lit : libellés, valeur lisible, nom accessible. Ils ne voient pas un damier qui change de couleur ou une ombre qui disparaît.

`toMatchScreenshot` de Vitest compare une capture à une image de référence commitée. Mais Chromium ne dessine pas les polices, l'anticrénelage et les flous de la même façon sur macOS, sur Linux, ni sur arm64 et amd64. Une référence prise sur le Mac du développeur ne correspond pas à la capture de la CI Linux. Vitest range d'ailleurs ses références par plateforme (`-chromium-darwin.png`, `-chromium-linux.png`).

Les minutes de CI sont limitées. Le job `Test` installe déjà Chromium sur l'hôte pour les tests navigateur, et ceux-ci doivent rester sans Docker.

Problématique : où tourne le navigateur des tests visuels, pour qu'une capture soit la même sur macOS et dans la CI Linux ?

## Facteurs de décision

- Une capture prise sur macOS est identique, à l'octet près, à celle de la CI Linux : une référence ne se régénère jamais à cause de l'OS.
- Le développeur génère et met à jour les références sur son poste.
- Les tests navigateur actuels gardent leur Chromium local, sans Docker.
- Le job de CI reste court.

## Options envisagées

### Option A — Le Chromium des tests visuels tourne dans l'image Docker officielle de Playwright

Un projet Vitest à part (`vitest.visual.config.ts`) se connecte, par `connectOptions.wsEndpoint` du provider Playwright, à un `playwright run-server` lancé dans `mcr.microsoft.com/playwright:v<version>-noble`, en `linux/amd64`. Vitest et Vite restent sur l'hôte ; `exposeNetwork: "<loopback>"` fait passer le `localhost` de l'hôte au navigateur du conteneur.

- Avantage : le même binaire Chromium, avec les mêmes bibliothèques et les mêmes polices, dessine sur macOS et en CI. Mesuré le 19/11/2026 : les 9 références prises sur macOS (Apple Silicon) et sous Linux amd64 sont identiques à l'octet près.
- Avantage : le test tourne sur l'hôte, avec ses chemins, son mode watch et ses fichiers.
- Inconvénient : Docker est requis pour ce projet, en local et en CI.
- Inconvénient : sur un Mac Apple Silicon, l'image amd64 tourne en émulation ; le run reste court (environ 11 s pour 9 captures).
- **Retenue.**

### Option B — Références par plateforme, générées sur chaque OS

- Avantage : pas de Docker.
- Inconvénient : seule la référence Linux est vérifiée en CI. Une référence macOS ne prouve rien, et mettre à jour la référence Linux demande la CI.
- **Écartée** : un développeur ne peut pas produire la référence qui compte.

### Option C — Toute la commande Vitest tourne dans un conteneur

- Avantage : rien de l'hôte n'entre dans le rendu.
- Inconvénient : il faut traduire les chemins, rendre les fichiers produits à l'utilisateur, et installer des `node_modules` Linux à côté de ceux de l'hôte.
- **Écartée** : seul le navigateur a besoin d'être le même.

### Option D — Un service de captures en ligne

- **Écartée** : un service tiers payant de plus, et les captures quittent le dépôt.

## Décision

### 1. Un projet Vitest visuel, à part

Les tests visuels de l'app web s'appellent `*.visual.test.tsx`, dans un dossier `__tests__/`. Ils forment le projet `visual` (`apps/web/vitest.visual.config.ts`), lancé par `pnpm --filter @repo/web test:visual`. Le projet `browser` les exclut et garde son Chromium local.

### 2. Le navigateur tourne dans l'image Playwright de la version du dépôt

Le `globalSetup` du projet (`apps/web/src/testing/playwright-server.ts`) lance `mcr.microsoft.com/playwright:v<version>-noble` en `linux/amd64`, où `<version>` est celle du `playwright-core` installé. Le serveur est le `cli.js` de ce `playwright-core`, monté en lecture seule : le client et le serveur ont la même version, et le démarrage ne télécharge rien.

Monter la version de Playwright change l'image, et peut changer toutes les références : on les régénère dans la même PR.

### 3. Des captures déterministes

Les animations sont coupées (`animations: "disabled"`, `reducedMotion: "reduce"`), le curseur de texte caché, l'échelle à 1. La police d'exemple (Inter, `@fontsource-variable/inter`) est chargée par le test, et tout le texte capturé l'utilise : aucune police système n'entre dans une capture.

### 4. Références commitées, captures d'échec ignorées

Une référence vit dans `__tests__/__references__/<fichier de test>/<nom>.png`, sans suffixe de plateforme. La capture d'un échec et son diff vont dans `.vitest-attachments/`, ignoré par git, comme `__screenshots__/`, où le projet `browser` range ses captures d'échec. En CI, une référence absente fait échouer le test.

### 5. Un job de CI à part

Le job `Test (visual)` de `ci.yml` tire l'image pendant l'installation des dépendances, puis lance le seul projet visuel, sans build ni installation de navigateur. Sur une PR qui ne touche ni `apps/web`, ni `packages/`, ni `pnpm-lock.yaml`, ni `ci.yml`, il ne fait rien.

## Conséquences

### Positives

- Une régression visuelle d'un aperçu fait échouer la CI.
- Un développeur sur macOS produit la référence que la CI vérifie.
- Les tests navigateur et le job `Test` ne changent pas.

### Négatives

- Le projet visuel demande Docker sur le poste du développeur.
- Le job tire une image d'environ 1 Go à chaque run, faute de cache d'image entre runs.
- La première mise à jour de Playwright après cette décision peut régénérer toutes les références.

### Risques et mitigations

- Un tag d'image republié par Microsoft pourrait changer le rendu à version égale. Mitigation : le diff de la CI le montre ; épingler l'image par digest si cela arrive.
- Le port du serveur est fixe (53300) : deux runs visuels en même temps sur un poste se gênent. Mitigation : un seul run visuel par poste ; un port libre tiré au démarrage si le besoin vient.
- Le job ignore une PR qui casse un aperçu depuis un paquet hors de `apps/web`. Mitigation : `main` relance toujours le job après le merge.

## Notes d'implémentation

```sh
pnpm --filter @repo/web test:visual                      # vérifie les captures
pnpm --filter @repo/web exec vitest run --config vitest.visual.config.ts --update  # régénère les références
```

Une référence absente est créée au premier run local, qui échoue pour la faire relire.

## Liens

- [0037](0037-l-app-web-est-une-spa-react-servie-en-statique-par-cloudflare.md) : l'app web dont on capture les aperçus.
- [0005](0005-regression-visuelle-des-snapshots-envoyes-par-la-ci.md) : sans lien de décision ; la régression visuelle des composants du client est une fonction du produit, celle-ci teste l'app web elle-même.
