# Bento Dashboard

Application de bureau Windows pour surveiller et piloter le serveur personnel **bento** (Ubuntu) à
travers Tailscale. Un seul utilisateur, un seul serveur. Electron, Vue 3, TypeScript.

Elle se connecte en SSH (clé uniquement) avec un utilisateur dédié aux droits minimaux, lit l'état du
serveur toutes les 30 secondes et reste dans la barre système.

> Projet personnel publié tel quel, sans support : il est écrit pour un seul serveur et un seul
> utilisateur. Les noms de vos conteneurs, stacks et interfaces web se saisissent dans **Réglages,
> Conteneurs** ; rien de propre à un serveur n'est dans le code.
>
> **À propos de l'historique.** L'application existait avant d'être publiée (versions 1.0.0 à
> 1.2.0, dans un dépôt privé). Ce dépôt repart d'un seul commit, qui est déjà la version 1.3.0 :
> c'est pourquoi la numérotation ne commence pas à 1.0.0.

## Ce que l'application fait

| | Fonction |
| --- | --- |
| F1 | Connexion SSH par clé via Tailscale, reconnexion automatique, indicateur en ligne ou hors ligne |
| F2 | État de tous les conteneurs Docker, regroupés par stack, et de Tailscale (systemd) |
| F3 | CPU, mémoire, disques, charge, durée de fonctionnement |
| F4 | Icône dans la barre système qui reflète l'état global |
| F5 | Notifications Windows : service tombé, bento injoignable, disque au-dessus du seuil |
| F6 | Démarrer, arrêter ou redémarrer un conteneur, avec confirmation pour arrêter et redémarrer |
| F7 | 200 dernières lignes de logs des conteneurs choisis dans les réglages et de Tailscale |
| F8 | Réglages : hôte, empreinte du serveur, intervalle, seuils, lancement au démarrage |
| F9 | Sur téléphone (facultatif) : état des conteneurs par stack, démarrer, arrêter ou redémarrer, depuis une page installable (voir « Agent sur bento ») |

Hors périmètre : terminal intégré, administration complète, accès hors Tailscale, plusieurs serveurs.

## Installer l'application

1. Récupérer `bento-dashboard-<version>-setup.exe` dans les releases du dépôt.
2. Lancer l'installeur. Il n'est **pas signé** : Windows SmartScreen affiche « Windows a protégé votre
   ordinateur ». Cliquer sur « Informations complémentaires », puis « Exécuter quand même ».
3. L'application s'installe pour l'utilisateur courant, sans droits administrateur.

Fermer la fenêtre la réduit dans la barre système. Seul « Quitter » du menu de l'icône arrête l'application.

## Préparer bento (une seule fois)

Tout se passe sur le serveur, avec un compte administrateur.

### 1. Utilisateur dédié et clé

```bash
sudo adduser --disabled-password --gecos "" bento-dash
sudo install -d -m 700 -o bento-dash -g bento-dash /home/bento-dash/.ssh
# Coller la clé publique ed25519 de ton poste Windows :
echo "ssh-ed25519 AAAA… bento-dash" | sudo tee /home/bento-dash/.ssh/authorized_keys
sudo chown bento-dash:bento-dash /home/bento-dash/.ssh/authorized_keys
sudo chmod 600 /home/bento-dash/.ssh/authorized_keys
```

`bento-dash` ne doit **pas** être dans le groupe `docker` : ce groupe équivaut à root.

### 2. Règles sudoers exactes

Lecture : des commandes figées, sans joker. Actions : un petit script appartenant à root, qui est
la seule frontière (voir plus bas). `sudo visudo -f /etc/sudoers.d/bento-dash`, puis
`sudo visudo -cf /etc/sudoers.d/bento-dash` :

```
bento-dash ALL=(root) NOPASSWD: /usr/bin/docker ps -a --format {{.Names}}|{{.State}}|{{.Ports}}|{{.Label\ "com.docker.compose.project"}}|{{.Status}}
bento-dash ALL=(root) NOPASSWD: /usr/local/bin/bento-docker-logs *
bento-dash ALL=(root) NOPASSWD: /usr/bin/journalctl -u tailscaled -n 200 --no-pager -o short-iso
bento-dash ALL=(root) NOPASSWD: /usr/local/bin/bento-docker-action start *
bento-dash ALL=(root) NOPASSWD: /usr/local/bin/bento-docker-action stop *
bento-dash ALL=(root) NOPASSWD: /usr/local/bin/bento-docker-action restart *
```

