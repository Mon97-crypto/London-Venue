// Writes data/venues.csv from data/venues.json so the list can be opened in Excel or Sheets.
import { readFile, writeFile } from 'node:fs/promises';

const COLUMNS = [
  ['Restaurant', 'name'], ['Area', 'area'], ['Address', 'address'], ['Postcode', 'postcode'],
  ['Website', 'website'], ['Private Dining Email', 'email_private_dining'], ['General Email', 'email_general'],
  ['Email Notes', 'email_note'], ['Email Source', 'email_sources'], ['Phone', 'phone'],
  ['Cuisine', 'cuisine'], ['Michelin / Accolades', 'michelin'], ['Chef', 'chef'],
  ['Speciality', 'speciality'], ['Signature Dishes', 'signature_dishes'], ['Menu URL', 'menu_url'],
  ['Menu Summary', 'menu_summary'], ['Price Range', 'price_range'], ['Private Dining', 'private_dining'],
  ['Seated Capacity', 'capacity_seated'], ['Standing Capacity', 'capacity_standing'],
  ['Fits 15-20?', 'fit_15_20'], ['Instagram', 'instagram'], ['Cover Image', 'cover_image'],
  ['Photos', 'photos'], ['Notes', 'notes'],
];

const cell = (v) => {
  const s = Array.isArray(v) ? v.join(' | ') : String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const venues = JSON.parse(await readFile(new URL('../data/venues.json', import.meta.url), 'utf8'));
const csv = [COLUMNS.map(([h]) => h), ...venues.map((v) => COLUMNS.map(([, k]) => v[k]))]
  .map((row) => row.map(cell).join(','))
  .join('\n');
await writeFile(new URL('../data/venues.csv', import.meta.url), '﻿' + csv + '\n');
console.log(`Wrote data/venues.csv (${venues.length} venues)`);
