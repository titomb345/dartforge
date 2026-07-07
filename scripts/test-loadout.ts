/**
 * Loadout tracker regression test — feeds REAL output excerpts from Bill's
 * session logs (x me snapshot, equip held block, summon/dismiss, wear/
 * remove, the stow sequence, hold+Okay pairing) and asserts the resulting
 * hands/worn state.
 *
 * Usage: npx tsx scripts/test-loadout.ts
 */
import { LoadoutTracker, isHandLimb } from '../src/lib/loadout';
import { OutputFilter } from '../src/lib/outputFilter';

let t = 0;
let failed = 0;
const tracker = new LoadoutTracker();

const cmd = (c: string) => tracker.onCommand(c, (t += 1000));
const line = (l: string) => tracker.onLine(l, (t += 1000));
const lines = (block: string) => block.split('\n').forEach((l) => line(l));

function check(what: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${what}`);
  if (!cond) failed = 1;
}

const heldOn = (limb: string) =>
  tracker.state.limbs.find((l) => l.limb === limb)?.held.map((h) => h.name) ?? [];
const wornAnywhere = (name: string) =>
  tracker.state.wornLoose.some((n) => n.includes(name)) ||
  tracker.state.limbs.some((l) => l.worn.some((n) => n.includes(name)));

// --- 1. Full examine-self snapshot (verbatim from session_2026-07-04;
// `view me` is what Bill's `x me` alias expands to) ---------------------------
cmd('view me');
lines(`He is an overgrown arachnid with four legs, four arms, eight black eyes, white
fur, and dripping mandibles.  He looks like a strong warrior.  An intense amber
four-pointed star glows brightly at the center of his chest.  He is wearing a
silver-trimmed red silk sash bearing a silver tiger insignia with silver, iron,
copper, steel, gold, and brass medals pinned to it, an aberrant iron torc, a
shadowsilk shirt, a set of shadowsilk pants, a spinel-decorated mythril torc, a
spinel ring, and a pair of leather boots.  He is a middle aged spyder and about
your size.
He is in perfect health.  He has:
body             (in perfect health):
                   - an amulet (worn)
                   - a zinc keyring (worn)
                   - a large iron key (worn)
                   - an open shadowsilk moneybag (worn)
                   - an open eye-piercing blade-embossed purple sandworm leather scrip (worn)
                   - a glowstone (worn)
                   - an open eye-piercing blade-embossed purple sandworm leather backpack (worn)
                   - an eye-piercing blade-embossed purple sandworm leather scrollcase (worn)
                   - an open small black bag (worn)
head             (in perfect health):
                   - a crooked wizard's hat (worn)
upper left hand  (in perfect health):
                   - a bloody axe
                   - a dragon metal and purple diamond charm bracelet (worn) with a red diamond and white gold drop spindle charm, a turquoise and golden metal anvil charm, a green diamond and black steel needle charm, and many other trinkets on it
upper right hand (in perfect health):
lower left hand  (in perfect health):
lower right hand (in perfect health):
left foreleg     (in perfect health):
right foreleg    (in perfect health):
left hind leg    (in perfect health):
right hind leg   (in perfect health):`);
const endChange = line('Eye of the Temple'); // foreign line ends the block

// THE live bug: the commit fired but onLine reported 'none', so React never
// re-rendered — the panel looked completely dead.
check('x me: block end is REPORTED as a change', endChange === 'snapshot');
check('x me: 10 limbs learned', tracker.state.limbs.length === 10);
check('x me: 4 hand limbs', tracker.state.limbs.filter((l) => isHandLimb(l.limb)).length === 4);
check('x me: axe held upper left', heldOn('upper left hand')[0] === 'a bloody axe');
check('x me: other hands empty', heldOn('upper right hand').length === 0);
check(
  'x me: bracelet worn on limb, not held',
  tracker.state.limbs.some((l) => l.worn.some((n) => n.includes('charm bracelet')))
);
check('x me: body worn items', wornAnywhere('glowstone') && wornAnywhere('backpack'));
check(
  'x me: clothing prose parsed',
  wornAnywhere('shadowsilk shirt') && wornAnywhere('leather boots')
);
// The sash's own text contains a comma list ("with silver, iron, copper,
// steel, gold, and brass medals pinned to it") — it must stay ONE item.
check(
  'prose: sash with inner commas stays one item',
  tracker.state.wornLoose.some((n) => n.includes('medals pinned to it'))
);
check(
  'prose: no comma-shrapnel items',
  !tracker.state.wornLoose.some((n) => /^(?:silver|iron|copper|steel|gold)$/.test(n.trim()))
);
check('prose: exactly 7 clothing items', tracker.state.wornLoose.length === 7);
check('x me: hands not stale', tracker.state.handsStale === false);
check(
  'x me: limb health captured',
  tracker.state.limbs.every((l) => l.health === 'in perfect health')
);

// --- 2. Hands are never guessed: deltas only flag unverified ----------------
// (Bill: the interim guesses were always wrong — a dismissal of one of
// three tonfas wiped all three, holds picked arbitrary hands. Deltas now
// only mark handsStale; the hook then fires a silent gagged eq.)
line(
  'You gesture and an eye-piercing blade-embossed purple sandworm leather heater shield appears in your upper right hand!'
);
check('summon does NOT guess a placement', heldOn('upper right hand').length === 0);
check('summon flags hands unverified', tracker.state.handsStale === true);

tracker.state.handsStale = false;
check('hold command requests a verify', cmd('hold chain in lower left hand and lower right hand'));
check('hold flags hands unverified', tracker.state.handsStale === true);
check('view me does not request a verify', !cmd('view me'));
tracker.flush((t += 20_000)); // discard the armed examine capture

tracker.state.handsStale = false;
line(
  'You gesture and an eye-piercing blade-embossed purple sandworm leather heater shield dissolves into mist and vanishes!'
);
check('dismissal flags hands unverified', tracker.state.handsStale === true);

// --- 3. equip held block (verbatim shape) — the source of truth -------------
cmd('equip held');
line('upper left hand: a bloody axe');
line('lower left hand: a dragon bone tonfa');
const eqEnd = line('You gaze at your surroundings.'); // ends the block
check('eq: block end is REPORTED as a change', eqEnd === 'snapshot');
check(
  'eq: listed limbs set',
  heldOn('upper left hand')[0] === 'a bloody axe' &&
    heldOn('lower left hand')[0] === 'a dragon bone tonfa'
);
check('eq: omitted hands emptied', heldOn('lower right hand').length === 0);
check('eq: clears stale flag', tracker.state.handsStale === false);
// The tonfa was never seen appearing via a summon — no badge...
check(
  'eq: non-summoned item unbadged',
  tracker.state.limbs.find((l) => l.limb === 'lower left hand')!.held[0].summoned === false
);
// ...but after a summon message, the next snapshot badges it.
line('You gesture and a dragon bone tonfa appears in your lower right hand!');
cmd('equip held');
line('upper left hand: a bloody axe');
line('lower left hand: a dragon bone tonfa');
line('lower right hand: a dragon bone tonfa');
line('You gaze at your surroundings.');
check(
  'eq: summoned name badges snapshot items',
  tracker.state.limbs.find((l) => l.limb === 'lower right hand')!.held[0].summoned === true
);

// In a quiet room no foreign line arrives — the idle flush must commit.
cmd('equip held');
line('upper right hand: a mythril longsword');
check('eq: no commit before the block ends', heldOn('upper right hand').length === 0);
check('eq: flush commits the pending block', tracker.flush((t += 2000)) === 'snapshot');
check('eq: flushed hand is set', heldOn('upper right hand')[0] === 'a mythril longsword');
check('eq: nothing pending after flush', tracker.hasPendingCapture === false);

// --- 4. Wear / remove / stow (verbatim from the stow sequence) ---------------
tracker.state.handsStale = false;
line('You take a dagger from the chest');
check('take flags hands unverified', tracker.state.handsStale === true);
line('You wear a dagger.');
check('wear adds to worn', wornAnywhere('dagger'));

line('You remove your hood and put it in the chest.');
line('You remove an open shadowsilk moneybag.');
check('bare remove drops from worn', !wornAnywhere('moneybag'));
line('You put an open shadowsilk moneybag (worn) in an open iron-bound oak chest.');
check('worn moneybag still gone after stow', !wornAnywhere('moneybag'));

tracker.state.handsStale = false;
line('You drop a mythril longsword.');
check('drop flags hands unverified', tracker.state.handsStale === true);
// The last snapshot (the flush) put the longsword in the upper right hand —
// the drop must NOT guess it away; the auto-verify eq is the authority.
check('drop does NOT guess a removal', heldOn('upper right hand')[0] === 'a mythril longsword');

// --- 5. Serialization round-trip ---------------------------------------------
const revived = LoadoutTracker.deserialize(tracker.serialize());
check(
  'serialize/deserialize keeps limbs + worn',
  revived.state.limbs.length === tracker.state.limbs.length &&
    revived.state.wornLoose.length === tracker.state.wornLoose.length
);
check('reload marks hands approximate', revived.state.handsStale === true);

// --- 6. Equip sync gag: background re-syncs must not spam the terminal ------
{
  const seenByParsers: string[] = [];
  const filter = new OutputFilter({
    onLine: (stripped) => {
      seenByParsers.push(stripped);
      return undefined;
    },
  });
  filter.startEquipSync();
  const shown = filter.filter(
    'upper left hand: a bloody axe\r\n' +
      'lower left hand: a large black steel great chain\r\n' +
      'A rabbit hops in from the west.\r\n'
  );
  check('gag: eq lines suppressed from terminal', !shown.includes('bloody axe'));
  check('gag: unrelated line still shown', shown.includes('rabbit'));
  check(
    'gag: parsers still saw the eq lines',
    seenByParsers.some((l) => l.includes('bloody axe')) &&
      seenByParsers.some((l) => l.includes('great chain'))
  );

  // Without an armed sync, typed eq output passes through untouched
  const filter2 = new OutputFilter({ onLine: () => undefined });
  const shown2 = filter2.filter('upper left hand: a bloody axe\r\n');
  check('gag: typed eq output is NOT gagged', shown2.includes('bloody axe'));
}

console.log(failed ? '\nFAILURES above' : '\nAll loadout tracker checks passed');
process.exit(failed);