Le format de `docker ps` donne aussi les ports publiés et le projet compose (la stack) de chaque
conteneur : l'espace dans `{{.Label "…"}}` s'écrit `\ ` dans sudoers. Tester la commande exacte,
car `visudo -cf` ne vérifie que la syntaxe :
`sudo -u bento-dash sudo -n docker ps -a --format '{{.Names}}|{{.State}}|{{.Ports}}|{{.Label "com.docker.compose.project"}}|{{.Status}}'`
ne doit pas demander de mot de passe.

**Journaux d'un conteneur.** Une seule ligne sudoers, vers le script `bento-docker-logs` (voir
plus bas), quel que soit le nombre de conteneurs. Pour en lire un : cocher le conteneur dans
**Réglages, Conteneurs, Conteneurs dont on lit les journaux**, rien à ajouter sur bento. L'app ne
lit que les conteneurs cochés *et* présents dans le dernier relevé ; le script, lui, accepte tout
conteneur existant (décision du 2026-10-20, lecture seule, 200 lignes). Sans le script ou sa
ligne, l'écran des journaux affiche « Règle sudoers manquante pour bento-dash ».

#### Script des actions sur les conteneurs

`scripts/bento-docker-action.sh` démarre, arrête ou redémarre **un** conteneur existant. Les trois
lignes sudoers laissent le nom du conteneur libre (`*`) : c'est donc le script qui valide tout
avant d'appeler docker (action parmi `start|stop|restart`, nom de la forme
`[A-Za-z0-9][A-Za-z0-9_.-]{0,127}`, présent à l'identique dans `docker ps -a`). Codes de sortie :
64 usage invalide, 65 conteneur inconnu, 66 docker indisponible.

Installation, depuis le dépôt (les fins de ligne doivent être LF, `.gitattributes` s'en charge) :

```bash
scp scripts/bento-docker-action.sh <utilisateur>@bento:/tmp/
# puis sur bento :
sudo install -o root -g root -m 0755 /tmp/bento-docker-action.sh /usr/local/bin/bento-docker-action
head -1 /usr/local/bin/bento-docker-action | cat -A            # doit afficher exactement : #!/bin/bash$
```

C'est la frontière de sécurité : tester, **en tant que `bento-dash`**, chaque cas refusé et un cas
réel (voir la matrice ci-dessous). Les refus « sudo » viennent de sudoers (aucune règle ne
correspond), les codes 64 et 65 du script :

```bash
A=/usr/local/bin/bento-docker-action
t() { sudo -u bento-dash sudo -n "$@" >/dev/null 2>&1; echo "code=$?  <- $*"; }
t $A rm jellyfin                 # refus sudoers (code 1)
t $A restart                     # refus sudoers (code 1)
t $A restart jellyfin extra      # 64
t $A restart --help              # 64
t $A restart 'jellyfin;id'       # 64
t $A restart '$(id)'             # 64
t $A restart nope                # 65
t $A restart JELLYFIN            # 65
t $A restart <un conteneur sans importance>   # 0 : le seul cas qui agit
```

#### Script des journaux des conteneurs

`scripts/bento-docker-logs.sh` affiche les 200 dernières lignes d'**un** conteneur existant. La
ligne sudoers laisse le nom libre (`*`) : le script valide tout avant d'appeler docker (un seul
argument, nom de la forme `[A-Za-z0-9][A-Za-z0-9_.-]{0,127}`, présent à l'identique dans
`docker ps -a`). Mêmes codes de sortie que le script des actions : 64, 65, 66.

```bash
scp scripts/bento-docker-logs.sh <utilisateur>@bento:/tmp/
# puis sur bento :
sudo install -o root -g root -m 0755 /tmp/bento-docker-logs.sh /usr/local/bin/bento-docker-logs
head -1 /usr/local/bin/bento-docker-logs | cat -A              # doit afficher exactement : #!/bin/bash$
```

Puis remplacer dans `/etc/sudoers.d/bento-dash` les anciennes lignes `docker logs --tail 200 <nom>`
par la ligne du script, et vérifier avec `sudo visudo -cf /etc/sudoers.d/bento-dash`. Tester **en
tant que `bento-dash`** :

```bash
L=/usr/local/bin/bento-docker-logs
t() { sudo -u bento-dash sudo -n "$@" >/dev/null 2>&1; echo "code=$?  <- $*"; }
t $L                             # 64
t $L jellyfin extra              # 64
t $L --follow                    # 64
t $L 'jellyfin;id'               # 64
t $L nope                        # 65
t $L <un conteneur existant>     # 0 : le seul cas qui lit
```

### 3. Empreinte du serveur

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Coller la ligne entière dans les réglages : l'application refuse tout serveur dont l'empreinte diffère.

