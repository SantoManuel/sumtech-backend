import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { OltInterfaceVlanEntity } from './olt-interface-vlan.entity';

@Entity({ schema: 'net', name: 'vlans' })
export class VlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'vlan_id', type: 'int', unique: true })
  vlanId: number;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 30, default: 'INTERNET' })
  type: 'INTERNET' | 'IPTV' | 'MGMT' | 'TR069' | 'VOIP';

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => OltInterfaceVlanEntity, (map) => map.vlan)
  interfaceMappings?: OltInterfaceVlanEntity[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
