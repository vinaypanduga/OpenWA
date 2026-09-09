import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDashboardSessions1786800000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE IF NOT EXISTS "dashboard_sessions" (
      "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      "tokenHash" varchar NOT NULL UNIQUE, "apiKeyId" varchar NOT NULL,
      "credentialVersion" varchar NOT NULL, "expiresAt" datetime NOT NULL)`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE IF EXISTS "dashboard_sessions"');
  }
}
