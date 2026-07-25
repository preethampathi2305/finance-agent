import {
  getDb,
  type AccountNicknameRow,
  type GoalRow,
  type PlanNoteRow,
} from "../db/index.js";

export function listGoals(status?: string): GoalRow[] {
  if (status) {
    return getDb()
      .prepare(
        `SELECT id, title, target_amount, current_amount, due_date, notes, status
         FROM goals WHERE status = ? ORDER BY id DESC`,
      )
      .all(status) as GoalRow[];
  }
  return getDb()
    .prepare(
      `SELECT id, title, target_amount, current_amount, due_date, notes, status
       FROM goals ORDER BY id DESC`,
    )
    .all() as GoalRow[];
}

export function upsertGoal(input: {
  id?: number;
  title: string;
  target_amount?: number | null;
  current_amount?: number | null;
  due_date?: string | null;
  notes?: string | null;
  status?: string;
}): GoalRow {
  const db = getDb();
  if (input.id) {
    db.prepare(
      `UPDATE goals SET
         title = ?,
         target_amount = ?,
         current_amount = ?,
         due_date = ?,
         notes = ?,
         status = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      input.title,
      input.target_amount ?? null,
      input.current_amount ?? 0,
      input.due_date ?? null,
      input.notes ?? null,
      input.status ?? "active",
      input.id,
    );
    return db
      .prepare(
        `SELECT id, title, target_amount, current_amount, due_date, notes, status
         FROM goals WHERE id = ?`,
      )
      .get(input.id) as GoalRow;
  }

  const result = db
    .prepare(
      `INSERT INTO goals (title, target_amount, current_amount, due_date, notes, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.title,
      input.target_amount ?? null,
      input.current_amount ?? 0,
      input.due_date ?? null,
      input.notes ?? null,
      input.status ?? "active",
    );

  return db
    .prepare(
      `SELECT id, title, target_amount, current_amount, due_date, notes, status
       FROM goals WHERE id = ?`,
    )
    .get(Number(result.lastInsertRowid)) as GoalRow;
}

export function listPlanNotes(month?: string): PlanNoteRow[] {
  if (month) {
    return getDb()
      .prepare(
        `SELECT id, month, content, updated_at FROM plan_notes
         WHERE month = ? ORDER BY updated_at DESC`,
      )
      .all(month) as PlanNoteRow[];
  }
  return getDb()
    .prepare(
      `SELECT id, month, content, updated_at FROM plan_notes
       ORDER BY month DESC, updated_at DESC LIMIT 50`,
    )
    .all() as PlanNoteRow[];
}

export function addPlanNote(month: string, content: string): PlanNoteRow {
  const result = getDb()
    .prepare(`INSERT INTO plan_notes (month, content) VALUES (?, ?)`)
    .run(month, content);
  return getDb()
    .prepare(
      `SELECT id, month, content, updated_at FROM plan_notes WHERE id = ?`,
    )
    .get(Number(result.lastInsertRowid)) as PlanNoteRow;
}

export function listCategoryRules(): Array<{
  id: number;
  match_text: string;
  category: string;
}> {
  return getDb()
    .prepare(`SELECT id, match_text, category FROM category_rules ORDER BY id`)
    .all() as Array<{ id: number; match_text: string; category: string }>;
}

export function addCategoryRule(matchText: string, category: string) {
  const result = getDb()
    .prepare(
      `INSERT INTO category_rules (match_text, category) VALUES (?, ?)`,
    )
    .run(matchText, category);
  return {
    id: Number(result.lastInsertRowid),
    match_text: matchText,
    category,
  };
}

export function categorizeName(name: string): string | null {
  const rules = listCategoryRules();
  const lower = name.toLowerCase();
  for (const rule of rules) {
    if (lower.includes(rule.match_text.toLowerCase())) {
      return rule.category;
    }
  }
  return null;
}

export function listAccountNicknames(): AccountNicknameRow[] {
  return getDb()
    .prepare(
      `SELECT account_id, nickname, institution_hint, notes FROM account_nicknames
       ORDER BY nickname`,
    )
    .all() as AccountNicknameRow[];
}

export function upsertAccountNickname(input: {
  account_id: string;
  nickname: string;
  institution_hint?: string | null;
  notes?: string | null;
}): AccountNicknameRow {
  getDb()
    .prepare(
      `INSERT INTO account_nicknames (account_id, nickname, institution_hint, notes)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         nickname = excluded.nickname,
         institution_hint = excluded.institution_hint,
         notes = excluded.notes,
         updated_at = datetime('now')`,
    )
    .run(
      input.account_id,
      input.nickname,
      input.institution_hint ?? null,
      input.notes ?? null,
    );
  return getDb()
    .prepare(
      `SELECT account_id, nickname, institution_hint, notes FROM account_nicknames
       WHERE account_id = ?`,
    )
    .get(input.account_id) as AccountNicknameRow;
}
