// 테스트 전용 인메모리 Supabase(PostgREST) 흉내. 실제 Supabase 를 대체하는 것이 아니라 "쿼리 실수"를 잡기 위한 도구다.
// 실제 서버가 거부하는 것들을 최대한 재현한다:
//  - 조건 없는 update/delete 거부 (Supabase 의 pg-safeupdate), 최대 1000행 응답 제한,
//  - NOT NULL / CHECK(enum) / 날짜 형식 / 외래키(존재 여부 + ON DELETE CASCADE),
//  - select 에 나열하지 않은 컬럼은 응답에 없음, identity id 자동 증가, 기본값(now, status, assignee).
const MAX_ROWS = 1000;

const SCHEMA = {
  employees:   { pk: 'emp_no', required: ['emp_no', 'name', 'dept'] },
  requests:    { id: true, required: ['title', 'cat', 'requester_dept', 'target_dept', 'due'], enums: { cat: ['service', 'edu', 'doc'] }, dates: ['due'] },
  tasks:       { id: true, required: ['cat', 'title', 'dept', 'due', 'emp_no', 'emp_name', 'emp_dept'],
                 enums: { cat: ['service', 'edu', 'doc'], status: ['normal', 'warn', 'urgent', 'overdue', 'done'] }, dates: ['due'],
                 fks: [['emp_no', 'employees', 'emp_no'], ['request_id', 'requests', 'id']] },
  submissions: { id: true, required: ['task_id'], fks: [['task_id', 'tasks', 'id']] },
  chat_logs:   { id: true, required: ['question', 'answer'] },
  reminder_logs: { id: true, required: ['emp_no', 'subject'], fks: [['emp_no', 'employees', 'emp_no']] },
};
const CASCADES = [['employees', 'emp_no', 'tasks', 'emp_no'], ['employees', 'emp_no', 'reminder_logs', 'emp_no'], ['requests', 'id', 'tasks', 'request_id'], ['tasks', 'id', 'submissions', 'task_id']];

