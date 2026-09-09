import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('dashboard_sessions')
export class DashboardSession {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ unique: true })
  tokenHash!: string;

  @Column()
  apiKeyId!: string;

  @Column()
  credentialVersion!: string;

  @Column({ type: 'datetime' })
  expiresAt!: Date;
}
