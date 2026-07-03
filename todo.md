# Glyria.js — TODO

Framework de bot Discord basé sur discord.js.

> État actuel (js.glyria.app) : commandes file-based, sous-commandes/groupes, auto-imports globaux, Embed V2 builder, replies stylées (`ctx.g.reply.success/error/info`) injectées automatiquement, GlyriaBus, CLI (init/dev/build/start/generate/module/reload/replay/bench/studio), config thème, SDK modules, store intégré, components typés.

## 🤯 Features "à couper le souffle"
- [x] **Studio web intégré (`glyria studio`)** : une UI locale (type Storybook/Prisma Studio) qui liste toutes tes commandes/composants/modules, permet de les exécuter et voir le rendu Discord *sans ouvrir Discord* — preview live des embeds/boutons pendant que tu codes *(v1 : liste des commandes + guards, exécution sur contexte fake, rendu Embed V2/boutons, onglet recordings, rechargement à chaque requête)*
- [x] **Zero-downtime hot-reload en prod** : remplacement des handlers de commandes en mémoire pendant que le process tourne (pas juste en dev), le bot ne redémarre jamais pour un déploiement de code *(`glyria build` puis `glyria reload` → SIGUSR2, swap en mémoire commands/events/components/modules, gateway jamais coupée)*
- [x] **Time-travel debugging** : chaque interaction est enregistrée (payload + état du contexte) et rejouable à volonté (`glyria replay <interactionId>`) pour débugger un bug signalé par un user sans pouvoir le reproduire *(enregistrement auto en dev ou `recording: true`, `glyria replay --list`, verdict PASS/DIFF vs run original)*
- [x] **Load-test simulator** : `glyria bench` simule des milliers d'interactions concurrentes contre ton bot en local pour trouver les goulots d'étranglement avant la prod *(in-process contre contexte fake : mesure ton code handler, pas l'API Discord — latences p50/p95/p99, throughput)*
- [x] **Auto-changelog Discord** : à chaque déploiement, le bot poste automatiquement dans un salon un résumé lisible des commandes/modules ajoutés/modifiés/supprimés *(diff généré depuis un snapshot `.glyria/commands.snapshot.json` plutôt que git — config `changelog.channel`)*
- [x] **Self-healing process** : détection de crash-loop, rollback automatique vers la dernière version stable des commandes enregistrées *(supervisor dans `glyria start` : backoff exponentiel, 3 crashs/60s → rollback vers `.glyria/last-good`, snapshot auto après 60s de stabilité ; état de session Redis non couvert)*
- [x] **Génération de visuels dynamiques intégrée** : un moteur de canvas/SVG→PNG livré nativement (`ctx.g.canvas.rankCard()`, `.leaderboard()`) sans avoir à brancher `canvas`/`sharp` soi-même, avec attach direct dans `ctx.g.reply` *(SVG pur sans dépendance ; PNG si `@resvg/resvg-js` ou `sharp` est présent, sinon fallback .svg explicite — `.file(...(await img.attachment()))`)*

## 💎 Features pépites (différenciantes)
- [x] **`ctx.g.paginate()`** : pagination Embed V2 native en une ligne, boutons précédent/suivant auto-gérés, timeout auto-disable
- [x] **`ctx.g.confirm()`** : popup confirmation oui/non en une ligne, retourne une Promise<boolean>, basé sur Embed V2
- [x] **Cooldowns déclaratifs** : `.setCooldown("5s")` ou `.setCooldown({ user: "5s", guild: "2s" })` directement sur `GlyriaCommand`, comme `.setName()` — aussi sur les sous-commandes (override) et les commandes contextuelles, scope `global` en bonus
- [x] **Permissions déclaratives** : `.setPermissions(["BanMembers"])` / `.setOwnerOnly(true)` avec message d'erreur stylé automatique via `ctx.g.reply.error`
- [x] **Autocomplete typé** : `.addStringOption(o => o.setAutocomplete(async (query, ctx) => [...]))` — auto-inféré, pas de handler séparé à écrire *(strings, nombres ou `{name, value}`, routé automatiquement)*
- [x] **Store intégré (`ctx.g.store`)** : mini state management par guild/user (Map en mémoire + adaptateur pluggable SQLite/Redis) sans configurer de DB à la main *(adapters memory + JSON fichier fournis, interface `StoreAdapter` pour brancher Redis/SQLite, scopes guild/user/global/module)*
- [x] **Watch mode intelligent** : rechargement à chaud qui ne re-register sur Discord que les commandes qui ont réellement changé (diff), pas tout le tableau à chaque save *(diff par commande, PUT sauté si aucun changement, log `+new ~changed -removed`)*
- [x] **Typage bout-en-bout des interactions custom** : `customId` typés (TS infère les params encodés dedans, genre `role_picker:${roleId}`) pour éviter le parsing manuel de string *(`new GlyriaButton("vote:{pollId}:{choice}")` → params typés dans le handler, `.id({...})` pour générer l'id, fichiers `src/components/` auto-chargés)*

## 🧱 Modules & SDK (`/sdk`)
- [x] **Refonte du système de modules actuel** : chaque module = un dossier autonome (`commands/`, `events/`, `components/`, manifeste) chargé dynamiquement *(local `src/modules/<nom>/` ou package npm)*
- [x] **`glyria.module.ts`** : fichier manifeste par module (nom, version, dépendances vers d'autres modules, config par défaut) *(le `defineModule` sert de manifeste ; les packages npm peuvent exposer `glyria.module.ts` ou `index.ts`)*
- [x] **SDK `/sdk`** : primitives pour construire un module (`defineModule()`, `defineCommand()`, `defineEvent()`, `defineHook()`) avec types stricts *(exposées par `@glyria/bot` + globals auto-importés, plutôt que générées dans un dossier `/sdk` du projet)*
- [x] **`defineModule({ name, setup, hooks })`** : point d'entrée unique d'un module, `setup(ctx)` reçoit un contexte scoppé (client, store scoppé au module, logger, config du module, `ctx.modules`)
- [x] **Système de hooks de cycle de vie** : `onLoad`, `onReady`, `onUnload`, `onCommandRun`, `onError`, `onGuildJoin/Leave` — enregistrables depuis n'importe quel module via le SDK, sans toucher au core
- [x] **Hooks d'interception (middleware global)** : `beforeCommand(ctx, meta, next)` / `afterCommand(ctx, meta, result)` — chaîne type Koa, un module qui n'appelle pas `next()` annule la commande
- [x] **Isolation & sandboxing des modules** : un module qui crash ne doit pas crasher le bot entier *(try/catch autour de chaque hook, `onError`, auto-désactivation après 5 erreurs, statuts active/disabled/error)*
- [x] **Résolution de dépendances entre modules** : `dependsOn: ["economy"]`, tri topologique, blocage clair si dépendance manquante ou cycle
- [x] **Config par module typée** : `defineModule({ config: schema })` compatible Zod (tout objet avec `.parse()` ou une fonction), validée au chargement via `moduleConfig` dans `glyria.config.ts`
- [x] **Hot-swap de module isolé** : recharger un seul module en mémoire (`modulesManager.reload(name)`) sans toucher aux autres ni redémarrer le bot — watcher dev branché sur `src/modules/`
- [x] **CLI `glyria module create <nom>`** : scaffold un nouveau module complet dans `src/modules/<nom>` avec le manifeste, un exemple de commande et de hook
- [x] **Publication NPM standard** : un module n'est qu'un package NPM normal — `npm publish` suffit, pas de marketplace ni d'infra dédiée à maintenir *(le loader résout `glyria.module.ts`/`index.ts` + `commands/`/`events/`/`components/` du package)*
- [x] **Installation d'un module externe** : `npm install <module>` puis simple ajout dans `glyria.config.ts` (`modules: ["mon-module-npm"]`) pour l'activer, le loader le résout comme un module local
- [x] **Registry local de modules (`glyria module list`)** : liste les modules chargés (locaux ou npm), leur statut (actif/désactivé/erreur), leurs hooks enregistrés — aussi en runtime via `modulesManager.list()`
- [x] **Permissions inter-modules** : un module peut exposer une API interne consommable par d'autres modules (`ctx.modules.get("economy").addBalance(...)`) avec typage via augmentation de l'interface `GlyriaModules`
- [x] **Tests unitaires pour modules** : helper SDK `createTestContext()` pour tester un module (commande/hook) hors Discord, façon `@testing-library` — capture `.replies` / `.repliesText()`

## 🧠 Amélioration du Replyable Context (`ctx.g`)
- [x] **Suppression du `createReplyableContext(message)` manuel** : le contexte est injecté automatiquement par le framework dans les commandes, components, events et hooks de module
- [x] **`ctx.g` disponible nativement partout** : commandes (slash + contextuelles), events (tout argument replyable est wrappé), components (boutons/selects/modals) et middleware de modules — un seul objet cohérent
- [x] **Auto-détection de la source (`message` vs `interaction`)** : construction interne duck-typée, même API `ctx.g.reply.*` partout
- [x] **Chaînage complet des réponses** : `ctx.g.reply.success("Titre").description("...").field("Champ", "Valeur").send()` — builder fluide *thenable* (le `await` direct marche toujours)
- [x] **Édition native de la dernière réponse** : `ctx.g.edit("nouveau contenu")` retrouve automatiquement le dernier message envoyé par le contexte (et garde son style)
- [x] **Réponses différées intelligentes** : defer automatique à ~1.5s si le handler n'a pas encore répondu (fenêtre Discord de 3s), plus `ctx.g.defer()` manuel — le routage passe tout seul sur `editReply`/`followUp` ensuite
- [x] **Followups typés** : `ctx.g.followUp.success()` / `.error()` etc. avec le même styling que `reply` (+ bascule automatique sur followUp après la première réponse)
- [x] **`ctx.g.reply.raw()`** : sortie d'échappement pour envoyer un payload discord.js brut quand on veut sortir du système stylé (aussi `ctx.g.followUp.raw()`)
- [x] **Réponses éphémères par défaut configurables** : `ctx.g.ephemeral(true)` pour tout le contexte + option `{ ephemeral: true }` par appel *(un module peut l'imposer globalement via `beforeCommand`)*
- [x] **`ctx.g.reply.loading()`** : état de chargement stylé auto-remplacé par le résultat final (`await ctx.g.reply.loading("Recherche...", fetchData(), { done: r => ... })`)
- [x] **Attachments fluides** : `ctx.g.reply.success().file(buffer, "rank.png")` intégré au chaînage, avec support direct du moteur de canvas (`await ctx.g.canvas.rankCard({...}).attachment()`)
- [x] **Contexte enrichi automatique** : `ctx.g.user`, `ctx.g.member`, `ctx.g.guildConfig` (namespace de config par guild adossé au store) directement résolus
- [x] **Réponses conditionnelles selon le canal d'origine** : flag ephemeral ignoré pour les sources message (non supporté par Discord), fallback texte automatique si l'envoi Components V2 échoue
- [x] **Historique de contexte accessible** : `ctx.g.history()` pour retrouver les réponses précédentes envoyées dans la même interaction (variant, via, payload, message, timestamp)
- [x] **Hooks sur le contexte lui-même** : `ctx.g.onSend((entry) => {...})` pour brancher du logging/analytics sur chaque réponse envoyée
- [x] **`ctx.g.log()`** : logger stylé qui poste aussi dans un salon Discord de logs configuré (`logChannel` dans la config), sans setup manuel de webhook
- [x] **Typage strict du contexte selon le type d'interaction** : `ctx.g.defer()` n'existe (en types) que si la source a `deferReply`, `ctx.g.update.*` que pour les components — le reste de l'API est commun

## 🔭 Idées suivantes (non planifié)
- [ ] Préservation d'état de session pendant le self-healing (Redis/disque) pour ne perdre aucune interaction en cours
- [ ] Adapters store officiels Redis / SQLite (l'interface `StoreAdapter` est prête)
- [ ] Studio : édition des options de commande avec autocomplete branché, websocket pour rafraîchir sans re-fetch
- [ ] `glyria replay` en mode watch (`--watch` : rejoue à chaque save jusqu'à ce que ça passe)
