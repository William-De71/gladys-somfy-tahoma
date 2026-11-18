# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for the **Somfy TaHoma** boxes
(TaHoma, TaHoma Switch, TaHoma Beecon, Connexoon): a Node.js service (Node
22+, ESM, no build step; only dependency: the SDK) in its own sandboxed
Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to the box through **two channels** (`transports: ["local", "cloud"]`):

- the **local API of the Developer Mode**
  ([Somfy-Developer/Somfy-TaHoma-Developer-Mode](https://github.com/Somfy-Developer/Somfy-TaHoma-Developer-Mode)):
  `https://<box>:8443/enduser-mobile-web/1/enduserAPI/`, Bearer token,
  certificate of the Overkiz root CA (`src/overkiz/overkiz-root-ca-2048.pem`);
- the **Somfy cloud**: password grant on
  `accounts.somfy.com/oauth/oauth/v2/token/jwt` (client id and secret of the
  TaHoma app, from pyoverkiz), then Bearer on
  `ha101-1.overkiz.com` / `ha401-1` / `ha201-1`.

A **device integration** (`type: "device"`, Gladys 5.3.0+). The Overkiz client
in `src/overkiz/` was written from the Somfy documentation, pyoverkiz (MIT)
and the Home Assistant Overkiz integration (Apache 2.0): see NOTICE.

The store already has cicoub13/gladys-overkiz (cloud only, Cozytouch, Flexom,
Rexel, Hitachi too). This one is Somfy only and adds the local mode.

## Commands

```bash
npm install
npm test                                  # node --test, never leaves 127.0.0.1
node --test test/app.test.js              # one file
node --test --test-name-pattern "fallback" # tests whose name matches
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/discovery.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check
docs/illustrations/render.sh              # widget illustrations (Chrome, ImageMagick, Pillow)
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg (Inkscape, ImageMagick)
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js                     SDK wiring only: createApp(gladys) + connect + start
src/app.js                   every handler: discovery, transports, status, commands,
                             scene events and actions, widgets, configuration buttons
src/box.js                   the box: channel choice and fallback, event listener loop,
                             resync, scenarios, local token creation
src/devices.js               TaHoma device -> Gladys device (features), values, commands
src/states.js                state publication: created devices only, coalesced, 240/min, 429 pause
src/scenes.js                scene trigger / action keys, data, failures of an execution
src/widgets.js               the `cover`, `overview` and `scenarios` widgets (pure)
src/i18n.js                  runtime texts in en / fr / de / es
src/storage.js               JSON files in /data (box.json, scenarios.json, local-token.json)
src/config.js                config_schema -> normalized configuration, what changed
src/overkiz/clients.js       cloud client (tokens) and local client (TLS), shared enduser calls
src/overkiz/http.js          node:https requests, Overkiz error kinds (pyoverkiz mapping)
src/overkiz/model.js         setup JSON -> devices, state types, covers, positions
src/overkiz/discovery.js     mediated mDNS scan (_kizboxdev._tcp), typed address
test/helpers/fake-overkiz.js fake Somfy cloud (HTTP) and fake box (HTTPS, test CA)
test/fixtures/               setup and scenarios from pyoverkiz fixtures, TLS test certificates,
                             discovery baseline
.github/scripts/release.mjs  version, changelog, version files, PR title checks
```

## Rules

- **External ids are forever**: `ext:{selector}:device:<platform id>`, the
  platform id being the deviceURL lowercased with only letters, digits and
  dashes (`io://1234-5678-9012/12184029#2` -> `io-1234-5678-9012-12184029-2`),
  the same through both channels;
  `…:<feature key>` (`state`, `position`, `tilt`, `light`, `brightness`,
  `switch`, `temperature`, `luminance`, `humidity`, `contact`, `motion`,
  `smoke`, `leak`, `battery`, `co2`, `power`, `energy`). Config, action, field,
  widget, trigger, variable, output keys and select values too.
  `test/structure.test.js` pins them in `test/fixtures/discovery.baseline.json`:
  never rewrite the baseline to make a test pass.
- **Positions**: Gladys counts how open (100 % = open). Overkiz
  `core:ClosureState` is inverted (`setClosure(100 - x)`), an awning's
  `core:DeploymentState` is not; slats (`core:SlateOrientationState`) are
  inverted like Home Assistant does. 108 ("My") and 124 (unknown) are not
  positions.
- **Covers** follow the Home Assistant choices: `open`/`close` first, then
  `up`/`down`, `deploy`/`undeploy` for awnings, `cycle` for one-button
  openers. Stop: `stop`, or "My" only while the motor moves (a still motor
  would go to its favourite position).
- **Channels**: the preferred one (`GLADYS_PREFER_LOCAL`, true by default)
  first, the other as fallback, published as a degraded transport with its
  reason; the preferred one probed every 5 minutes. A device with no channel
  is `unreachable`.
- **Be polite with Somfy**: one password login per session (the refresh
  token renews the access token), events fetched every 30 s on the cloud
  (2 s for a minute after a command), a minute of pause on a rate limit, 30
  minutes on refused credentials. Local: fetch every 2 s (Somfy: "once every
  second at most"), setup every 10 minutes.
- **Secrets**: password and local token are `secret` fields; the cloud tokens
  stay in memory; nothing secret is ever logged.
- **Scene events**: one per transition; `command_failed` never for an
  execution started by a scene action (no loops); the box is "offline" after
  a minute without a channel.
- **The container rootfs is read-only**: the only writable folder is /data.
- **Widget content**: after any change, run `docs/illustrations/render.sh` and
  look at the four images. Budget: 2 texts, 1 focal, 6 tiles, 1 status, 4
  buttons; button action keys unique in a content (`run_1`…`run_4`).
- **User-facing text** exists in en, fr, de and es: manifest, `src/i18n.js`,
  `docs/*.md`, `README*.md`. `test/i18n.test.js` checks it.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, `package-lock.json` or the manifest, nor the `docker_image`
  tag. The version stays below 1.0.0 until the maintainer runs the Release
  workflow with `release-as: 1.0.0`.
- **Changelog**: never edit CHANGELOG.md by hand, it is generated at the
  release. Write the PR title as the line the user will read.
- **Commits and PR titles** follow Conventional Commits, in English.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

## Pitfalls

- The local API has **no scenarios** (no `/actionGroups`): they are read on
  the cloud and replayed locally with `exec/apply` (commands only, no delays).
- The local API refuses an execution mode (`exec/apply/<mode>`): never send one.
- A wrong local token answers 401 "Not authenticated." like an expired cloud
  session: the local client turns it into a credentials error.
- Cloud event values are strings with their type (`{"type":1,"value":"30"}`);
  local ones are native. `castState` handles both.
- The box is reached by IP (no mDNS resolver in the container): the default
  hostname check would fail; `boxIdentityCheck` only refuses a certificate
  naming another PIN, the chain is checked against the Overkiz CA.
- mDNS: only the TXT `gateway_pin` identifies a box (Somfy's warning); the
  SDK lowercases TXT keys.
- An event listener dies after 10 minutes without a fetch or a reboot of the
  box: register again and read the setup.
- `ExteriorScreen` has both closure and deployment states: closure wins (HA).
- Gladys does not send the user's language with a scan or a command: feature
  names and scene errors use the `language` setting.
- Never tested on a real box: when a user reports a difference, fix the fake
  box or cloud in `test/helpers/` first, then the code.
