import { db } from '../db.js';

export const RADIUS_STAGES = [5, 10, 15, 25];       // km
export const STAGE_SECONDS = 45;                     // demo cadence, one constant
export const DEFERRAL_DAYS = { male: 90, female: 120 };

/** Great-circle distance in km. Straight line, surfaced in the UI as "direct". */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Which donor groups can supply a recipient group, per component.
 * Plasma runs the opposite way to red cells; platelets follow red-cell
 * preference but tolerate minor incompatibility, so we keep it to the
 * red-cell table and let the bank override.
 */
const RED_CELL: Record<string, string[]> = {
  'O-':  ['O-'],
  'O+':  ['O-', 'O+'],
  'A-':  ['O-', 'A-'],
  'A+':  ['O-', 'O+', 'A-', 'A+'],
  'B-':  ['O-', 'B-'],
  'B+':  ['O-', 'O+', 'B-', 'B+'],
  'AB-': ['O-', 'A-', 'B-', 'AB-'],
  'AB+': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
};

const PLASMA: Record<string, string[]> = {
  'O-': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
  'O+': ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'],
  'A-': ['A-', 'A+', 'AB-', 'AB+'],
  'A+': ['A-', 'A+', 'AB-', 'AB+'],
  'B-': ['B-', 'B+', 'AB-', 'AB+'],
  'B+': ['B-', 'B+', 'AB-', 'AB+'],
  'AB-': ['AB-', 'AB+'],
  'AB+': ['AB-', 'AB+'],
};

export function compatibleDonorGroups(recipient: string, component: string): string[] {
  if (component === 'plasma') {
    // recipient can take plasma from these donor groups
    return Object.keys(PLASMA).filter((donor) => PLASMA[donor].includes(recipient));
  }
  return RED_CELL[recipient] ?? [recipient];
}

export type Eligibility = {
  status: 'available' | 'deferred' | 'unavailable' | 'never_donated';
  nextEligibleDate: string | null;
  daysRemaining: number;
  deferralDays: number;
};

export function eligibility(donor: {
  gender: 'male' | 'female';
  last_donation_date: string | null;
  is_available: number;
  unavailable_until: string | null;
}): Eligibility {
  const deferralDays = DEFERRAL_DAYS[donor.gender];

  if (!donor.last_donation_date) {
    const base: Eligibility = {
      status: 'never_donated',
      nextEligibleDate: null,
      daysRemaining: 0,
      deferralDays,
    };
    return donor.is_available ? base : { ...base, status: 'unavailable' };
  }

  const last = new Date(donor.last_donation_date + 'T00:00:00Z');
  const next = new Date(last.getTime() + deferralDays * 86400000);
  const now = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const daysRemaining = Math.ceil((next.getTime() - now.getTime()) / 86400000);

  let status: Eligibility['status'] =
    daysRemaining > 0 ? 'deferred' : 'available';

  // a self-imposed pause outranks a clear deferral clock
  if (!donor.is_available) {
    const until = donor.unavailable_until
      ? new Date(donor.unavailable_until + 'T00:00:00Z')
      : null;
    if (!until || until > now) status = 'unavailable';
  }

  return {
    status,
    nextEligibleDate: next.toISOString().slice(0, 10),
    daysRemaining: Math.max(0, daysRemaining),
    deferralDays,
  };
}

export type Candidate = {
  id: number;
  full_name: string;
  blood_group: string;
  locality: string;
  distance_km: number;
  eligibility: Eligibility;
};

/**
 * Real matching: pull compatible donors, compute distance from stored
 * coordinates, drop anyone deferred or paused, sort by distance.
 * Nothing here is randomised.
 */
export function findCandidates(opts: {
  lat: number;
  lng: number;
  bloodGroup: string;
  component: string;
  radiusKm: number;
  excludeDonorIds?: number[];
}): Candidate[] {
  const groups = compatibleDonorGroups(opts.bloodGroup, opts.component);
  const placeholders = groups.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, full_name, blood_group, gender, locality, lat, lng,
              last_donation_date, is_available, unavailable_until, verification_state
       FROM donors
       WHERE blood_group IN (${placeholders})`
    )
    .all(...groups) as any[];

  const exclude = new Set(opts.excludeDonorIds ?? []);

  return rows
    .filter((d) => !exclude.has(d.id))
    .map((d) => ({
      ...d,
      distance_km: Math.round(haversineKm(opts.lat, opts.lng, d.lat, d.lng) * 10) / 10,
      eligibility: eligibility(d),
    }))
    .filter((d) => d.distance_km <= opts.radiusKm)
    .filter((d) => d.eligibility.status === 'available' || d.eligibility.status === 'never_donated')
    .sort((a, b) => a.distance_km - b.distance_km)
    .map((d) => ({
      id: d.id,
      full_name: d.full_name,
      blood_group: d.blood_group,
      locality: d.locality,
      distance_km: d.distance_km,
      eligibility: d.eligibility,
    }));
}

/** Aggregate view over batches — the inventory table is derived, never stored. */
export function bankInventory(bankId: number) {
  return db
    .prepare(
      `SELECT blood_group, component,
              SUM(CASE WHEN status='available' THEN units ELSE 0 END) AS available,
              SUM(CASE WHEN status='reserved'  THEN units ELSE 0 END) AS reserved,
              SUM(CASE WHEN status='available' AND expires_on <= date('now','+7 day')
                       THEN units ELSE 0 END) AS expiring_soon
       FROM stock_batches WHERE bank_id = ?
       GROUP BY blood_group, component`
    )
    .all(bankId);
}

export const PHONE_HIDDEN = '\u2014 hidden until accepted \u2014';