function createFakeSupabase() {
  const tables = Object.fromEntries(Object.keys(SCHEMA).map((t) => [t, []]));
  const seq = Object.fromEntries(Object.keys(SCHEMA).map((t) => [t, 0]));
  const calls = []; // 테스트에서 호출 횟수를 확인하고 싶을 때

  const err = (message, code = 'FAKE') => ({ data: null, error: { message, code } });
  const same = (a, b) => a != null && b != null && String(a) === String(b);

  function validate(table, row) {
    const s = SCHEMA[table];
    for (const f of s.required || []) if (row[f] == null || row[f] === '') return `null value in column "${f}" of relation "${table}" violates not-null constraint`;
    for (const [f, allowed] of Object.entries(s.enums || {})) if (row[f] != null && !allowed.includes(row[f])) return `new row for relation "${table}" violates check constraint "${table}_${f}_check"`;
    for (const f of s.dates || []) if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row[f])) || Number.isNaN(Date.parse(row[f]))) return `invalid input syntax for type date: "${row[f]}"`;
    for (const [col, ref, refCol] of s.fks || []) {
      if (row[col] != null && !tables[ref].some((r) => same(r[refCol], row[col]))) return `insert or update on table "${table}" violates foreign key constraint (${col})`;
    }
    return null;
  }

  function cascadeDelete(table, removed) {
    for (const [parent, pcol, child, ccol] of CASCADES) {
      if (parent !== table) continue;
      const keys = new Set(removed.map((r) => String(r[pcol])));
      const gone = tables[child].filter((r) => keys.has(String(r[ccol])));
      if (gone.length) { tables[child] = tables[child].filter((r) => !gone.includes(r)); cascadeDelete(child, gone); }
    }
  }

  const project = (row, cols) => {
    if (!cols || cols === '*') return { ...row };
    const out = {};
    for (const c of cols.split(',').map((x) => x.trim()).filter(Boolean)) out[c] = row[c];
    return out;
  };

  class Query {
    constructor(table) {
      this.table = table; this.op = 'select'; this.cols = '*'; this.filters = []; this.orders = [];
      this.from = null; this.to = null; this.limitN = null; this.payload = null; this.opts = {}; this.returning = false; this.maybe = false;
    }
    select(cols = '*') { if (this.op === 'select') this.cols = cols; else { this.returning = true; this.cols = cols; } return this; }
    insert(rows) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
    upsert(rows, opts = {}) { this.op = 'upsert'; this.payload = Array.isArray(rows) ? rows : [rows]; this.opts = opts; return this; }
    update(obj) { this.op = 'update'; this.payload = obj; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.filters.push((r) => same(r[c], v)); this.hasFilter = true; return this; }
    neq(c, v) { this.filters.push((r) => r[c] != null && !same(r[c], v)); this.hasFilter = true; return this; }
    gte(c, v) { this.filters.push((r) => r[c] != null && Number(r[c]) >= Number(v)); this.hasFilter = true; return this; }
    like(c, pat) {
      const re = new RegExp('^' + String(pat).split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      this.filters.push((r) => r[c] != null && re.test(String(r[c]))); this.hasFilter = true; return this;
    }
    in(c, vs) { this.filters.push((r) => vs.some((v) => same(r[c], v))); this.hasFilter = true; return this; }
    order(c, { ascending = true } = {}) { this.orders.push([c, ascending]); return this; }
    range(a, b) { this.from = a; this.to = b; return this; }
    limit(n) { this.limitN = n; return this; }
    maybeSingle() { this.maybe = true; return this; }
    then(resolve, reject) { return Promise.resolve().then(() => this.run()).then(resolve, reject); }

    matching() { return tables[this.table].filter((r) => this.filters.every((f) => f(r))); }

    run() {
      const t = this.table; const s = SCHEMA[t];
      calls.push(`${this.op}:${t}`);
      if (!s) return err(`Could not find the table 'public.${t}' in the schema cache`, 'PGRST205');

      if (this.op === 'insert' || this.op === 'upsert') {
        const created = [];
        for (const input of this.payload) {
          const row = { ...input };
          const key = s.pk || 'id';
          if (this.op === 'upsert') {
            const idx = tables[t].findIndex((r) => same(r[key], row[key]));
            if (idx >= 0) { const merged = { ...tables[t][idx], ...row }; const e = validate(t, merged); if (e) return err(e); tables[t][idx] = merged; created.push(merged); continue; }
          }
          if (s.id) { if (row.id != null) return err(`cannot insert a non-DEFAULT value into column "id"`); row.id = ++seq[t]; }
          const now = new Date().toISOString();
          if (['requests', 'tasks', 'chat_logs', 'employees'].includes(t) && !row.created_at) row.created_at = now;
          if (t === 'tasks') { row.updated_at = row.updated_at || now; row.status = row.status || 'normal'; row.assignee = row.assignee || '전체 직원'; row.source_raw = row.source_raw ?? null; row.request_id = row.request_id ?? null; }
          if (t === 'submissions') { row.submitted_at = row.submitted_at || now; for (const c of ['file_name', 'course_name', 'issuer', 'completed_date', 'ocr_text', 'match_method']) row[c] = row[c] ?? null; }
          const e = validate(t, row); if (e) return err(e);
          if (s.pk && tables[t].some((r) => same(r[s.pk], row[s.pk]))) return err(`duplicate key value violates unique constraint "${t}_pkey"`, '23505');
          tables[t].push(row); created.push(row);
        }
        return { data: this.returning ? created.map((r) => project(r, this.cols)) : null, error: null };
      }

      if (this.op === 'update' || this.op === 'delete') {
        if (!this.hasFilter) return err(`${this.op.toUpperCase()} requires a WHERE clause`, '21000');
        const rows = this.matching();
        if (this.op === 'update') {
          for (const r of rows) { const merged = { ...r, ...this.payload }; const e = validate(t, merged); if (e) return err(e); Object.assign(r, this.payload); }
          return { data: this.returning ? rows.map((r) => project(r, this.cols)) : null, error: null };
        }
        tables[t] = tables[t].filter((r) => !rows.includes(r));
        cascadeDelete(t, rows);
        return { data: this.returning ? rows.map((r) => project(r, this.cols)) : null, error: null };
      }

      // select
      let rows = this.matching().slice();
      for (const [c, asc] of [...this.orders].reverse()) rows.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
      if (this.from != null) rows = rows.slice(this.from, this.to + 1);
      if (this.limitN != null) rows = rows.slice(0, this.limitN);
      rows = rows.slice(0, MAX_ROWS); // PostgREST max-rows
      if (this.cols !== '*' && rows[0]) for (const c of this.cols.split(',').map((x) => x.trim())) if (!(c in rows[0])) return err(`column ${t}.${c} does not exist`, '42703');
      const out = rows.map((r) => project(r, this.cols));
      if (this.maybe) { if (out.length > 1) return err('JSON object requested, multiple (or no) rows returned', 'PGRST116'); return { data: out[0] || null, error: null }; }
      return { data: out, error: null };
    }
  }

  // Storage (비공개 버킷) 흉내
  const buckets = new Map();
  const storage = {
    createBucket: async (name) => { if (buckets.has(name)) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } }; buckets.set(name, new Map()); return { data: { name }, error: null }; },
    from: (name) => ({
      upload: async (path, body) => { const b = buckets.get(name); if (!b) return { data: null, error: { message: 'Bucket not found' } }; if (b.has(path)) return { data: null, error: { message: 'The resource already exists' } }; b.set(path, Buffer.from(body)); return { data: { path }, error: null }; },
      download: async (path) => { const b = buckets.get(name); const v = b && b.get(path); return v ? { data: new Blob([v]), error: null } : { data: null, error: { message: 'Object not found' } }; },
    }),
  };
  return { from: (t) => new Query(t), storage, _tables: tables, _calls: calls, _buckets: buckets };
}

module.exports = { createFakeSupabase };