## Préparer Windows

La clé SSH reste dans l'agent OpenSSH de Windows ; l'application ne la stocke pas.

```powershell
Get-Service ssh-agent | Set-Service -StartupType Automatic
Start-Service ssh-agent
C:\Windows\System32\OpenSSH\ssh-add.exe $env:USERPROFILE\.ssh\bento-dash
```

Utiliser bien le `ssh-add` de `C:\Windows\System32\OpenSSH` : celui de Git pour Windows parle à un autre
agent, que l'application n'utilise pas. Ensuite, dans **Réglages** : hôte (nom Tailscale de bento),
utilisateur `bento-dash`, empreinte du serveur, puis Enregistrer.

## Mises à jour automatiques

Le dépôt est public : l'application lit les releases GitHub sans aucun identifiant, il n'y a rien
à configurer. Elle vérifie 15 secondes après le démarrage, puis toutes les 6 heures, et télécharge
en arrière-plan. Un bandeau propose « Redémarrer pour installer » ; sinon la mise à jour s'installe
à la fermeture. **Réglages, Mises à jour** permet de vérifier à la demande.

Hors ligne ou si GitHub limite les requêtes, l'application l'indique dans les réglages et
réessaie à la prochaine échéance, sans boucle d'erreurs.

### Publier une version

GitHub refuse une release sans tag : le tag `v<version>` doit exister, et être poussé, avant la
publication. Depuis Git Bash, avec `gh` connecté (aucun jeton à manipuler) :

```bash
npm version 1.3.1 --no-git-tag-version      # met à jour "version" dans package.json
git commit -am "chore: bump version to 1.3.1"
git tag v1.3.1
git push origin main v1.3.1
npm run release:win                          # build, puis envoi avec gh
```

`npm run release:win` construit l'installeur puis publie `bento-dashboard-<version>-setup.exe`, son
`.blockmap` et `latest.yml` avec `gh release create` (`scripts/publish-release.mjs`). Il refuse de
publier, en expliquant pourquoi, si un fichier manque, si `latest.yml` annonce une autre version
(build périmé), si le tag n'est pas poussé ou si la release existe déjà. Pour refaire une release :
`gh release delete v1.3.1 --repo Fbrend23/bento-dashboard --yes`, en gardant le tag.

On n'utilise pas le publieur d'electron-builder : il envoie deux fichiers en parallèle et les deux
tentent de créer la release, ce qui échoue (`already_exists`) une fois sur deux.

`npm run build:win` construit l'installeur dans `dist/` sans rien publier.

## Agent sur bento : historique et version mobile

L'agent est **facultatif**, mais sans lui l'écran Historique reste vide : l'application de bureau
n'est pas ouverte en permanence, c'est donc l'agent qui relève bento toutes les 30 secondes et
garde l'historique (une valeur par minute et les incidents, sur 7 jours) dans
`/var/lib/bento-agent/history.json`. Le bureau le lit à la demande, avec une commande figée sans
`sudo`. Un arrêt de l'agent ou de bento apparaît comme un incident « injoignable » une fois
l'agent reparti, et comme un trou dans les courbes. Le téléphone n'affiche pas l'historique.

Pour vérifier bento et redémarrer un conteneur depuis un téléphone, le même agent sert une page web
installable (PWA). Il n'écoute que sur `127.0.0.1` : seul
`tailscale serve` l'expose, sur le tailnet, en HTTPS. Rien n'est stocké sur le téléphone, aucune clé.

L'agent exécute localement les mêmes commandes que l'application de bureau, avec la même liste
blanche réduite à deux choses : le relevé d'état et démarrer, arrêter, redémarrer un conteneur. Pas
de logs ni de notifications sur le téléphone ; les chiffres du système (processeur, mémoire,
disques, disponibilité, charge) viennent du même relevé. Il réutilise l'utilisateur
`bento-dash` et les règles sudoers de l'étape 2 : il n'y a rien à ajouter de ce côté-là.

### Installer l'agent

Sur le poste de développement :

```bash
npm run package:agent   # dist-agent/package/bento-agent-<version>.tar.gz
```

Sur bento (Node 20 ou plus requis : `node --version`) :

```bash
sudo mkdir -p /opt/bento-agent /etc/bento-agent
sudo tar -xzf bento-agent-<version>.tar.gz --strip-components=1 -C /opt/bento-agent
sudo mv /opt/bento-agent/config.example.json /etc/bento-agent/config.json
sudo nano /etc/bento-agent/config.json          # voir ci-dessous
sudo cp /opt/bento-agent/bento-agent.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now bento-agent
sudo tailscale serve --bg --https=443 http://127.0.0.1:8484
```

