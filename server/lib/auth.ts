import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db.js';

const SESSION_HOURS = 12;
export const COOKIE = 'bf_session';

export type Account = {
  id: number;
  email: string;
  full_name: string;
  role: 'donor' | 'requester' | 'bank' | 'admin';
  donor_id: number | null;
  bank_id: number | null;
  hospital_id: number | null;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      account?: Account;
    }
  }
}

export function login(email: string, password: string, userAgent?: string) {
  const row = db
    .prepare('SELECT * FROM accounts WHERE lower(email) = lower(?) AND is_active = 1')
    .get(email.trim()) as any;

  // constant-ish work either way so a missing email and a wrong password feel alike
  const hash = row?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
  const ok = bcrypt.compareSync(password, hash);
  if (!row || !ok) return null;

  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare(
    'INSERT INTO sessions (token,account_id,expires_at,user_agent) VALUES (?,?,?,?)'
  ).run(token, row.id, expires, userAgent ?? null);

  return { token, account: publicAccount(row) };
}

export function logout(token?: string) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function publicAccount(row: any): Account {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    donor_id: row.donor_id,
    bank_id: row.bank_id,
    hospital_id: row.hospital_id,
  };
}

export function accountForToken(token?: string): Account | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id
       WHERE s.token = ? AND s.expires_at > datetime('now') AND a.is_active = 1`
    )
    .get(token) as any;
  return row ? publicAccount(row) : null;
}

/** Attaches req.account when a valid session cookie is present. Never rejects. */
export function attachAccount(req: Request, _res: Response, next: NextFunction) {
  const account = accountForToken(req.cookies?.[COOKIE]);
  if (account) req.account = account;
  next();
}

/** Route guard. requireRole() = any signed-in account. */
export function requireRole(...roles: Account['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.account) {
      return res.status(401).json({ error: 'not_signed_in', message: 'Sign in to continue.' });
    }
    if (roles.length && !roles.includes(req.account.role)) {
      return res.status(403).json({
        error: 'wrong_portal',
        message: `This area is for ${roles.join(' or ')} accounts.`,
      });
    }
    next();
  };
}

export function sweepSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}
