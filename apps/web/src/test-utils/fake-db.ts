import { randomUUID } from "node:crypto";
import { SQL, getTableColumns, getTableName, is, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// An in-memory stand-in for the Drizzle `db` used by end-to-end handler tests
// (S94). It runs the real query builders' conditions: each WHERE is rendered
// with the Postgres dialect and evaluated against stored rows. Only AND-joined
// predicates of the shapes the handoff code uses are supported:
// `col = $n`, `col > / >= / < / <= $n`, `col in (...)`, `col not in (...)`,
// `col is null`, `col is not null`, and `jsonb ->> 'key' = $n`. Anything else
// throws, so a test cannot silently pass on an unparsed condition.

type Row = Record<string, unknown>;

const dialect = new PgDialect();

const PREDICATE =
  /"(\w+)"\."(\w+)"(?: ->> '(\w+)')? (not in|in|is not null|is null|>=|<=|<>|=|>|<)(?: \(([^)]*)\)| \$(\d+))?/g;

function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) {
    const time = Date.parse(value.includes("T") || value.endsWith("Z") ? value : `${value}Z`);
    if (!Number.isNaN(time)) return time;
  }
  return value;
}

function columnMap(table: Table): Map<string, string> {
  const map = new Map<string, string>();
  for (const [field, column] of Object.entries(getTableColumns(table))) map.set(column.name, field);
  return map;
}

export type FakeDb = ReturnType<typeof createFakeDb>;