Les fichiers de `/opt/bento-agent` appartiennent à root : l'agent, qui tourne sous `bento-dash`, ne
peut pas les modifier.

**Node doit être installé pour tout le système**, à l'endroit indiqué par `ExecStart` dans l'unité
(`/usr/bin/node` par défaut). Un Node installé avec nvm vit dans ton dossier personnel, auquel
`bento-dash` n'a pas accès : copie-le dans un emplacement système et pointe l'unité dessus.

```bash
command -v node                                   # où est Node ?
sudo install -m 0755 -o root -g root "$(command -v node)" /usr/local/bin/node
sudo sed -i 's#^ExecStart=/usr/bin/node#ExecStart=/usr/local/bin/node#' /etc/systemd/system/bento-agent.service
sudo -u bento-dash /usr/local/bin/node --version  # doit afficher une version, sans erreur
```

Cette copie ne suit pas les mises à jour de nvm : à refaire quand tu changes de version.

### Mettre à jour l'agent

**Première mise à jour qui apporte l'historique** : l'unité installée doit recevoir deux lignes
(le script ci-dessous ne la réinstalle pas). À faire sur bento, de préférence avant le déploiement ;
sans elles l'agent fonctionne mais ne peut pas écrire l'historique.

```bash
sudo sed -i '/^Environment=BENTO_AGENT_STATIC/a StateDirectory=bento-agent\nEnvironment=BENTO_AGENT_HISTORY=/var/lib/bento-agent/history.json' /etc/systemd/system/bento-agent.service
sudo systemctl daemon-reload && sudo systemctl restart bento-agent
ls -ld /var/lib/bento-agent                       # propriétaire : bento-dash
```

Ensuite, depuis le poste de développement :

```bash
npm run deploy:agent                  # hôte ssh « bento » par défaut
npm run deploy:agent -- <alias-ssh>   # ou BENTO_DEPLOY_HOST=<alias-ssh>
```

Le script empaquette l'agent, le copie par `scp` dans un dossier temporaire de bento, remplace
`/opt/bento-agent/bento-agent.cjs` et `/opt/bento-agent/public`, redémarre le service et vérifie
qu'il répond 403 sans identité Tailscale. Il ne touche ni à `/etc/bento-agent/config.json` ni à
l'unité systemd installée (qui garde ton chemin vers Node) : si l'unité du paquet a changé, il
l'indique et tu la reportes à la main. Le compte ssh doit pouvoir faire `sudo` (le mot de passe
est demandé dans le terminal si besoin). La première installation reste celle ci-dessus.

`/etc/bento-agent/config.json` :

