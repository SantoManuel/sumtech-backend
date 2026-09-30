import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { OltEntity } from './olt.entity';
import { OltInterfaceVlanEntity } from './olt-interface-vlan.entity';

@Entity({ schema: 'net', name: 'olt_interfaces' })
export class OltInterfaceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'olt_id', type: 'uuid' })
  oltId: string;

  @ManyToOne(() => OltEntity, (olt) => olt.interfaces, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'olt_id' })
  olt: OltEntity;

  @Column({ type: 'varchar', length: 100 })
  name: string; // ej. 'gpon-olt_1/1/1', 'gei_1/3/1'

  @Column({ type: 'varchar', length: 30 })
  type: 'PON' | 'UPLINK' | 'DOWNLINK' | 'MGMT';

  @Column({ type: 'int' })
  slot: number;

  @Column({ type: 'int' })
  port: number;

  @Column({ name: 'admin_state', type: 'varchar', length: 20, default: 'UP' })
  adminState: 'UP' | 'DOWN';

  @Column({ name: 'oper_state', type: 'varchar', length: 20, default: 'UP' })
  operState: 'UP' | 'DOWN';

  @OneToMany(() => OltInterfaceVlanEntity, (vlanMap) => vlanMap.interface, { cascade: true })
  vlans?: OltInterfaceVlanEntity[];

  @CreateDateColumn({ name: 'discovered_at', type: 'timestamp with time zone' })
  discoveredAt: Date;
}
