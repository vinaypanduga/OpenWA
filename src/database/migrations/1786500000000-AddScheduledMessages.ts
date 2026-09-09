import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScheduledMessages1786500000000 implements MigrationInterface {
  name = 'AddScheduledMessages1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('scheduled_messages')) return;
    const isPostgres = queryRunner.dataSource.options.type === 'postgres';
    const id = isPostgres
      ? 'varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar'
      : 'varchar PRIMARY KEY NOT NULL';
    const date = isPostgres ? 'timestamp' : 'text';
    const dates = isPostgres
      ? '"createdAt" timestamp NOT NULL DEFAULT NOW(), "updatedAt" timestamp NOT NULL DEFAULT NOW()'
      : '"createdAt" datetime NOT NULL DEFAULT (datetime(\'now\')), "updatedAt" datetime NOT NULL DEFAULT (datetime(\'now\'))';
    await queryRunner.query(
      `CREATE TABLE "scheduled_messages" ("id" ${id}, "sessionId" varchar NOT NULL, "customGroupId" varchar NOT NULL, "name" varchar(100) NOT NULL, "messageType" varchar(20) NOT NULL, "content" text NOT NULL, "scheduledAt" ${date} NOT NULL, "minDelaySeconds" integer NOT NULL DEFAULT 2, "maxDelaySeconds" integer NOT NULL DEFAULT 10, "status" varchar NOT NULL DEFAULT 'pending', "batchId" varchar, "error" text, "startedAt" ${date}, "completedAt" ${date}, ${dates}, CONSTRAINT "FK_scheduled_messages_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_scheduled_messages_customGroupId" FOREIGN KEY ("customGroupId") REFERENCES "custom_groups" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_messages_due" ON "scheduled_messages" ("status", "scheduledAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scheduled_messages_session" ON "scheduled_messages" ("sessionId", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_scheduled_messages_due"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_scheduled_messages_session"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "scheduled_messages"`);
  }
}
