// Place search parsing and filtering. Run: node tests/places.test.js
const assert = require('assert');
const path = require('path');
require(path.join(__dirname, '..', 'logic.js'));
const L = globalThis.SWLogic;

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('ok  ' + name); }

// Shaped like Open-Meteo geocoding results.
const londons = [
  { name: 'London', country: 'United Kingdom', country_code: 'GB', admin1: 'England', admin2: 'Greater London' },
  { name: 'London', country: 'Canada', country_code: 'CA', admin1: 'Ontario' },
  { name: 'London', country: 'United States', country_code: 'US', admin1: 'Kentucky', admin2: 'Laurel' },
  { name: 'London', country: 'United States', country_code: 'US', admin1: 'Ohio', admin2: 'Madison' }
];
const names = (q) => { const { quals } = L.placeQueries(q).slice(-1)[0]; return londons.filter(r => L.placeMatches(r, quals)).map(r => r.admin1); };

check('comma splits the city from the qualifier', () => {
  assert.deepStrictEqual(L.placeQueries('London, United'), [{ name: 'London', quals: ['united'] }]);
  assert.deepStrictEqual(L.placeQueries(' Paris ,  TX '), [{ name: 'Paris', quals: ['tx'] }]);
});
check('without a comma, trailing words are tried as a qualifier after the full name', () => {
  assert.deepStrictEqual(L.placeQueries('London UK'), [{ name: 'London UK', quals: [] }, { name: 'London', quals: ['uk'] }]);
  assert.deepStrictEqual(L.placeQueries('Houston'), [{ name: 'Houston', quals: [] }]);
});
check('"London, United" finds the UK first, plus US Londons', () => {
  assert.deepStrictEqual(names('London, United'), ['England', 'Kentucky', 'Ohio']);
});
check('partial and full country names', () => {
  assert.deepStrictEqual(names('London, United K'), ['England']);
  assert.deepStrictEqual(names('London, United Kingdom'), ['England']);
  assert.deepStrictEqual(names('London, kingdom'), ['England']);
  assert.deepStrictEqual(names('London, Can'), ['Ontario']);
});
check('aliases and codes: UK, England, USA, GB, US state codes', () => {
  assert.deepStrictEqual(names('London UK'), ['England']);
  assert.deepStrictEqual(names('London, England'), ['England']);
  assert.deepStrictEqual(names('London, gb'), ['England']);
  assert.deepStrictEqual(names('London, USA'), ['Kentucky', 'Ohio']);
  assert.deepStrictEqual(names('London, KY'), ['Kentucky']);
  assert.deepStrictEqual(names('London, oh'), ['Ohio']);
});
check('state names, accents and case are forgiving', () => {
  assert.deepStrictEqual(names('London, ONTARIO'), ['Ontario']);
  assert.ok(L.placeMatches({ country: 'México', admin1: 'Jalisco' }, ['mexico']));
  assert.ok(!L.placeMatches(londons[0], ['france']));
});

check('ranking: exact name, then whole-word prefix, then by population', () => {
  const list = [
    { name: 'Londonderry', population: 83000 },
    { name: 'London Colney', population: 8000 },
    { name: 'London', admin1: 'Kentucky', population: 8000 },
    { name: 'Londonthorpe' },
    { name: 'London', admin1: 'England', population: 8961989 }
  ];
  assert.deepStrictEqual(L.rankPlaces(list, 'london').map(r => r.name + (r.admin1 ? ' ' + r.admin1 : '')),
    ['London England', 'London Kentucky', 'London Colney', 'Londonderry', 'Londonthorpe']);
});

console.log(`\n${passed} checks passed`);
