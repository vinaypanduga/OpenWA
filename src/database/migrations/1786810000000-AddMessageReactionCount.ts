import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds the denormalized active-reaction count used by sent-message engagement analytics. */
export class AddMessageReactionCount1786810000000 implements MigrationInterface {
  name = 'AddMessageReactionCount1786810000000';

  private async hasColumn(queryRunner: QueryRunner): Promise<boolean> {
    if (queryRunner.connection.options.type === 'postgres') {
      const rows = (await queryRunner.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'messages' AND column_name = 'reactionCount'`,
      )) as unknown[];
      return rows.length > 0;
    }
    const rows = (await queryRunner.query(`PRAGMA table_info("messages")`)) as Array<{ name: string }>;
    return rows.some(row => row.name === 'reactionCount');
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasColumn(queryRunner)) return;
    await queryRunner.query(`ALTER TABLE "messages" ADD COLUMN "reactionCount" integer NOT NULL DEFAULT 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.hasColumn(queryRunner))) return;
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "reactionCount"`);
  }
}