export function createFakeDb(tables: Record<string, Table>) {
  const store = new Map<string, Row[]>();
  const byName = new Map<string, Table>();
  for (const table of Object.values(tables)) {
    byName.set(getTableName(table), table);
    store.set(getTableName(table), []);
  }

  function rowsOf(table: Table): Row[] {
    const rows = store.get(getTableName(table));
    if (!rows) throw new Error(`fake db: unknown table ${getTableName(table)}`);
    return rows;
  }

  function predicate(where: SQL | undefined): (row: Row) => boolean {
    if (!where) return () => true;
    const { sql, params } = dialect.sqlToQuery(where);
    if (/\bor\b/i.test(sql)) throw new Error(`fake db: OR is not supported: ${sql}`);
    const checks: ((row: Row) => boolean)[] = [];
    let consumed = sql.replace(/[()\s]|\band\b/g, "");
    for (const m of sql.matchAll(PREDICATE)) {
      const [whole, tableName, column, jsonKey, op, list, param] = m;
      consumed = consumed.replace(whole.replace(/[()\s]|\band\b/g, ""), "");
      const fields = columnMap(byName.get(tableName) ?? fail(`unknown table ${tableName}`));
      const field = fields.get(column) ?? fail(`unknown column ${tableName}.${column}`);
      const read = (row: Row) => {
        const value = row[field];
        return jsonKey ? ((value as Row | null)?.[jsonKey] ?? null) : value;
      };
      const arg = param ? params[Number(param) - 1] : undefined;
      const items = list
        ? list.split(",").map((p) => params[Number(p.trim().slice(1)) - 1])
        : [];
      checks.push((row) => {
        const value = comparable(read(row));
        switch (op) {
          case "is null":
            return value === null || value === undefined;
          case "is not null":
            return value !== null && value !== undefined;
          case "in":
            return items.map(comparable).includes(value);
          case "not in":
            return !items.map(comparable).includes(value);
        }
        if (value === null || value === undefined) return false;
        const other = comparable(arg) as number | string;
        const left = value as number | string;
        switch (op) {
          case "=":
            return left === other || String(left) === String(other);
          case "<>":
            return left !== other;
          case ">":
            return left > other;
          case ">=":
            return left >= other;
          case "<":
            return left < other;
          case "<=":
            return left <= other;
        }
        return fail(`operator ${op}`);
      });
    }
    if (consumed.length > 0) fail(`unparsed condition: ${sql}`);
    return (row) => checks.every((check) => check(row));
  }

  function fail(message: string): never {
    throw new Error(`fake db: ${message}`);
  }

  /** Apply a `.set()` object; a `SQL` value is only understood as a jsonb append. */
  function applySet(row: Row, values: Row) {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      if (is(value, SQL)) {
        const { sql, params } = dialect.sqlToQuery(value);
        if (!sql.includes("||")) fail(`unsupported SET expression: ${sql}`);
        const appended = JSON.parse(String(params.at(-1))) as unknown[];
        row[key] = [...((row[key] as unknown[] | null) ?? []), ...appended];
      } else {
        row[key] = value;
      }
    }
  }

  function withDefaults(table: Table, values: Row): Row {
    const row: Row = {};
    const now = new Date();
    for (const [field, column] of Object.entries(getTableColumns(table))) {
      if (values[field] !== undefined) row[field] = values[field];
      else if (field === "id") row[field] = randomUUID();
      else if (column.default !== undefined && !is(column.default, SQL)) row[field] = column.default;
      else if (field === "createdAt" || field === "updatedAt") row[field] = now;
      else if (column.dataType === "json") row[field] = column.default !== undefined ? [] : null;
      else row[field] = null;
    }
    return row;
  }

  function project(row: Row, fields?: Record<string, unknown>): Row {
    if (!fields) return { ...row };
    const out: Row = {};
    for (const [key, column] of Object.entries(fields)) {
      const name = (column as { name?: string }).name;
      const table = (column as { table?: Table }).table;
      if (!name || !table) fail(`unsupported select field ${key}`);
      out[key] = row[columnMap(table).get(name)!];
    }
    return out;
  }

  /** A thenable builder: each call records state; awaiting runs it. */
  function query<T>(run: (state: Row) => T) {
    const state: Row = {};
    const builder: Record<string, unknown> = {};
    const record = (name: string) =>
      (...args: unknown[]) => {
        state[name] = args.length > 1 ? args : args[0];
        return builder;
      };
    for (const name of ["from", "where", "set", "values", "orderBy", "limit", "returning", "onConflictDoNothing", "innerJoin", "leftJoin"]) {
      builder[name] = record(name);
    }
    builder.returning = (...args: unknown[]) => {
      state.returning = args[0] ?? true;
      return builder;
    };
    builder.then = (resolve: (v: T) => unknown, reject: (e: unknown) => unknown) => {
      try {
        return Promise.resolve(run(state)).then(resolve, reject);
      } catch (error) {
        return Promise.reject(error).then(resolve, reject);
      }
    };
    return builder;
  }

  function sortRows(rows: Row[], orderBy: unknown): Row[] {
    if (!orderBy) return rows;
    const first = Array.isArray(orderBy) ? orderBy[0] : orderBy;
    const { sql } = dialect.sqlToQuery(is(first, SQL) ? first : (first as SQL));
    const m = /"(\w+)"\."(\w+)"( desc)?/.exec(sql);
    if (!m) return rows;
    const field = columnMap(byName.get(m[1])!).get(m[2])!;
    const dir = m[3] ? -1 : 1;
    return [...rows].sort((a, b) => {
      const x = comparable(a[field]) as number;
      const y = comparable(b[field]) as number;
      return x < y ? -dir : x > y ? dir : 0;
    });
  }

  const db = {
    select(fields?: Record<string, unknown>) {
      return query((state) => {
        const table = state.from as Table;
        const match = predicate(state.where as SQL | undefined);
        let rows = sortRows(rowsOf(table).filter(match), state.orderBy);
        if (typeof state.limit === "number") rows = rows.slice(0, state.limit);
        return rows.map((row) => project(row, fields));
      });
    },
    update(table: Table) {
      return query((state) => {
        const match = predicate(state.where as SQL | undefined);
        const hit = rowsOf(table).filter(match);
        for (const row of hit) applySet(row, state.set as Row);
        return state.returning ? hit.map((row) => ({ ...row })) : undefined;
      });
    },
    insert(table: Table) {
      return query((state) => {
        const list = Array.isArray(state.values) ? (state.values as Row[]) : [state.values as Row];
        const rows = rowsOf(table);
        const inserted: Row[] = [];
        for (const values of list) {
          const row = withDefaults(table, values);
          // The one partial unique index the handoff code relies on.
          if (
            getTableName(table) === "handoff_requests" &&
            row.status === "open" &&
            rows.some((r) => r.chatId === row.chatId && r.status === "open")
          ) {
            if (state.onConflictDoNothing !== undefined) continue;
            fail("unique violation: handoff_requests_chat_open_uidx");
          }
          if (
            getTableName(table) === "handoff_requests" &&
            row.tokenHash !== null &&
            rows.some((r) => r.tokenHash === row.tokenHash)
          ) {
            fail("unique violation: handoff_requests_token_hash_uidx");
          }
          rows.push(row);
          inserted.push({ ...row });
        }
        return state.returning ? inserted : undefined;
      });
    },
    delete(table: Table) {
      return query((state) => {
        const match = predicate(state.where as SQL | undefined);
        const rows = rowsOf(table);
        store.set(getTableName(table), rows.filter((row) => !match(row)));
        return undefined;
      });
    },
    async execute() {
      return [];
    },
    async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      return fn(db);
    },
    query: new Proxy(
      {},
      {
        get(_target, key: string) {
          const table = Object.values(tables).find((t) => tables[key] === t);
          if (!table) fail(`db.query.${key} is not registered`);
          return {
            async findFirst(opts: { where?: SQL } = {}) {
              const match = predicate(opts.where);
              const row = rowsOf(table).find(match);
              return row ? { ...row } : undefined;
            },
            async findMany(opts: { where?: SQL } = {}) {
              const match = predicate(opts.where);
              return rowsOf(table).filter(match).map((row) => ({ ...row }));
            },
          };
        },
      },
    ),
  };

  return {
    db,
    /** Seed or inspect a table's raw rows. */
    rows(table: Table): Row[] {
      return rowsOf(table);
    },
    seed(table: Table, values: Row): Row {
      const row = withDefaults(table, values);
      rowsOf(table).push(row);
      return row;
    },
    reset() {
      for (const key of store.keys()) store.set(key, []);
    },
  };
}
