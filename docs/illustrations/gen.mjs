// Widget contents for the generated illustrations, built by the real code of
// the integration: the app itself (src/app.js) wired to the fake Gladys of the
// SDK and the fake Somfy cloud and TaHoma box of the tests (real local
// sockets, real TLS), on a made-up evening: the living room shutter is
// two-thirds open, the terrace screen is out, the box is reached on the local
// network. Device and scenario names are translated for each language (on a
// real box, they are the names given in the TaHoma app).
// A gauge bound to a device feature shows the last published state, as the
// Gladys front does (the core fills it in from the feature).
// Written as JSON for render.js: node gen.mjs <repo> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const { LANGUAGES } = await load('src/i18n.js');
const { setup, device, LIVING, KITCHEN, SCREEN } = await load('test/helpers.js');

const manifest = JSON.parse(readFileSync(join(repo, 'gladys-assistant-integration.json'), 'utf8'));

const NAMES = {
  [LIVING]: { en: 'Living room', fr: 'Salon', de: 'Wohnzimmer', es: 'Salón' },
  [KITCHEN]: { en: 'Kitchen', fr: 'Cuisine', de: 'Küche', es: 'Cocina' },
  'io://1234-5678-9012/10042836': {
    en: 'Pool pump',
    fr: 'Pompe piscine',
    de: 'Poolpumpe',
    es: 'Bomba piscina',
  },
  [SCREEN]: {
    en: 'Terrace screen',
    fr: 'Store terrasse',
    de: 'Terrassen-Screen',
    es: 'Toldo terraza',
  },
  'io://1234-5678-9012/15097783': {
    en: 'Office window',
    fr: 'Velux bureau',
    de: 'Bürofenster',
    es: 'Ventana despacho',
  },
  'io://1234-5678-9012/1166863': {
    en: 'Garage door',
    fr: 'Porte de garage',
    de: 'Garagentor',
    es: 'Puerta del garaje',
  },
  'rts://1234-5678-9012/16757362': {
    en: 'Living curtain',
    fr: 'Rideau salon',
    de: 'Vorhang',
    es: 'Cortina salón',
  },
};
const SCENARIOS = {
  'Je pars': { en: 'Leaving home', fr: 'Je pars', de: 'Ich gehe', es: 'Me voy' },
  Bonjour: { en: 'Good morning', fr: 'Bonjour', de: 'Guten Morgen', es: 'Buenos días' },
};
const EXTRA = [
  { en: 'Good night', fr: 'Bonne nuit', de: 'Gute Nacht', es: 'Buenas noches' },
  { en: 'Summer heat', fr: 'Canicule', de: 'Sommerhitze', es: 'Ola de calor' },
];

/**
 * @description One language: the cover widget, the box and the scenarios.
 * @param {string} language - Language.
 * @returns {Promise<object>} The widget contents.
 */
async function contents(language) {
  const run = await setup({
    config: {
      username: 'user@example.com',
      password: 'secret-password',
      local_token: 'local-token-0123456789',
      language,
    },
    before: (server) => {
      const { setup: box, actionGroups } = server.installation;
      for (const item of box.devices) {
        if (NAMES[item.deviceURL]) {
          item.label = NAMES[item.deviceURL][language];
        }
        const set = (name, value) => {
          const state = item.states?.find((entry) => entry.name === name);
          if (state) {
            state.value = value;
          }
        };
        if (item.deviceURL === LIVING) {
          set('core:ClosureState', 35);
          set('core:OpenClosedState', 'open');
          set('core:Memorized1PositionState', 40);
        }
        if (item.deviceURL === SCREEN) {
          set('core:ClosureState', 0);
        }
      }
      for (const group of actionGroups) {
        if (SCENARIOS[group.label]) {
          group.label = SCENARIOS[group.label][language];
        }
      }
      for (const [index, names] of EXTRA.entries()) {
        actionGroups.push({
          ...structuredClone(actionGroups[0]),
          label: names[language],
          oid: `00000000-0000-4000-8000-00000000000${index}`,
        });
      }
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  await run.app.flushStates();
  const get = async (key, settings) =>
    (await run.fake.widgetGet(key, { settings, language })).data.content;
  const cover = await get('cover', { device: device(LIVING) });
  const overview = await get('overview', {});
  const scenarios = await get('scenarios', {});
  for (const component of cover.components) {
    if (component.type === 'gauge' && component.device_feature) {
      component.value = run.fake.lastState(component.device_feature);
      component.unit = '%';
    }
  }
  await run.stop();
  return { cover, overview, scenarios };
}

const all = {};
for (const language of LANGUAGES) {
  all[language] = await contents(language);
}

const card = (key) => {
  const widget = manifest.widgets.find((item) => item.key === key);
  return { icon: widget.icon, label: widget.label };
};
writeFileSync(
  out,
  JSON.stringify({
    contents: all,
    images: {},
    cards: { cover: card('cover'), overview: card('overview'), scenarios: card('scenarios') },
  }),
);
