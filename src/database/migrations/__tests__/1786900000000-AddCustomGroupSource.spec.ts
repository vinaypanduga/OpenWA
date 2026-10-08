import { DataSource } from 'typeorm';
import { AddCustomGroupSource1786900000000 } from '../1786900000000-AddCustomGroupSource';

describe('AddCustomGroupSource migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await ds.initialize();
    await ds.query(`CREATE TABLE "custom_groups" ("id" varchar PRIMARY KEY NOT NULL)`);
  });

  afterEach(async () => ds.destroy());

  const columnNames = async (): Promise<string[]> => {
    const rows = await ds.query<Array<{ name: string }>>(`PRAGMA table_info("custom_groups")`);
    return rows.map(row => row.name);
  };

  it('classifies existing collections as custom and is idempotent', async () => {
    await ds.query(`INSERT INTO "custom_groups" ("id") VALUES ('legacy-collection')`);
    const migration = new AddCustomGroupSource1786900000000();
    const runner = ds.createQueryRunner();
    await migration.up(runner);
    await expect(migration.up(runner)).resolves.toBeUndefined();

    expect(await columnNames()).toContain('source');
    await expect(ds.query(`SELECT "source" FROM "custom_groups"`)).resolves.toEqual([{ source: 'custom' }]);
  });

  it('removes the source on rollback', async () => {
    const migration = new AddCustomGroupSource1786900000000();
    const runner = ds.createQueryRunner();
    await migration.up(runner);
    await migration.down(runner);
    expect(await columnNames()).toEqual(['id']);
  });
});
