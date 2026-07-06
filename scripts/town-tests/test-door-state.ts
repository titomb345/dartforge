/**
 * Regression test: open/closed door state in the exits parser.
 * The auto-walker leaves doors it found standing open untouched (no
 * close/lock behind), so parseTownExits must report which door dirs are
 * open ("an open oak door leading east") vs closed/unknown. Phrases
 * without an explicit "open" default to closed — the safe, old behavior.
 */
import { parseTownExits } from '../../src/lib/townParser';

let fail = false;
const check = (sentence: string, expected: { doorDirs: string[]; openDoorDirs: string[] }) => {
  const got = parseTownExits(sentence);
  const eq = (a: string[], b: string[]) => a.join(',') === b.join(',');
  if (!eq(got.doorDirs, expected.doorDirs) || !eq(got.openDoorDirs, expected.openDoorDirs)) {
    console.error(
      `FAIL: "${sentence}"\n  doors=[${got.doorDirs}] open=[${got.openDoorDirs}], expected doors=[${expected.doorDirs}] open=[${expected.openDoorDirs}]`
    );
    fail = true;
  } else {
    console.log(`ok    doors=[${got.doorDirs}] open=[${got.openDoorDirs}]`);
  }
};

check(
  'There are four exits: north, a closed oak door leading west, a closed oak door leading south, and an open oak door leading east.',
  { doorDirs: ['e', 's', 'w'], openDoorDirs: ['e'] }
);
check('There are two exits: a closed pair of oak doors leading west and east.', {
  doorDirs: ['e', 'w'],
  openDoorDirs: [],
});
check('There are two exits: an open pair of iron gates leading north and south.', {
  doorDirs: ['n', 's'],
  openDoorDirs: ['n', 's'],
});
check('There is one exit: an open trapdoor leading down.', {
  doorDirs: ['d'],
  openDoorDirs: ['d'],
});
// No state word at all — defaults to closed (full door sequence)
check('There is one exit: a heavy gate leading northeast.', {
  doorDirs: ['ne'],
  openDoorDirs: [],
});
check('There are three exits: north, south, and east.', { doorDirs: [], openDoorDirs: [] });

if (fail) process.exit(1);
console.log('PASS — door open/closed state parses correctly');
