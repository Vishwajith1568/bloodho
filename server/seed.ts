import type { Database } from 'better-sqlite3';
import bcrypt from 'bcryptjs';

/**
 * Deterministic seed. Every coordinate is a real Hyderabad locality centroid,
 * every hospital and blood bank is a real institution in the city.
 * Dates are computed relative to the day the DB is first created so that
 * "expires in 3 days" and "eligible in 12 days" stay meaningful.
 */

const DAY = 86400000;
const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (days: number) => iso(new Date(today.getTime() + days * DAY));
const stamp = (days: number) =>
  new Date(today.getTime() + days * DAY).toISOString().slice(0, 19).replace('T', ' ');
/** daysAgo back, then minutes forward — lets a request be fulfilled 38 min after broadcast. */
const stampAt = (daysAgo: number, minutes = 0) =>
  new Date(today.getTime() - daysAgo * DAY + minutes * 60000)
    .toISOString().slice(0, 19).replace('T', ' ');

// ---------------------------------------------------------------- localities
const L: Record<string, [number, number]> = {
  Kukatpally: [17.4849, 78.4138],
  Gachibowli: [17.4401, 78.3489],
  Madhapur: [17.4486, 78.3908],
  Secunderabad: [17.4399, 78.4983],
  Begumpet: [17.4435, 78.4645],
  Ameerpet: [17.4375, 78.4483],
  Dilsukhnagar: [17.3687, 78.5247],
  'LB Nagar': [17.3457, 78.5522],
  Uppal: [17.4058, 78.5590],
  Kompally: [17.5401, 78.4869],
  Miyapur: [17.4967, 78.3576],
  'Banjara Hills': [17.4156, 78.4347],
  'Jubilee Hills': [17.4326, 78.4071],
  Himayatnagar: [17.4009, 78.4837],
  Malakpet: [17.3730, 78.5027],
  Attapur: [17.3616, 78.4237],
  Mehdipatnam: [17.3953, 78.4392],
  Kothapet: [17.3684, 78.5406],
  Shamshabad: [17.2403, 78.4294],
  Alwal: [17.5048, 78.5080],
  Nizampet: [17.5099, 78.3868],
  Chandanagar: [17.4936, 78.3235],
  Manikonda: [17.4030, 78.3772],
  Tarnaka: [17.4239, 78.5286],
  Sainikpuri: [17.4931, 78.5501],
  Nacharam: [17.4232, 78.5594],
  Bachupally: [17.5457, 78.3805],
  Kondapur: [17.4615, 78.3639],
  Habsiguda: [17.4062, 78.5407],
  Sanathnagar: [17.4557, 78.4404],
  Santoshnagar: [17.3480, 78.5040],
  Yousufguda: [17.4340, 78.4270],
  Panjagutta: [17.4256, 78.4508],
  Amberpet: [17.3925, 78.5085],
  'Toli Chowki': [17.3968, 78.4162],
  Erragadda: [17.4573, 78.4363],
  Serilingampally: [17.4847, 78.3141],
  Medipally: [17.4260, 78.6070],
  Boduppal: [17.4090, 78.5910],
  Khairatabad: [17.4030, 78.4630],
};

// jitter a locality centroid so 40 donors aren't stacked on 20 points
const near = (name: string, i: number): [number, number] => {
  const [la, ln] = L[name];
  return [la + ((i * 37) % 23 - 11) * 0.0011, ln + ((i * 53) % 23 - 11) * 0.0011];
};

