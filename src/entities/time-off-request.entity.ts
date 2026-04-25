import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Employee } from './employee.entity';
import { HcmStatus, ManagerStatus } from '../enums/status.enum';

@Entity()
export class TimeOffRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  employeeId: string;

  @Column()
  locationId: string;

  @Column('decimal', { precision: 10, scale: 2 })
  days: number;

  @Column({ type: 'varchar', default: HcmStatus.PENDING })
  status: HcmStatus;

  @Column({ type: 'varchar', default: ManagerStatus.PENDING_REVIEW })
  manager_status: ManagerStatus;

  @Column({ nullable: true })
  hcmRef: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Employee)
  @JoinColumn({ name: 'employeeId' })
  employee: Employee;
}