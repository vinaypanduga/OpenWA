import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScheduledMessageRecurrence1786600000000 implements MigrationInterface {
  name = 'AddScheduledMessageRecurrence1786600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const date = queryRunner.dataSource.options.type === 'postgres' ? 'timestamp' : 'text';
    const columns: Array<[string, string]> = [
      ['scheduleType', `varchar(20) NOT NULL DEFAULT 'once'`],
      ['recurrenceDays', 'text'],
      ['recurrenceTime', 'varchar(5)'],
      ['timezone', 'varchar(100)'],
      ['runCount', 'integer NOT NULL DEFAULT 0'],
      ['lastRunAt', date],
    ];
    for (const [name, definition] of columns) {
      if (!(await queryRunner.hasColumn('scheduled_messages', name))) {
        await queryRunner.query(`ALTER TABLE "scheduled_messages" ADD COLUMN "${name}" ${definition}`);
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of ['lastRunAt', 'runCount', 'timezone', 'recurrenceTime', 'recurrenceDays', 'scheduleType']) {
      if (await queryRunner.hasColumn('scheduled_messages', name)) {
        await queryRunner.dropColumn('scheduled_messages', name);
      }
    }
  }
}
