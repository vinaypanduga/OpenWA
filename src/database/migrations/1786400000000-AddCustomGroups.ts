import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomGroups1786400000000 implements MigrationInterface {
  name = 'AddCustomGroups1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('custom_groups')) return;
    const isPostgres = queryRunner.dataSource.options.type === 'postgres';
    const id = isPostgres
      ? 'varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar'
      : 'varchar PRIMARY KEY NOT NULL';
    const dates = isPostgres
      ? '"createdAt" timestamp NOT NULL DEFAULT NOW(), "updatedAt" timestamp NOT NULL DEFAULT NOW()'
      : '"createdAt" datetime NOT NULL DEFAULT (datetime(\'now\')), "updatedAt" datetime NOT NULL DEFAULT (datetime(\'now\'))';
    await queryRunner.query(
      `CREATE TABLE "custom_groups" ("id" ${id}, "sessionId" varchar NOT NULL, "name" varchar(100) NOT NULL, "groupIds" text NOT NULL, ${dates}, CONSTRAINT "FK_custom_groups_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_custom_groups_sessionId" ON "custom_groups" ("sessionId")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_custom_groups_session_name" ON "custom_groups" ("sessionId", "name")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_custom_groups_session_name"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_custom_groups_sessionId"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "custom_groups"`);
  }
}
