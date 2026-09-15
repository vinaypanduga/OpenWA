import { DataSource } from 'typeorm';
import { AddMessageReactionCount1786810000000 } from '../1786810000000-AddMessageReactionCount';

describe('AddMessageReactionCount migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await ds.initialize();
    await ds.query(`CREATE TABLE "messages" ("id" varchar PRIMARY KEY NOT NULL)`);
  });

  afterEach(async () => ds.destroy());

  const columnNames = async (): Promise<string[]> => {
    const rows = await ds.query<Array<{ name: string }>>(`PRAGMA table_info("messages")`);
    return rows.map(row => row.name);
  };

  it('adds a zero-based count for existing rows and is idempotent', async () => {
    await ds.query(`INSERT INTO "messages" ("id") VALUES ('old-message')`);
    const migration = new AddMessageReactionCount1786810000000();
    const runner = ds.createQueryRunner();
    await migration.up(runner);
    await expect(migration.up(runner)).resolves.toBeUndefined();

    expect(await columnNames()).toContain('reactionCount');
    await expect(ds.query(`SELECT "reactionCount" FROM "messages"`)).resolves.toEqual([{ reactionCount: 0 }]);
  });

  it('removes the reaction count on rollback', async () => {
    const migration = new AddMessageReactionCount1786810000000();
    const runner = ds.createQueryRunner();
    await migration.up(runner);
    await migration.down(runner);
    expect(await columnNames()).toEqual(['id']);
  });
});
