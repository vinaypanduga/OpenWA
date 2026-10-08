import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** Records whether a saved collection was created from the custom or Supabase tab. */
export class AddCustomGroupSource1786900000000 implements MigrationInterface {
  name = 'AddCustomGroupSource1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('custom_groups')) || (await queryRunner.hasColumn('custom_groups', 'source')))
      return;
    await queryRunner.addColumn(
      'custom_groups',
      new TableColumn({
        name: 'source',
        type: 'varchar',
        length: '20',
        isNullable: false,
        default: "'custom'",
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('custom_groups')) || !(await queryRunner.hasColumn('custom_groups', 'source')))
      return;
    await queryRunner.dropColumn('custom_groups', 'source');
  }
}
