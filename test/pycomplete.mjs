/* What a Python editor is being asked to complete - see app/src/pycomplete.js. Pure, so it is
 * imported directly; what Python then answers is test:python's, against real pandas. */
import { askFor } from '../app/src/pycomplete.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const asks = (before, want, node = '', explicit = false) => {
  const got = askFor(before, node, explicit);
  check(`${JSON.stringify(before)} asks ${JSON.stringify(want)}`, same(got, want), JSON.stringify(got));
};

asks('hom', ['name', '', 'hom']);
asks('x = hom', ['name', '', 'hom']);
asks('print(hom', ['name', '', 'hom']);
asks('homelessness.', ['attr', 'homelessness', '']);
asks('homelessness.he', ['attr', 'homelessness', 'he']);
asks('x = pd.read_c', ['attr', 'pd', 'read_c']);
asks('np.random.ra', ['attr', 'np.random', 'ra']);
asks('homelessness["', ['key', 'homelessness', '']);
asks("homelessness['st", ['key', 'homelessness', 'st']);
asks('homelessness[ "st', ['key', 'homelessness', 'st']);
// Inside a subscript's quotes the string IS the question; anywhere else a string asks nothing.
asks('homelessness["st', ['key', 'homelessness', 'st'], 'String');
asks('print("hom', null, 'String');
asks('# homelessness.he', null, 'Comment');
// Not a name: a number, a call's result, the middle of nothing.
asks('3.', null);
asks('homelessness.head().', null);
asks('x = ', null);
asks('x = ', ['name', '', ''], '', true);

console.log(failures ? `\n${failures} failing` : '\nall green');
process.exit(failures ? 1 : 0);
