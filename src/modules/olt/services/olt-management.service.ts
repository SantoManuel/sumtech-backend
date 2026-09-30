import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OltEntity } from '../entities/olt.entity';
import { OltRolePermissionEntity } from '../entities/olt-role-permission.entity';
import { OltInterfaceEntity } from '../entities/olt-interface.entity';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { ZteC320Driver } from '../drivers/zte-c320.driver';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';
import { encryptCredential, decryptCredential } from '../../network-connectivity/utils/crypto.util';
import { OltConnectionParams } from '../ports/olt-driver.port';

@Injectable()
export class OltManagementService {
  private readonly logger = new Logger(OltManagementService.name);

  constructor(
    @InjectRepository(OltEntity)
    private readonly oltRepository: Repository<OltEntity>,
    @InjectRepository(OltRolePermissionEntity)
    private readonly permRepository: Repository<OltRolePermissionEntity>,
    @InjectRepository(OltInterfaceEntity)
    private readonly ifaceRepository: Repository<OltInterfaceEntity>,
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    private readonly zteDriver: ZteC320Driver,
    private readonly reachabilityResolver: ReachabilityResolver,
    private readonly deviceOperationLogger: DeviceOperationLogger,
  ) {}

  async findAll(activeOnly = false) {
    const where = activeOnly ? { isActive: true } : {};
    return this.oltRepository.find({
      where,
      relations: ['viaNode', 'zone', 'rolePermissions', 'interfaces'],
      order: { name: 'ASC' },
    });
  }

  async findById(id: string) {
    const olt = await this.oltRepository.findOne({
      where: { id },
      relations: ['viaNode', 'zone', 'rolePermissions', 'interfaces', 'interfaces.vlans', 'interfaces.vlans.vlan'],
    });
    if (!olt) {
      throw new NotFoundException(`OLT no encontrada: ${id}`);
    }
    return olt;
  }

  async create(dto: any, actorUserId?: string) {
    const passwordEnc = encryptCredential(dto.password || 'smartoltuser');
    const enablePasswordEnc = dto.enablePassword ? encryptCredential(dto.enablePassword) : undefined;

    const olt = this.oltRepository.create({
      name: dto.name,
      vendor: dto.vendor || 'ZTE',
      model: dto.model || 'C320',
      host: dto.host,
      port: dto.port || 23,
      apiProtocol: dto.apiProtocol || 'TELNET',
      username: dto.username || 'smartoltuser',
      passwordEnc,
      enablePasswordEnc,
      connectionMethod: dto.connectionMethod || 'VIA_MIKROTIK',
      viaNodeId: dto.viaNodeId || null,
      natPort: dto.natPort || 2323,
      zoneId: dto.zoneId || null,
      mgmtVlanId: dto.mgmtVlanId || null,
      notes: dto.notes,
      isActive: dto.isActive !== undefined ? dto.isActive : true,
    });

    const saved = await this.oltRepository.save(olt);

    // Seeding de permisos iniciales por rol (§1.6)
    const defaultPerms = [
      { role: 'ADMIN', canView: true, canOperate: true, canConfigure: true },
      { role: 'GERENTE', canView: true, canOperate: true, canConfigure: true },
      { role: 'TECNICO', canView: true, canOperate: true, canConfigure: false },
      { role: 'AGENTE_CRM', canView: true, canOperate: false, canConfigure: false },
      { role: 'CAJERO', canView: false, canOperate: false, canConfigure: false },
    ];

    for (const p of defaultPerms) {
      await this.permRepository.save(
        this.permRepository.create({
          oltId: saved.id,
          role: p.role,
          canView: p.canView,
          canOperate: p.canOperate,
          canConfigure: p.canConfigure,
        }),
      );
    }

    await this.deviceOperationLogger.logEvent({
      nodeId: saved.viaNodeId || saved.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `OLT creada: "${saved.name}" (${saved.vendor} ${saved.model} en ${saved.host})`,
      actorUserId,
      rawDetails: { oltId: saved.id },
    });

    return this.findById(saved.id);
  }

