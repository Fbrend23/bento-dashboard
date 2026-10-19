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
bento-dash ALL=(root) NOPASSWD: /usr/bin/docker logs --tail 200 jellyfin
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

**Journaux d'un conteneur.** Une ligne `docker logs --tail 200 <nom>` par conteneur, **sans joker**
(l'exemple ci-dessus donne Jellyfin). Pour en ajouter un : cocher le conteneur dans **Réglages,
Conteneurs, Conteneurs dont on lit les journaux**, puis ajouter sa ligne sudoers sur bento. L'app
ne lit que les conteneurs cochés *et* présents dans le dernier relevé ; sans la règle sudoers,
bento refuse et l'écran des journaux affiche « Ce conteneur n'a pas de règle sudoers ». La règle
reste la vraie barrière : cocher un conteneur ne donne aucun droit à lui seul.

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

## Développement

```bash
npm install
npm run dev        # lancement en développement
npm test           # tests Vitest
npm run lint
npm run typecheck
npm run build      # build de production
npm run build:win  # installeur Windows (dist/)
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
  dernier relevé, et couvert par sa propre règle sudoers sur bento.
- Aucun secret : l'application n'en stocke aucun, la clé SSH reste dans l'agent Windows.
- Le dépôt est public : aucune adresse, clé, nom de machine ou de conteneur réel n'y figure.

## Dépannage

| Symptôme | Piste |
| --- | --- |
| « Règle sudoers manquante pour bento-dash » | Une des lignes sudoers manque ou diffère d'un caractère |
| Connexion refusée dès le départ | L'empreinte enregistrée ne correspond pas : la recopier depuis bento |
| Hors ligne en permanence | Tailscale actif sur les deux machines ? Clé ajoutée à l'agent Windows (`ssh-add -l`) ? |
| « GitHub refuse la vérification » | Trop de requêtes depuis cette adresse : réessayer plus tard |
| « Ce conteneur n'a pas de règle sudoers » | Ajouter sa ligne `docker logs --tail 200 <nom>` (voir plus haut) |
| Pas de mise à jour en `npm run dev` | Normal : elles n'existent que dans l'application installée |
