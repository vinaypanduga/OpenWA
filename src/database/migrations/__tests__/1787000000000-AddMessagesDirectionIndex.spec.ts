import { DataSource } from 'typeorm';
import { AddMessagesDirectionIndex1787000000000 } from '../1787000000000-AddMessagesDirectionIndex';

describe('AddMessagesDirectionIndex migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await ds.initialize();
    await ds.query(
      `CREATE TABLE "messages" (` +
        `"id" varchar PRIMARY KEY NOT NULL, ` +
        `"direction" varchar NOT NULL DEFAULT ('outgoing'), ` +
        `"body" text)`,
    );
    await ds.query(
      `INSERT INTO "messages" ("id", "direction", "body") VALUES ` +
        `('one', 'outgoing', 'large payload'), ('two', 'incoming', 'large payload')`,
    );
  });

  afterEach(async () => {
    await ds.destroy();
  });

  const indexNames = async (): Promise<string[]> => {
    const rows = await ds.query<{ name: string }[]>(`PRAGMA index_list("messages")`);
    return rows.map(row => row.name);
  };

  it('creates an idempotent direction index and down removes it', async () => {
    const runner = ds.createQueryRunner();
    const migration = new AddMessagesDirectionIndex1787000000000();

    await migration.up(runner);
    await expect(migration.up(runner)).resolves.toBeUndefined();
    expect(await indexNames()).toContain('IDX_messages_direction');

    await migration.down(runner);
    expect(await indexNames()).not.toContain('IDX_messages_direction');
  });

  it('serves the overview direction aggregate from the covering index', async () => {
    const runner = ds.createQueryRunner();
    await new AddMessagesDirectionIndex1787000000000().up(runner);

    const plan = await ds.query<{ detail: string }[]>(
      `EXPLAIN QUERY PLAN SELECT "direction", COUNT(*) FROM "messages" GROUP BY "direction"`,
    );

    expect(plan.map(row => row.detail).join(' | ')).toMatch(
      /SCAN messages USING COVERING INDEX IDX_messages_direction/,
    );
  });
});