// ---------------------------------------------------------------- donors
type D = [string, string, 'male' | 'female', string, string, number | null];
//        name,   group,  gender,             phone,  locality, days since last donation
const DONORS: D[] = [
  ['Sridhar Reddy Kasula',     'O+',  'male',   '9848012345', 'Kukatpally',      104],
  ['Anitha Vardhineni',        'O+',  'female', '9701123456', 'Gachibowli',       41],
  ['Mohammed Irfan Baig',      'O-',  'male',   '9959234567', 'Malakpet',        212],
  ['Praveen Kumar Adepu',      'B+',  'male',   '9394345678', 'Dilsukhnagar',     67],
  ['Sushma Chaitanya Rao',     'A+',  'female', '9885456789', 'Madhapur',        131],
  ['Rakesh Bandaru',           'A+',  'male',   '9642567890', 'Miyapur',          29],
  ['Fatima Sultana',           'AB+', 'female', '9573678901', 'Toli Chowki',     158],
  ['Venkatesh Nallamothu',     'B+',  'male',   '9908789012', 'LB Nagar',         95],
  ['Divya Sree Pothineni',     'O+',  'female', '9666890123', 'Kondapur',         12],
  ['Arun Teja Mallavarapu',    'A-',  'male',   '9849901234', 'Begumpet',        176],
  ['Lakshmi Priya Ganta',      'B-',  'female', '9700012345', 'Secunderabad',    203],
  ['Sai Charan Yerramsetti',   'O+',  'male',   '9494123450', 'Uppal',            88],
  ['Naveen Chandra Bollam',    'AB-', 'male',   '9912234501', 'Tarnaka',         241],
  ['Harika Vemulapalli',       'A+',  'female', '9553345012', 'Ameerpet',         55],
  ['Syed Abdul Kareem',        'B+',  'male',   '9603456123', 'Santoshnagar',    118],
  ['Ravi Shankar Dandu',       'O-',  'male',   '9848567234', 'Habsiguda',        73],
  ['Swathi Konda',             'O+',  'female', '9989678345', 'Nizampet',        127],
  ['Karthik Rajulapati',       'A+',  'male',   '9391789456', 'Jubilee Hills',    21],
  ['Meghana Sirigiri',         'B+',  'female', '9705890567', 'Manikonda',       164],
  ['Imran Shaikh',             'AB+', 'male',   '9948901678', 'Mehdipatnam',      92],
  ['Deepthi Alluri',           'A-',  'female', '9666012789', 'Banjara Hills',   188],
  ['Manoj Kumar Thota',        'O+',  'male',   '9642123890', 'Kompally',         38],
  ['Sneha Latha Pusuluri',     'B+',  'female', '9573234901', 'Alwal',           145],
  ['Vamsi Krishna Gudipati',   'O+',  'male',   '9908345012', 'Chandanagar',      63],
  ['Ayesha Begum',             'A+',  'female', '9849456123', 'Amberpet',        109],
  ['Srinivas Rao Mamidi',      'B-',  'male',   '9494567234', 'Nacharam',        231],
  ['Pallavi Donthireddy',      'O-',  'female', '9912678345', 'Sainikpuri',       48],
  ['Nikhil Sai Perumalla',     'AB+', 'male',   '9553789456', 'Bachupally',      152],
  ['Keerthi Reddy Vangala',    'A+',  'female', '9603890567', 'Yousufguda',       26],
  ['Abhilash Chevuru',         'O+',  'male',   '9848901678', 'Attapur',          81],
  ['Bhavana Kanumuri',         'B+',  'female', '9989012789', 'Erragadda',       197],
  ['Rahul Varma Penmetsa',     'A-',  'male',   '9391123890', 'Panjagutta',       59],
  ['Zoya Khan',                'AB-', 'female', '9705234901', 'Khairatabad',     134],
  ['Ganesh Babu Sunkara',      'O+',  'male',   '9948345012', 'Kothapet',        171],
  ['Ramya Krishna Jampala',    'O+',  'female', '9666456123', 'Boduppal',         33],
  ['Aditya Narayan Kolli',     'B+',  'male',   '9642567234', 'Medipally',       116],
  ['Tejaswini Rachakonda',     'A+',  'female', '9573678345', 'Serilingampally',  70],
  ['Mahesh Chandra Gollapudi', 'O-',  'male',   '9908789456', 'Sanathnagar',     224],
  ['Nausheen Fatima',          'B-',  'female', '9849890567', 'Shamshabad',      101],
  ['Dinesh Kumar Vootla',      'AB+', 'male',   '9494901678', 'Himayatnagar',     null],
];

// ---------------------------------------------------------------- hospitals
const HOSPITALS: [string, string, string, number, number, string, number][] = [
  ['Yashoda Hospitals', 'Somajiguda', 'Raj Bhavan Road, Somajiguda', 17.4256, 78.4595, '04045674567', 1],
  ['Apollo Hospitals', 'Jubilee Hills', 'Road No 72, Film Nagar, Jubilee Hills', 17.4126, 78.4128, '04023607777', 1],
  ['Nizam\u2019s Institute of Medical Sciences', 'Punjagutta', 'Panjagutta Road, Punjagutta', 17.4256, 78.4508, '04023489000', 1],
  ['CARE Hospitals', 'Banjara Hills', 'Road No 1, Banjara Hills', 17.4149, 78.4373, '04030418888', 0],
  ['KIMS Hospitals', 'Kondapur', 'Survey No 60, Kondapur Village', 17.4649, 78.3668, '04067505050', 0],
];

// ---------------------------------------------------------------- blood banks
const BANKS: [string, string, string, number, number, string, string][] = [
  ['Indian Red Cross Society Blood Centre', 'Vidyanagar', '4-1-1234, Vidyanagar', 17.4045, 78.5126, '04027563322', 'TS/BB/0114'],
  ['Chiranjeevi Charitable Trust Blood Bank', 'Jubilee Hills', 'Road No 1, Jubilee Hills', 17.4310, 78.4082, '04023556677', 'TS/BB/0208'],
  ['NTR Memorial Trust Blood Bank', 'Banjara Hills', 'Road No 12, Banjara Hills', 17.4162, 78.4351, '04023548899', 'TS/BB/0331'],
  ['Osmania General Hospital Blood Bank', 'Afzalgunj', 'Afzalgunj, Old City', 17.3729, 78.4776, '04024600146', 'TS/BB/0042'],
  ['Gandhi Hospital Blood Bank', 'Secunderabad', 'Musheerabad, Secunderabad', 17.4399, 78.4983, '04027505566', 'TS/BB/0087'],
  ['Ashwini Voluntary Blood Bank', 'Dilsukhnagar', 'Chaitanyapuri Main Road', 17.3687, 78.5247, '04024045511', 'TS/BB/0419'],
];