| Champ | Rôle |
| --- | --- |
| `allowedLogin` | **Obligatoire.** Ton identifiant Tailscale (celui affiché dans l'application Tailscale). Toute autre personne reçoit 403. |
| `allowedOrigin` | Adresse HTTPS de la page, par exemple `https://bento.<ton-tailnet>.ts.net`. À renseigner si `tailscale serve` ne transmet pas le nom d'hôte d'origine ; sinon il est déduit de l'en-tête `Host`. |
| `port` | Port local, 8484 par défaut. Doit être le même que dans la commande `tailscale serve`. |
| `containerLabels`, `stackLabels` | Noms affichés, comme dans Réglages, Conteneurs. |
| `hiddenContainers` | Conteneurs à ne pas afficher. |
| `diskThresholdPercent` | Seuil d'un disque plein pour les incidents de l'historique, entre 1 et 100 (85 par défaut, comme dans Réglages). |

L'unité systemd n'active **pas** `NoNewPrivileges` : toutes les commandes passent par `sudo -n`, qui
cesserait de fonctionner sans message clair.

Prérequis Tailscale : MagicDNS et les certificats HTTPS doivent être activés pour le tailnet (console
d'administration, DNS). Sans HTTPS, la page s'affiche mais ne peut pas s'installer.

### Sur le téléphone

Avec l'application Tailscale connectée, ouvrir `https://bento.<ton-tailnet>.ts.net/` dans Chrome,
puis menu ⋮ → « Ajouter à l'écran d'accueil ». La page demande l'état à l'agent quand elle est
ouverte (toutes les 30 secondes) et ne demande rien quand elle est en arrière-plan ; l'agent, lui,
relève bento en continu pour l'historique.

Arrêter et redémarrer demandent une confirmation dans la page ; démarrer non, comme sur le bureau.
Un arrêt ou un redémarrage lancé depuis le téléphone fait aussi apparaître la notification « service
tombé » sur le PC, qui ne sait pas que c'était voulu.

## Développement

```bash
npm install
npm run dev        # lancement en développement
npm test           # tests Vitest
npm run lint
npm run typecheck
npm run build      # build de production
npm run build:win  # installeur Windows (dist/)
npm run build:agent    # agent de bento en un seul fichier (dist-agent/)
npm run build:mobile   # page du téléphone (dist-mobile/)
npm run package:agent  # archive prête à copier sur bento
```

Le développement se fait test d'abord. Les moniteurs sont une commande fixe plus une fonction de
parsing pure, testée sur des sorties réelles anonymisées (`tests/fixtures/`).

```
src/
├── main/          processus principal : fenêtre, tray, notifications, IPC, SSH
│   ├── ssh/       client ssh2 unique, reconnexion, liste blanche de commandes
│   ├── monitors/  services, métriques, logs
│   ├── actions/   redémarrage de Jellyfin
│   ├── updater/   mises à jour depuis les releases GitHub
│   └── …
├── preload/       contextBridge : window.bento, API minimale et typée
├── renderer/      Vue 3 + Pinia, aucune API Node
├── agent/         agent de bento (historique et version mobile) : relevé continu, session locale, serveur HTTP, authentification
├── mobile/        page du téléphone, Vue 3
└── shared/        types et fonctions pures partagés
```

## Sécurité

Résumé des protections en place.

- Fenêtres : `contextIsolation`, `sandbox`, pas de `nodeIntegration`, CSP stricte, aucune ressource distante.
- Le preload n'expose que des fonctions précises, jamais `ipcRenderer`.
- Les commandes SSH sont une liste fixe dans `src/main/ssh/commands.ts`, appliquée avant tout envoi.
  Rien n'est construit à partir d'une saisie ou d'une donnée reçue.
- Les seules actions d'écriture sont démarrer, arrêter et redémarrer un conteneur existant, par un
  script validé sur bento ; arrêter et redémarrer demandent une confirmation native du processus
  principal.
- Les journaux d'un conteneur ne se lisent que s'il est choisi dans les réglages, présent dans le
  dernier relevé ; le script `bento-docker-logs` sur bento revalide le nom et ne lit que les 200
  dernières lignes.
- Agent mobile : il n'écoute que sur `127.0.0.1` et chaque requête doit porter l'identité Tailscale
  autorisée (`allowedLogin`), sinon 403. Une action n'est acceptée que depuis sa propre page (pas de
  CORS, JSON seulement, en-tête `X-Bento-Agent`, `Origin` et `Sec-Fetch-Site` vérifiés), avec un
  corps de 1 Ko au plus : deux textes, validés comme sur le bureau.
- Aucun secret : l'application n'en stocke aucun, la clé SSH reste dans l'agent Windows.
- Le dépôt est public : aucune adresse, clé, nom de machine ou de conteneur réel n'y figure.

## Dépannage

| Symptôme | Piste |
| --- | --- |
| « Règle sudoers manquante pour bento-dash » | Une des lignes sudoers manque ou diffère d'un caractère |
| Connexion refusée dès le départ | L'empreinte enregistrée ne correspond pas : la recopier depuis bento |
| Hors ligne en permanence | Tailscale actif sur les deux machines ? Clé ajoutée à l'agent Windows (`ssh-add -l`) ? |
| « GitHub refuse la vérification » | Trop de requêtes depuis cette adresse : réessayer plus tard |
| Journaux d'un conteneur : « Règle sudoers manquante » ou « Conteneur introuvable » | Installer `bento-docker-logs` et sa ligne sudoers (voir plus haut) ; vérifier que le nom réglé est celui de `docker ps -a` |
| Pas de mise à jour en `npm run dev` | Normal : elles n'existent que dans l'application installée |
| `bento-agent` échoue avec `status=203/EXEC` | systemd ne trouve pas ou ne peut pas lancer Node : vérifier le chemin dans `ExecStart` et que `sudo -u bento-dash <chemin> --version` répond (un Node sous `/home` ou nvm ne convient pas) |
| Téléphone : « Accès refusé » ou « Ce téléphone n'est pas autorisé » | `allowedLogin` ne correspond pas à l'identifiant exact vu par Tailscale : le lire avec `tailscale whois <adresse 100.x du téléphone>` (ligne `User:`), majuscules comprises |
| Téléphone : les actions sont refusées, la lecture marche | `allowedOrigin` manque ou diffère de l'adresse affichée dans le navigateur |
| Téléphone : « Bento est injoignable » | Tailscale connecté sur le téléphone ? `systemctl status bento-agent` et `tailscale serve status` sur bento |
