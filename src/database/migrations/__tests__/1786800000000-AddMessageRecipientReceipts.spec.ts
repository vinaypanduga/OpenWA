import { DataSource } from 'typeorm';
import { AddMessageRecipientReceipts1786800000000 } from '../1786800000000-AddMessageRecipientReceipts';

describe('AddMessageRecipientReceipts migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await ds.initialize();
    await ds.query(`CREATE TABLE "messages" ("id" varchar PRIMARY KEY NOT NULL)`);
  });

  afterEach(async () => ds.destroy());

  const columns = async (): Promise<Array<{ name: string; dflt_value: string | null }>> =>
    ds.query(`PRAGMA table_info("messages")`);

  it('adds recipient sets and zero-based count mirrors without changing existing rows', async () => {
    await ds.query(`INSERT INTO "messages" ("id") VALUES ('old-message')`);
    await new AddMessageRecipientReceipts1786800000000().up(ds.createQueryRunner());

    const names = (await columns()).map(column => column.name);
    expect(names).toEqual(expect.arrayContaining(['deliveredTo', 'readBy', 'deliveryCount', 'readCount']));
    await expect(
      ds.query(`SELECT "deliveryCount", "readCount" FROM "messages" WHERE "id" = 'old-message'`),
    ).resolves.toEqual([{ deliveryCount: 0, readCount: 0 }]);
  });

  it('is idempotent and down removes only the receipt columns', async () => {
    const migration = new AddMessageRecipientReceipts1786800000000();
    const runner = ds.createQueryRunner();
    await migration.up(runner);
    await expect(migration.up(runner)).resolves.toBeUndefined();
    await migration.down(runner);

    expect((await columns()).map(column => column.name)).toEqual(['id']);
  });
});