  async update(id: string, dto: any, actorUserId?: string) {
    const olt = await this.findById(id);

    if (dto.password) {
      olt.passwordEnc = encryptCredential(dto.password);
    }
    if (dto.enablePassword !== undefined) {
      olt.enablePasswordEnc = dto.enablePassword ? encryptCredential(dto.enablePassword) : undefined;
    }

    if (dto.name !== undefined) olt.name = dto.name;
    if (dto.vendor !== undefined) olt.vendor = dto.vendor;
    if (dto.model !== undefined) olt.model = dto.model;
    if (dto.host !== undefined) olt.host = dto.host;
    if (dto.port !== undefined) olt.port = dto.port;
    if (dto.apiProtocol !== undefined) olt.apiProtocol = dto.apiProtocol;
    if (dto.username !== undefined) olt.username = dto.username;
    if (dto.connectionMethod !== undefined) olt.connectionMethod = dto.connectionMethod;
    if (dto.viaNodeId !== undefined) olt.viaNodeId = dto.viaNodeId;
    if (dto.natPort !== undefined) olt.natPort = dto.natPort;
    if (dto.zoneId !== undefined) olt.zoneId = dto.zoneId;
    if (dto.mgmtVlanId !== undefined) olt.mgmtVlanId = dto.mgmtVlanId;
    if (dto.notes !== undefined) olt.notes = dto.notes;
    if (dto.isActive !== undefined) olt.isActive = dto.isActive;

    await this.oltRepository.save(olt);

    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `OLT modificada: "${olt.name}"`,
      actorUserId,
    });

    return this.findById(id);
  }

  async testConnection(id: string) {
    const olt = await this.findById(id);
    const connParams = await this.resolveOltConnectionParams(olt);

    const test = await this.zteDriver.testConnection(connParams);
    olt.lastCheckedAt = new Date();

    if (test.ok) {
      olt.connectionStatus = 'CONECTADO';
      olt.lastSuccessfulConnectionAt = new Date();

      // Intentar refrescar versión y uptime
      try {
        const sysInfo = await this.zteDriver.getSystemInfo(connParams);
        olt.firmwareVersion = sysInfo.firmwareVersion;
      } catch {
        // Ignorar fallo secundario de system-info
      }
    } else {
      olt.connectionStatus = test.error?.includes('Login fallido') ? 'ERROR_AUTH' : 'INALCANZABLE';
    }

    await this.oltRepository.save(olt);

    return {
      ok: test.ok,
      status: olt.connectionStatus,
      latencyMs: test.latencyMs,
      error: test.error,
      firmwareVersion: olt.firmwareVersion,
    };
  }

  /**
   * Ejecuta el escaneo de interfaces físicas/PON (RF-OLT-012) y persiste en net.olt_interfaces.
   */
  async discoverInterfaces(id: string, actorUserId?: string) {
    const olt = await this.findById(id);
    const connParams = await this.resolveOltConnectionParams(olt);

    const discovered = await this.zteDriver.discoverInterfaces(connParams);

    for (const iface of discovered) {
      let existing = await this.ifaceRepository.findOneBy({
        oltId: olt.id,
        name: iface.name,
      });

      if (!existing) {
        existing = this.ifaceRepository.create({
          oltId: olt.id,
          name: iface.name,
          type: iface.type,
          slot: iface.slot,
          port: iface.port,
        });
      }

      existing.adminState = iface.adminState;
      existing.operState = iface.operState;
      await this.ifaceRepository.save(existing);
    }

    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `Descubrimiento de interfaces completado para OLT "${olt.name}": ${discovered.length} interfaces detectadas.`,
      actorUserId,
    });

    return this.ifaceRepository.find({ where: { oltId: olt.id }, order: { name: 'ASC' } });
  }

  /**
   * Resuelve el host y puerto reales según el connection_method de la OLT.
   */
  private async resolveOltConnectionParams(olt: OltEntity): Promise<OltConnectionParams> {
    let host = olt.host;
    let port = olt.port || 23;

    if (olt.connectionMethod === 'VIA_MIKROTIK') {
      if (!olt.viaNodeId) {
        throw new BadRequestException(`La OLT "${olt.name}" usa VIA_MIKROTIK pero no tiene viaNodeId.`);
      }
      const node = await this.nodeRepository.findOneBy({ id: olt.viaNodeId });
      if (!node) {
        throw new NotFoundException(`Router MikroTik asignado no encontrado.`);
      }
      const endpoint = await this.reachabilityResolver.resolveEndpoint(node);
      host = endpoint.host;
      port = olt.natPort || 2323;
    }

    const password = decryptCredential(olt.passwordEnc);
    const enablePassword = olt.enablePasswordEnc ? decryptCredential(olt.enablePasswordEnc) : undefined;

    return {
      host,
      port,
      username: olt.username,
      password,
      enablePassword,
    };
  }
}
