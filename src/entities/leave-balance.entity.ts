import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Employee } from './employee.entity';

@Entity()
export class LeaveBalance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  employeeId: string;

  @Column()
  locationId: string;

  // Stored as decimal, but manipulated via integer math in the service
  @Column('decimal', { precision: 10, scale: 2 })
  balance: number;

  @Column({ type: 'datetime', nullable: true })
  lastSyncedAt: Date | null;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employeeId' })
  employee: Employee;
}