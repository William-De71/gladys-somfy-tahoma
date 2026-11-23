// The overview widget past the 8 cards the core shows: which covers keep a
// card, the card naming the others, the `names` setting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import {
  buildCoverWidget,
  buildOverviewWidget,
  chooseCovers,
  splitCovers,
  OVERVIEW_TTL_SECONDS,
  TTL_SECONDS,
} from '../src/widgets.js';

const cover = (name, state, extra = {}) => ({
  deviceId: name,
  name,
  reachable: true,
  curtain: false,
  toggle: false,
  state,
  moving: false,
  position: state === 1 ? 100 : state === -1 ? 0 : 40,
  tilt: null,
  myPosition: null,
  hasStop: true,
  hasMy: true,
  features: { state: `${name}:state`, position: `${name}:position` },
  ...extra,
});

const box = {
  pin: '1234',
  transport: 'local',
  degraded: false,
  configured: true,
  firmware: '2026.5.3-5',
  devices: 25,
  unavailable: [],
};
const cards = (content) => content.components.find((item) => item.type === 'card-list').items;
const caption = (content) => content.components.find((item) => item.type === 'text').text;

// The forum case: 7 roller shutters and 3 roof windows, 6 open.
const TEN = [
  cover('Chambre bas', -1),
  cover('Chambre haut rue', -1),
  cover('Chambre jardin', 1),
  cover('Fenêtre cuisine', 1),
  cover('Porte fenêtre jardin', 1),
  cover('Salle à manger', 1),
  cover('Salon', 1),
  cover('Velux centre', -1),
  cover('Velux est', 0),
  cover('Velux ouest', -1),
];

test('overview: up to 8 covers, every one has a card', () => {
  const content = buildOverviewWidget({ covers: TEN.slice(0, 8), box });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(cards(content).length, 8);
  assert.deepEqual(splitCovers(TEN.slice(0, 8)).hidden, []);
});

test('overview: past 8, the 7 that matter most, in order, and the others named', () => {
  const content = buildOverviewWidget({ covers: TEN, box });
  assert.deepEqual(validateWidgetContent(content), []);
  const items = cards(content);
  assert.equal(items.length, 8);
  assert.deepEqual(
    items.slice(0, 7).map((item) => item.title),
    [
      'Chambre bas',
      'Chambre jardin',
      'Fenêtre cuisine',
      'Porte fenêtre jardin',
      'Salle à manger',
      'Salon',
      'Velux est',
    ],
  );
  assert.equal(items[7].title.fr, '+ 3 autre(s) volet(s)');
  assert.equal(items[7].subtitle, 'Chambre haut rue, Velux centre, Velux ouest');
  // The summary still counts every cover.
  assert.equal(caption(content).fr, '5 ouvert(s) sur 10');
});

test('overview: moving and not answering before closed', () => {
  const covers = [
    ...Array.from({ length: 8 }, (_, index) => cover(`Fermé ${index + 1}`, -1)),
    cover('Muet', null, { reachable: false }),
    cover('Bouge', -1, { moving: true }),
  ];
  const { shown, hidden } = splitCovers(covers);
  assert.deepEqual(
    shown.map((view) => view.name),
    ['Fermé 1', 'Fermé 2', 'Fermé 3', 'Fermé 4', 'Fermé 5', 'Muet', 'Bouge'],
  );
  assert.deepEqual(
    hidden.map((view) => view.name),
    ['Fermé 6', 'Fermé 7', 'Fermé 8'],
  );
});

test('overview: the names setting picks and orders the covers', () => {
  assert.deepEqual(
    chooseCovers(TEN, ' velux ouest, Salon ,inconnu, salon').map((view) => view.name),
    ['Velux ouest', 'Salon'],
  );
  const content = buildOverviewWidget({ covers: TEN, box, names: 'Velux ouest, Salon' });
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(
    cards(content).map((item) => item.title),
    ['Velux ouest', 'Salon'],
  );
  assert.equal(caption(content).fr, '1 ouvert(s) sur 2');
  const none = buildOverviewWidget({ covers: TEN, box, names: 'Garage' });
  assert.deepEqual(validateWidgetContent(none), []);
  assert.match(caption(none).fr, /Aucun des volets nommés/);
  assert.equal(
    none.components.some((item) => item.type === 'card-list'),
    false,
  );
});

test('widgets: long cache, every change asks for a refresh', () => {
  assert.equal(TTL_SECONDS, 3600);
  assert.equal(OVERVIEW_TTL_SECONDS, 3600);
  assert.equal(buildCoverWidget(TEN[0]).ttl_seconds, 3600);
});
