import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Session } from '../../session/entities/session.entity';

/** A named, reusable collection of WhatsApp groups. It does not create a WhatsApp group. */
@Index('IDX_custom_groups_session_name', ['sessionId', 'name'], { unique: true })
@Entity('custom_groups')
export class CustomGroup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  sessionId!: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session!: Session;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  // simple-json keeps the schema portable across SQLite and PostgreSQL.
  @Column({ type: 'simple-json' })
  groupIds!: string[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
