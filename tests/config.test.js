'use strict';

/**
 * config.test.js — engine/config.js's phone address: "phone" in louise.config.json wins over door.phone in agent.json,
 * a bare host name is accepted, and an address that cannot be read is refused in plain words.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const config = require('../engine/config');
const { tmpdir, write } = require('./fixtures');

function home(agent, cfg) {
  const h = tmpdir('config');
  write(path.join(h, 'agent.json'), JSON.stringify(agent));
  if (cfg) write(path.join(h, 'louise.config.json'), JSON.stringify(cfg));
  return h;
}

test('the phone address comes from louise.config.json first, then agent.json', () => {
  const agent = { door: { local: 'http://127.0.0.1:7540/', phone: 'https://laptop.example-tailnet.ts.net/' } };
  assert.equal(config.load({ home: home(agent) }).phoneHost, 'laptop.example-tailnet.ts.net');
  assert.equal(config.load({ home: home(agent, { phone: 'https://desk.example-tailnet.ts.net:8444/' }) }).phoneHost, 'desk.example-tailnet.ts.net');
  assert.equal(config.load({ home: home({ door: { phone: null } }, { phone: 'Desk.Example-Tailnet.ts.net' }) }).phoneHost, 'desk.example-tailnet.ts.net');
  assert.equal(config.load({ home: home({ door: { phone: null } }) }).phoneHost, null);
});

test('a phone address that cannot be read is refused', () => {
  assert.throws(() => config.load({ home: home({}, { phone: 'https://' }) }), /"phone" in louise\.config\.json/);
});