const GROUPS = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];
const SHELF: Record<string, number> = { whole_blood: 35, prbc: 42, platelets: 5, plasma: 365 };

// realistic distribution: O+ and B+ dominate in India, AB- is scarce
const STOCK_WEIGHT: Record<string, number> = {
  'O+': 1.0, 'B+': 0.95, 'A+': 0.7, 'AB+': 0.35,
  'O-': 0.18, 'B-': 0.15, 'A-': 0.12, 'AB-': 0.07,
};

export function seed(db: Database) {
  const now = stamp(0);

  // ---- badges ----------------------------------------------------------
  const badgeRows: [string, string, string, number | null][] = [
    ['first_donation', 'First Donation', 'Completed a first whole-blood donation', 1],
    ['fifth_donation', 'Fifth Donation', 'Five lifetime donations recorded', 5],
    ['tenth_donation', 'Tenth Donation', 'Ten lifetime donations recorded', 10],
    ['silver_25', 'Silver Donor', 'Twenty-five lifetime donations', 25],
    ['rapid_responder', 'Rapid Responder', 'Accepted three emergency requests within an hour of notification', null],
    ['rare_group', 'Rare Group Registry', 'Registered negative-group donor on standby', null],
    ['camp_regular', 'Camp Regular', 'Attended three or more organised camps', null],
    ['life_saver_streak', 'Life-Saver Streak', 'Donated in four consecutive eligible windows', null],
  ];
  const insBadge = db.prepare('INSERT INTO badges (code,label,descriptor,threshold) VALUES (?,?,?,?)');
  badgeRows.forEach((b) => insBadge.run(...b));

  // ---- hospitals -------------------------------------------------------
  const insH = db.prepare(
    'INSERT INTO hospitals (name,locality,address,lat,lng,phone,has_blood_bank) VALUES (?,?,?,?,?,?,?)'
  );
  HOSPITALS.forEach((h) => insH.run(...h));

  // ---- banks -----------------------------------------------------------
  const insB = db.prepare(
    'INSERT INTO blood_banks (name,locality,address,lat,lng,phone,licence_no) VALUES (?,?,?,?,?,?,?)'
  );
  BANKS.forEach((b) => insB.run(...b));

  // ---- donors ----------------------------------------------------------
  const insD = db.prepare(`INSERT INTO donors
    (full_name,blood_group,gender,phone,locality,lat,lng,last_donation_date,contact_pref,
     is_available,unavailable_until,unavailable_reason,verification_state,total_donations)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const prefs = ['call', 'sms', 'whatsapp', 'in_app'];
  DONORS.forEach((d, i) => {
    const [name, group, gender, phone, locality, since] = d;
    const [lat, lng] = near(locality, i);
    const last = since === null ? null : shift(-since);
    // three donors are temporarily unavailable, one with an end date
    const off = i === 8 || i === 22 || i === 31;
    const until = i === 22 ? shift(18) : null;
    const reason = i === 8 ? 'Travelling out of station' : i === 22 ? 'On antibiotics' : i === 31 ? 'Recent tattoo' : null;
    // verification spread: most verified, a few pending, a couple unverified
    const vstate = i % 9 === 4 ? 'pending' : i % 11 === 7 ? 'unverified' : 'verified';
    // lifetime donations correlate loosely with how long they've been registered
    // Realistic shape: roughly half donate once and never return, a third come
    // back a second or third time, a handful are long-term regulars.
    const bucket = (i * 7) % 10;
    const total = since === null ? 0
      : bucket < 5 ? 1
      : bucket < 8 ? 2 + (i % 2)
      : 6 + (i % 5);
    insD.run(name, group, gender, phone, locality, lat, lng, last, prefs[i % 4],
      off ? 0 : 1, until, reason, vstate, total);
  });

  // ---- donor badges ----------------------------------------------------
  const insDB = db.prepare('INSERT OR IGNORE INTO donor_badges (donor_id,badge_id,earned_on) VALUES (?,?,?)');
  const donorRows = db.prepare('SELECT id,total_donations,blood_group FROM donors').all() as any[];
  donorRows.forEach((d) => {
    if (d.total_donations >= 1) insDB.run(d.id, 1, shift(-(400 + d.id * 3)));
    if (d.total_donations >= 5) insDB.run(d.id, 2, shift(-(250 + d.id * 2)));
    if (d.total_donations >= 10) insDB.run(d.id, 3, shift(-(90 + d.id)));
    if (d.blood_group.endsWith('-')) insDB.run(d.id, 6, shift(-300));
    if (d.id % 7 === 0) insDB.run(d.id, 5, shift(-120));
  });

  // ---- donations history ----------------------------------------------
  const insDon = db.prepare(`INSERT INTO donations
    (donor_id,donated_on,component,units,donation_type,bank_id,hospital_id,certificate_no)
    VALUES (?,?,?,?,?,?,?,?)`);
  let certSeq = 1;
  donorRows.forEach((d, idx) => {
    const n = Math.min(d.total_donations, 6);
    for (let k = 0; k < n; k++) {
      const daysAgo = 95 * (k + 1) + ((idx * 11) % 40);
      const type = (idx + k) % 3 === 0 ? 'replacement' : 'voluntary';
      insDon.run(
        d.id, shift(-daysAgo), 'whole_blood', 1, type,
        ((idx + k) % 6) + 1, null,
        'HYD-CERT-' + String(2400 + certSeq++).padStart(5, '0')
      );
    }
  });

  // ---- stock batches ---------------------------------------------------
  const insBatch = db.prepare(`INSERT INTO stock_batches
    (bank_id,blood_group,component,units,collected_on,expires_on,source,status)
    VALUES (?,?,?,?,?,?,?,?)`);
  const insMove = db.prepare(`INSERT INTO stock_movements
    (bank_id,batch_id,kind,blood_group,component,units,counterparty,note,actor,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);

  let batchSeed = 3;
  const rnd = () => { batchSeed = (batchSeed * 1103515245 + 12345) % 2147483648; return batchSeed / 2147483648; };

  for (let bank = 1; bank <= 6; bank++) {
    const scale = [1.0, 0.75, 0.85, 1.2, 1.1, 0.6][bank - 1];
    for (const g of GROUPS) {
      for (const comp of ['whole_blood', 'prbc', 'platelets', 'plasma']) {
        const base = comp === 'platelets' ? 3 : comp === 'plasma' ? 8 : 12;
        const count = Math.round(base * STOCK_WEIGHT[g] * scale * (0.6 + rnd() * 0.8));
        if (count <= 0) continue;
        // split into 1-3 batches with different collection dates
        const nBatches = comp === 'platelets' ? 2 : 3;
        for (let b = 0; b < nBatches; b++) {
          const units = Math.floor(count / nBatches) + (b === 0 ? count % nBatches : 0);
          if (units <= 0) continue;
          const shelf = SHELF[comp];
          // age batches so some are near expiry
          const age = Math.floor(rnd() * shelf * 0.9);
          const collected = shift(-age);
          const expires = shift(-age + shelf);
          const expired = -age + shelf < 0;
          const src = rnd() < 0.62 ? 'voluntary' : rnd() < 0.85 ? 'replacement' : 'camp';
          const info = insBatch.run(bank, g, comp, units, collected, expires, src,
            expired ? 'expired' : 'available');
          insMove.run(bank, info.lastInsertRowid, 'receipt', g, comp, units, null,
            'Initial stock load', 'system', stamp(-age));
        }
      }
    }
  }

  // Units that aged out unused. Wastage is a headline admin metric, so it has
  // to come from real batches that passed their expiry, not a static number.
  const wasted: [number, string, string, number, number, 'expired' | 'discarded'][] = [
    // bank, group, component, units, days since expiry, status
    [1, 'AB-', 'platelets',   2,  4, 'expired'],
    [1, 'A-',  'whole_blood', 1, 11, 'expired'],
    [2, 'AB+', 'platelets',   3,  2, 'discarded'],
    [3, 'B-',  'prbc',        2,  6, 'expired'],
    [4, 'AB-', 'whole_blood', 1, 19, 'discarded'],
    [4, 'O-',  'platelets',   1,  3, 'expired'],
    [5, 'A-',  'platelets',   2,  8, 'discarded'],
    [6, 'AB+', 'whole_blood', 3, 14, 'expired'],
  ];
  wasted.forEach(([bank, g, comp, units, agedOut, status]) => {
    const shelf = SHELF[comp];
    const info = insBatch.run(bank, g, comp, units,
      shift(-(shelf + agedOut)), shift(-agedOut), 'voluntary', status);
    insMove.run(bank, info.lastInsertRowid, 'receipt', g, comp, units, null,
      'Initial stock load', 'system', stamp(-(shelf + agedOut)));
    if (status === 'discarded') {
      insMove.run(bank, info.lastInsertRowid, 'discard', g, comp, units, null,
        'Passed expiry, not issued', 'system', stamp(-agedOut));
    }
  });

  // ---- historic requests ----------------------------------------------
  const insReq = db.prepare(`INSERT INTO requests
    (ref_code,patient_ref,patient_age,blood_group,component,units_needed,units_pledged,units_fulfilled,
     urgency,hospital_id,ward,attendant_name,attendant_phone,lat,lng,verification_state,hospital_ref_no,
     status,radius_stage,stage_started_at,notes,created_at,broadcast_at,fulfilled_at,is_flagged)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const hCoord = (id: number) => [HOSPITALS[id - 1][3], HOSPITALS[id - 1][4]];

  const historic: any[] = [
    // fulfilled, fast
    ['REQ-HYD-24081', 'IP/2026/14872', 54, 'B+', 'prbc', 2, 2, 2, 'critical', 1, 'ICU-2',
      'Ramesh Chandra Rao', '9848113344', 'hospital_verified', 'YH/EM/8841', 'fulfilled', 1,
      stampAt(9), 'Post-operative bleed, theatre standby', stampAt(9), stampAt(9, 4), stampAt(9, 41), 0],
    // fulfilled, slow (went to stage 3)
    ['REQ-HYD-24095', 'IP/2026/15003', 31, 'O-', 'whole_blood', 3, 3, 3, 'critical', 3, 'Casualty',
      'Sunitha Devi', '9701556677', 'hospital_verified', 'NIMS/CAS/2210', 'fulfilled', 3,
      stampAt(6), 'RTA, multiple units required', stampAt(6), stampAt(6, 7), stampAt(6, 196), 0],
    // partially fulfilled, still open
    ['REQ-HYD-24118', 'IP/2026/15144', 8, 'AB-', 'platelets', 4, 2, 1, 'critical', 2, 'Paediatric Onco',
      'Md Ghouse Pasha', '9959778899', 'hospital_verified', 'AP/PO/5512', 'partially_fulfilled', 2,
      stamp(0), 'Dengue with severe thrombocytopenia', stamp(-1), stamp(-1), null, 0],
    // broadcasting right now, nobody responded yet
    ['REQ-HYD-24122', 'IP/2026/15170', 27, 'A-', 'prbc', 2, 0, 0, 'urgent', 5, 'Ward 4B',
      'Kavitha Ramineni', '9394220011', 'otp_verified', null, 'broadcasting', 0,
      stamp(0), 'Anaemia, transfusion scheduled this evening', stamp(0), stamp(0), null, 0],
    // unverified, cannot broadcast
    ['REQ-HYD-24123', 'OP/2026/00921', 45, 'O+', 'whole_blood', 1, 0, 0, 'scheduled', 4, null,
      'Anil Kumar', '9666445566', 'unverified', null, 'draft', 0,
      null, 'Elective surgery next week', stamp(0), null, null, 0],
    // flagged as suspected hoax
    ['REQ-HYD-24110', 'IP/2026/15098', 60, 'AB+', 'whole_blood', 6, 0, 0, 'critical', 1, 'ICU-1',
      'Unverified Caller', '9000112233', 'unverified', null, 'cancelled', 2,
      stamp(-3), 'Six units demanded, attendant unreachable on callback', stamp(-3), stamp(-3), null, 1],
    // expired without fulfilment
    ['REQ-HYD-24076', 'IP/2026/14790', 38, 'B-', 'plasma', 2, 1, 0, 'urgent', 3, 'Ward 9',
      'Prasad Babu Gollapalli', '9573889900', 'otp_verified', null, 'expired', 3,
      stamp(-14), 'No donor completed donation within window', stamp(-14), stamp(-14), null, 0],
  ];
  /**
   * A further run of closed requests. Without these the register holds seven
   * rows, and a fulfilment rate computed over seven rows is noise rather than
   * a metric. Fulfilment times are spread the way a real service reports them:
   * common groups close inside the hour, negative groups take several.
   */
  const closed: [string, string, string, string, number, string, number, number, number][] = [
    // ref suffix, patient, group, component, units, urgency, hospital, daysAgo, minutesToFulfil (0 = expired)
    ['24084', 'IP/2026/14812', 'O+',  'whole_blood', 2, 'urgent',    1, 21, 52],
    ['24086', 'IP/2026/14830', 'B+',  'prbc',        1, 'critical',  4, 20, 27],
    ['24088', 'IP/2026/14851', 'A+',  'whole_blood', 2, 'urgent',    2, 18, 74],
    ['24091', 'IP/2026/14877', 'O+',  'prbc',        3, 'critical',  3, 17, 63],
    ['24093', 'IP/2026/14902', 'AB+', 'platelets',   2, 'critical',  1, 15, 118],
    ['24097', 'IP/2026/14933', 'B+',  'whole_blood', 1, 'scheduled', 5, 14, 39],
    ['24099', 'IP/2026/14958', 'O-',  'prbc',        2, 'critical',  2, 12, 214],
    ['24101', 'IP/2026/14976', 'A+',  'platelets',   1, 'urgent',    4, 11, 46],
    ['24104', 'IP/2026/15011', 'B-',  'whole_blood', 2, 'critical',  3, 10,  0],
    ['24106', 'IP/2026/15032', 'O+',  'whole_blood', 1, 'scheduled', 5,  9, 31],
    ['24108', 'IP/2026/15057', 'A-',  'prbc',        2, 'urgent',    1,  8, 167],
    ['24112', 'IP/2026/15074', 'B+',  'platelets',   2, 'critical',  2,  7, 88],
    ['24114', 'IP/2026/15089', 'O+',  'prbc',        2, 'urgent',    4,  5, 44],
    ['24116', 'IP/2026/15112', 'AB-', 'whole_blood', 1, 'critical',  3,  4,  0],
    ['24120', 'IP/2026/15158', 'A+',  'whole_blood', 2, 'scheduled', 5,  2, 57],
  ];
  const attendants = [
    ['Srinivas Rao Kandula', '9848220011'], ['Padmaja Nallapati', '9701330022'],
    ['Mohammed Ayaz Khan', '9959440033'],   ['Lakshmi Narayana Dubbaka', '9394550044'],
    ['Jyothi Rani Bandi', '9885660055'],
  ];
  closed.forEach((c, i) => {
    const [suffix, patient, group, comp, units, urgency, hosp, daysAgo, mins] = c;
    const [aname, aphone] = attendants[i % attendants.length];
    const done = mins > 0;
    historic.push([
      `REQ-HYD-${suffix}`, patient, 24 + ((i * 7) % 48), group, comp, units,
      done ? units : Math.max(0, units - 1), done ? units : 0,
      urgency, hosp, i % 3 === 0 ? 'ICU-2' : i % 3 === 1 ? 'Casualty' : `Ward ${2 + (i % 8)}`,
      aname, aphone,
      i % 4 === 0 ? 'otp_verified' : 'hospital_verified',
      i % 4 === 0 ? null : `REF/${suffix}/${1200 + i}`,
      done ? 'fulfilled' : 'expired',
      mins > 120 ? 3 : mins > 60 ? 2 : 1,
      stampAt(daysAgo, 5),
      done ? null : 'No donor completed donation inside the window',
      stampAt(daysAgo), stampAt(daysAgo, 5), done ? stampAt(daysAgo, 5 + mins) : null, 0,
    ]);
  });

  historic.forEach((r) => {
    const [la, ln] = hCoord(r[9]);
    insReq.run(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12],
      la, ln, r[13], r[14], r[15], r[16], r[17], r[18], r[19], r[20], r[21], r[22]);
  });

  // matches for those requests, computed against real donor coords
  const insMatch = db.prepare(`INSERT OR IGNORE INTO request_matches
    (request_id,donor_id,distance_km,radius_stage,notified_at,response,responded_at,units_pledged)
    VALUES (?,?,?,?,?,?,?,?)`);
  const reqRows = db.prepare('SELECT id,ref_code,blood_group,lat,lng,status FROM requests').all() as any[];
  const allDonors = db.prepare('SELECT id,blood_group,lat,lng FROM donors').all() as any[];

  const hav = (a: number, b: number, c: number, d: number) => {
    const R = 6371, t = Math.PI / 180;
    const dLat = (c - a) * t, dLon = (d - b) * t;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  };

  const RESPONSES: Record<string, string[]> = {
    'REQ-HYD-24081': ['accepted', 'accepted', 'declined', 'expired'],
    'REQ-HYD-24095': ['accepted', 'declined', 'accepted', 'accepted', 'expired', 'declined'],
    'REQ-HYD-24118': ['accepted', 'accepted', 'declined', 'pending', 'pending'],
    'REQ-HYD-24122': ['pending', 'pending', 'pending'],
    'REQ-HYD-24110': ['declined', 'declined', 'expired'],
    'REQ-HYD-24076': ['accepted', 'expired', 'declined', 'expired'],
  };

  reqRows.forEach((r) => {
    const plan = RESPONSES[r.ref_code];
    if (!plan) return;
    const compatible = allDonors
      .filter((d) => d.blood_group === r.blood_group)
      .map((d) => ({ ...d, km: hav(r.lat, r.lng, d.lat, d.lng) }))
      .sort((a, b) => a.km - b.km);
    plan.forEach((resp, i) => {
      const d = compatible[i];
      if (!d) return;
      const stage = d.km <= 5 ? 0 : d.km <= 10 ? 1 : d.km <= 15 ? 2 : 3;
      insMatch.run(r.id, d.id, Math.round(d.km * 10) / 10, stage, stamp(-2),
        resp, resp === 'pending' ? null : stamp(-2), resp === 'accepted' ? 1 : 0);
    });
  });

  // bank claims on the open requests
  const insClaim = db.prepare(
    'INSERT OR IGNORE INTO bank_claims (request_id,bank_id,status,units,note) VALUES (?,?,?,?,?)'
  );
  const open = db.prepare("SELECT id FROM requests WHERE status IN ('broadcasting','partially_fulfilled')").all() as any[];
  open.forEach((r, i) => {
    insClaim.run(r.id, (i % 6) + 1, 'pending', 0, null);
    insClaim.run(r.id, ((i + 2) % 6) + 1, i === 0 ? 'reserved' : 'pending', i === 0 ? 1 : 0,
      i === 0 ? 'One unit held for 6 hours pending attendant collection' : null);
  });

  // ---- camps -----------------------------------------------------------
  const insCamp = db.prepare(`INSERT INTO camps
    (title,organiser,venue,locality,lat,lng,camp_date,start_time,end_time,bank_id,capacity,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const camps: any[] = [
    ['Republic Day Voluntary Donation Drive', 'Rotary Club of Hyderabad Deccan',
      'Ravindra Bharathi Auditorium', 'Khairatabad', 17.4030, 78.4630, shift(9), '09:30', '16:00', 1, 120, 'scheduled'],
    ['IT Corridor Employee Blood Drive', 'HYSEA in association with NTR Trust',
      'Cyber Towers Atrium, HITEC City', 'Madhapur', 17.4486, 78.3908, shift(16), '10:00', '17:00', 3, 200, 'scheduled'],
    ['Osmania University Campus Camp', 'NSS Unit, Osmania University',
      'Arts College Grounds', 'Amberpet', 17.3925, 78.5085, shift(23), '09:00', '15:00', 4, 150, 'scheduled'],
    ['Ganesh Utsav Community Camp', 'Balapur Ganesh Utsav Samithi',
      'Community Hall, Chaitanyapuri', 'Dilsukhnagar', 17.3687, 78.5247, shift(-27), '09:00', '15:00', 6, 100, 'completed'],
  ];
  camps.forEach((c) => insCamp.run(...c));

  const insReg = db.prepare(
    'INSERT OR IGNORE INTO camp_registrations (camp_id,donor_id,slot_time,status) VALUES (?,?,?,?)'
  );
  const slots = ['09:30', '10:15', '11:00', '11:45', '14:00', '14:45', '15:30'];
  [1, 2, 3].forEach((campId) => {
    for (let k = 0; k < 6 + campId; k++) {
      const donorId = ((campId * 7 + k * 3) % 40) + 1;
      insReg.run(campId, donorId, slots[k % slots.length], 'registered');
    }
  });
  // completed camp has attendance
  for (let k = 0; k < 9; k++) insReg.run(4, ((k * 4) % 40) + 1, slots[k % slots.length], k < 7 ? 'attended' : 'no_show');

  // completed camp fed stock
  const insColl = db.prepare(`INSERT INTO camp_collections
    (camp_id,bank_id,blood_group,component,units,collected_on,batch_id) VALUES (?,?,?,?,?,?,?)`);
  const campHarvest: [string, number][] = [['O+', 14], ['B+', 9], ['A+', 7], ['AB+', 3], ['O-', 2], ['B-', 1]];
  campHarvest.forEach(([g, u]) => {
    const info = insBatch.run(6, g, 'whole_blood', u, shift(-27), shift(-27 + 35), 'camp', 'available');
    insColl.run(4, 6, g, 'whole_blood', u, shift(-27), info.lastInsertRowid);
    insMove.run(6, info.lastInsertRowid, 'receipt', g, 'whole_blood', u, 'Ganesh Utsav Community Camp',
      'Camp collection', 'system', stamp(-27));
  });

  // ---- governance ------------------------------------------------------
  const insVer = db.prepare(
    'INSERT INTO verification_requests (donor_id,document_kind,document_ref,status) VALUES (?,?,?,?)'
  );
  db.prepare("SELECT id FROM donors WHERE verification_state='pending'").all().forEach((d: any, i) => {
    insVer.run(d.id, i % 2 === 0 ? 'aadhaar' : 'donor_card', 'XXXX-XXXX-' + (4000 + d.id), 'pending');
  });

  const insFlag = db.prepare(
    'INSERT INTO flags (request_id,donor_id,reason,detail,raised_by,status,created_at) VALUES (?,?,?,?,?,?,?)'
  );
  const hoaxReq = db.prepare("SELECT id FROM requests WHERE ref_code='REQ-HYD-24110'").get() as any;
  insFlag.run(hoaxReq.id, null, 'hoax', 'Attendant number switched off; hospital has no such admission', 'Ashwini Voluntary Blood Bank', 'open', stamp(-3));
  insFlag.run(hoaxReq.id, null, 'duplicate', 'Same patient reference broadcast twice within an hour', 'Sridhar Reddy Kasula', 'open', stamp(-3));
  insFlag.run(null, 12, 'payment_demand', 'Donor allegedly asked attendant for 5000 rupees before donating', 'Kavitha Ramineni', 'open', stamp(-2));
  insFlag.run(null, 28, 'wrong_details', 'Listed group does not match donor card shown at bank', 'Gandhi Hospital Blood Bank', 'dismissed', stamp(-11));

  const insFb = db.prepare(
    'INSERT INTO feedback (source_portal,author_name,category,rating,message,status,created_at) VALUES (?,?,?,?,?,?,?)'
  );
  const fb: any[] = [
    ['donor', 'Sridhar Reddy Kasula', 'notifications', 4, 'Requests come through fine but there is no way to snooze alerts during night shifts.', 'new', stamp(-1)],
    ['requester', 'Sunitha Devi', 'matching', 5, 'Radius widened on its own at midnight and two donors reached Casualty within the hour.', 'read', stamp(-5)],
    ['bank', 'NTR Memorial Trust Blood Bank', 'inventory', 3, 'Expiry flags are useful. Issue entry needs a bulk mode for theatre days.', 'new', stamp(-2)],
    ['requester', 'Md Ghouse Pasha', 'verification', 2, 'OTP step took three attempts because the message arrived after the timer ran out.', 'new', stamp(0)],
    ['donor', 'Pallavi Donthireddy', 'profile', 4, 'Eligibility countdown is accurate. Would like platelet donations tracked separately.', 'actioned', stamp(-8)],
    ['bank', 'Osmania General Hospital Blood Bank', 'transfers', 4, 'Inter-bank transfer request reached us quickly but there is no vehicle handover note.', 'read', stamp(-6)],
  ];
  fb.forEach((f) => insFb.run(...f));

  const insTr = db.prepare(
    'INSERT INTO transfers (from_bank_id,to_bank_id,blood_group,component,units,status,note,created_at) VALUES (?,?,?,?,?,?,?,?)'
  );
  insTr.run(4, 2, 'O-', 'prbc', 2, 'requested', 'Paediatric case, short of two units', stamp(0));
  insTr.run(1, 5, 'AB-', 'platelets', 1, 'approved', 'Single donor platelets, collect before 18:00', stamp(-1));
  insTr.run(3, 6, 'B+', 'whole_blood', 4, 'completed', 'Routine rebalance', stamp(-7));

  // ---- notifications ---------------------------------------------------
  const insNote = db.prepare(
    'INSERT INTO notifications (donor_id,kind,title,body,request_id,is_read,created_at) VALUES (?,?,?,?,?,?,?)'
  );
  const openReq = db.prepare("SELECT id,ref_code,blood_group FROM requests WHERE status='broadcasting'").get() as any;
  db.prepare('SELECT donor_id FROM request_matches WHERE request_id=?').all(openReq.id).forEach((m: any) => {
    insNote.run(m.donor_id, 'request', 'Emergency request nearby',
      openReq.blood_group + ' needed at KIMS Hospitals, Kondapur', openReq.id, 0, stamp(0));
  });
  insNote.run(1, 'camp', 'Camp registration confirmed',
    'Republic Day Voluntary Donation Drive, Ravindra Bharathi, 09:30 slot', null, 1, stamp(-3));

  // ---- accounts --------------------------------------------------------
  const hash = (pw: string) => bcrypt.hashSync(pw, 10);
  const insAcc = db.prepare(`INSERT INTO accounts
    (email,phone,password_hash,full_name,role,donor_id,bank_id,hospital_id) VALUES (?,?,?,?,?,?,?,?)`);

  const donorAccounts = db.prepare('SELECT id,full_name,phone FROM donors ORDER BY id').all() as any[];
  donorAccounts.forEach((d) => {
    const handle = d.full_name.toLowerCase().split(' ')[0].replace(/[^a-z]/g, '');
    insAcc.run(`${handle}.${d.id}@donor.test`, d.phone, hash('donor@123'), d.full_name, 'donor', d.id, null, null);
  });

  insAcc.run('ramesh.rao@family.test', '9848113344', hash('care@123'), 'Ramesh Chandra Rao', 'requester', null, null, null);
  insAcc.run('kavitha.r@family.test', '9394220011', hash('care@123'), 'Kavitha Ramineni', 'requester', null, null, null);
  insAcc.run('ghouse.pasha@family.test', '9959778899', hash('care@123'), 'Md Ghouse Pasha', 'requester', null, null, null);

  const bankRows = db.prepare('SELECT id,name FROM blood_banks').all() as any[];
  const bankLogins = ['redcross', 'chiranjeevi', 'ntrtrust', 'osmania', 'gandhi', 'ashwini'];
  bankRows.forEach((b, i) => {
    insAcc.run(`${bankLogins[i]}@bank.test`, BANKS[i][5], hash('bank@123'),
      b.name, 'bank', null, b.id, i < 3 ? i + 1 : null);
  });

  insAcc.run('control@bloodfinder.test', '04023456789', hash('admin@123'),
    'Hyderabad Blood Grid Control', 'admin', null, null, null);
  insAcc.run('audit@bloodfinder.test', '04023456790', hash('admin@123'),
    'State Audit Desk', 'admin', null, null, null);

  /**
   * Attach every seeded request to one of the requester accounts. Without an
   * owner the API would have to allow ownerless rows through, which is exactly
   * the loophole that lets one attendant open another family's request.
   */
  const requesterIds = db.prepare("SELECT id, phone FROM accounts WHERE role='requester'").all() as any[];
  const byPhone = new Map(requesterIds.map((a) => [a.phone, a.id]));
  db.prepare('SELECT id, attendant_phone FROM requests').all().forEach((r: any, i) => {
    const owner = byPhone.get(r.attendant_phone) ?? requesterIds[i % requesterIds.length].id;
    db.prepare('UPDATE requests SET requester_account_id = ? WHERE id = ?').run(owner, r.id);
  });

  return {
    donors: DONORS.length,
    banks: BANKS.length,
    hospitals: HOSPITALS.length,
    requests: historic.length,
    camps: camps.length,
    accounts: donorAccounts.length + 3 + bankRows.length + 2,
  };
}
