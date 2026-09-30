import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { OltInterfaceEntity } from './olt-interface.entity';
import { VlanEntity } from './vlan.entity';

@Entity({ schema: 'net', name: 'olt_interface_vlans' })
export class OltInterfaceVlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'interface_id', type: 'uuid' })
  interfaceId: string;

  @ManyToOne(() => OltInterfaceEntity, (iface) => iface.vlans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'interface_id' })
  interface: OltInterfaceEntity;

  @Column({ name: 'vlan_id', type: 'uuid' })
  vlanId: string;

  @ManyToOne(() => VlanEntity, (vlan) => vlan.interfaceMappings, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vlan_id' })
  vlan: VlanEntity;

  @Column({ type: 'varchar', length: 20, default: 'TAG' })
  mode: 'TAG' | 'UNTAG';

  @Column({ type: 'varchar', length: 30, nullable: true })
  function?: string;

  @Column({ name: 'apply_status', type: 'varchar', length: 30, default: 'APPLIED' })
  applyStatus: 'APPLIED' | 'PENDING' | 'ERROR';

  @CreateDateColumn({ name: 'applied_at', type: 'timestamp with time zone' })
  appliedAt: Date;
}
