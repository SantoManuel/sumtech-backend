import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VlanEntity } from '../entities/vlan.entity';
import { OltInterfaceEntity } from '../entities/olt-interface.entity';
import { OltInterfaceVlanEntity } from '../entities/olt-interface-vlan.entity';
import { OltSpeedProfileEntity } from '../entities/olt-speed-profile.entity';
import { OnuTypeEntity } from '../entities/onu-type.entity';
import { Tr069NetworkEntity } from '../entities/tr069-network.entity';
import { OltEntity } from '../entities/olt.entity';
import { OltDriverRegistry } from '../drivers/olt-driver.registry';
import { UnknownOltVendorError } from '../ports/olt-driver.port';
import { decryptCredential } from '../../network-connectivity/utils/crypto.util';

import { PlanEntity } from '../../plans/entities/plan.entity';
import { CreateOltSpeedProfileDto, UpdateOltSpeedProfileDto } from '../dto/speed-profile.dto';

@Injectable()
export class OltCatalogsService {
  constructor(
    @InjectRepository(VlanEntity)
    private readonly vlanRepository: Repository<VlanEntity>,
    @InjectRepository(OltInterfaceEntity)
    private readonly ifaceRepository: Repository<OltInterfaceEntity>,
    @InjectRepository(OltInterfaceVlanEntity)
    private readonly ifaceVlanRepository: Repository<OltInterfaceVlanEntity>,
    @InjectRepository(OltSpeedProfileEntity)
    private readonly speedProfileRepository: Repository<OltSpeedProfileEntity>,
    @InjectRepository(OnuTypeEntity)
    private readonly onuTypeRepository: Repository<OnuTypeEntity>,
    @InjectRepository(Tr069NetworkEntity)
    private readonly tr069Repository: Repository<Tr069NetworkEntity>,
    @InjectRepository(OltEntity)
    private readonly oltRepository: Repository<OltEntity>,
    @InjectRepository(PlanEntity)
    private readonly planRepository: Repository<PlanEntity>,
    private readonly driverRegistry: OltDriverRegistry,
  ) {}

  // ══════════════════════════════════════════════════
  // 1. VLANs (RF-OLT-011)
  // ══════════════════════════════════════════════════
  async findAllVlans() {
    return this.vlanRepository.find({ order: { vlanId: 'ASC' } });
  }

  async createVlan(dto: { vlanId: number; name: string; type?: string; description?: string }) {
    const existing = await this.vlanRepository.findOneBy({ vlanId: dto.vlanId });
    if (existing) {
      throw new BadRequestException(`La VLAN ID ${dto.vlanId} ya se encuentra registrada (${existing.name}).`);
    }

    const vlan = this.vlanRepository.create({
      vlanId: dto.vlanId,
      name: dto.name,
      type: (dto.type as any) || 'INTERNET',
      description: dto.description,
    });
    return this.vlanRepository.save(vlan);
  }

  async updateVlan(id: string, dto: { name?: string; type?: string; description?: string; isActive?: boolean }) {
    const vlan = await this.vlanRepository.findOneBy({ id });
    if (!vlan) throw new NotFoundException(`VLAN no encontrada: ${id}`);

    if (dto.name !== undefined) vlan.name = dto.name;
    if (dto.type !== undefined) vlan.type = dto.type as any;
    if (dto.description !== undefined) vlan.description = dto.description;
    if (dto.isActive !== undefined) vlan.isActive = dto.isActive;

    return this.vlanRepository.save(vlan);
  }

  async deleteVlan(id: string) {
    const mappings = await this.ifaceVlanRepository.count({ where: { vlanId: id } });
    if (mappings > 0) {
      throw new BadRequestException(`No se puede eliminar la VLAN: está asignada a ${mappings} interfaces de OLT.`);
    }

    const tr069Refs = await this.tr069Repository.count({ where: { vlanId: id } });
    if (tr069Refs > 0) {
      throw new BadRequestException(`No se puede eliminar la VLAN: está vinculada a una red TR-069.`);
    }

    await this.vlanRepository.delete(id);
    return { success: true, message: 'VLAN eliminada correctamente.' };
  }

  // ══════════════════════════════════════════════════
  // 2. Mapeo VLAN ↔ Interfaz OLT (RF-OLT-012)
  // ══════════════════════════════════════════════════
  async assignVlanToInterface(
    interfaceId: string,
    vlanId: string,
    mode: 'TAG' | 'UNTAG' = 'TAG',
    applyToHardware = false,
  ) {
    const iface = await this.ifaceRepository.findOne({
      where: { id: interfaceId },
      relations: ['olt'],
    });
    if (!iface) throw new NotFoundException('Interfaz OLT no encontrada.');

    const vlan = await this.vlanRepository.findOneBy({ id: vlanId });
    if (!vlan) throw new NotFoundException('VLAN no encontrada.');

    let mapping = await this.ifaceVlanRepository.findOneBy({ interfaceId, vlanId });
    if (!mapping) {
      mapping = this.ifaceVlanRepository.create({
        interfaceId,
        vlanId,
        mode,
        applyStatus: 'PENDING',
      });
    } else {
      mapping.mode = mode;
      mapping.applyStatus = 'PENDING';
    }

    // Aplicación en vivo en la OLT mediante comando Telnet
    if (applyToHardware && iface.olt) {
      try {
        const driver = this.driverRegistry.resolve(iface.olt.vendor);
        const password = decryptCredential(iface.olt.passwordEnc);
        const result = await driver.configureVlanOnInterface(
          {
            host: iface.olt.host,
            port: iface.olt.port || 23,
            username: iface.olt.username,
            password,
          },
          {
            interfaceName: iface.name,
            vlanId: vlan.vlanId,
            mode,
          },
        );
        mapping.applyStatus = result.ok ? 'APPLIED' : 'ERROR';
      } catch {
        // Incluye UnknownOltVendorError (vendor no reconocido) y fallas de
        // comunicación real — ambas quedan como ERROR, nunca como APPLIED falso.
        mapping.applyStatus = 'ERROR';
      }
    }

    return this.ifaceVlanRepository.save(mapping);
  }

  /**
   * Habilita/deshabilita administrativamente un puerto físico completo
   * (PON o uplink) — distinto de bloquear un ONU individual. Apagar un
   * puerto PON corta a TODOS los ONUs conectados a ese puerto.
   */
  async setInterfaceAdminState(interfaceId: string, state: 'UP' | 'DOWN') {
    const iface = await this.ifaceRepository.findOne({ where: { id: interfaceId }, relations: ['olt'] });
    if (!iface) throw new NotFoundException('Interfaz OLT no encontrada.');
    if (!iface.olt) throw new BadRequestException('Esta interfaz no tiene una OLT asociada.');

    let driver;
    try {
      driver = this.driverRegistry.resolve(iface.olt.vendor);
    } catch (err) {
      if (err instanceof UnknownOltVendorError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const password = decryptCredential(iface.olt.passwordEnc);
    const result = await driver.setInterfaceAdminState(
      { host: iface.olt.host, port: iface.olt.port || 23, username: iface.olt.username, password },
      iface.name,
      state,
    );

    if (!result.ok) {
      throw new BadRequestException(`No se pudo cambiar el estado de la interfaz: ${result.error}`);
    }

    iface.adminState = state;
    return this.ifaceRepository.save(iface);
  }

  /**
   * Empuja un perfil de velocidad del catálogo (`net.olt_speed_profiles`)
   * como un objeto DBA/TCONT real en una OLT específica — acción explícita
   * (no automática al crear/editar el perfil) porque el mismo perfil del
   * catálogo puede aplicarse a OLTs de distintos fabricantes, y "crear el
   * objeto en la OLT" es por definición una operación contra un equipo
   * puntual, igual que `assignVlanToInterface`.
   *
   * Requiere `vendor_tcont_profile` ya cargado en el perfil (el nombre con
   * el que se referenciará en la OLT, ej. "FIXED5M") — sin eso no hay un
   * nombre determinístico que usar.
   */
  async syncSpeedProfileToOlt(oltId: string, speedProfileId: string) {
    const olt = await this.oltRepository.findOneBy({ id: oltId });
    if (!olt) throw new NotFoundException('OLT no encontrada.');

    const profile = await this.speedProfileRepository.findOneBy({ id: speedProfileId });
    if (!profile) throw new NotFoundException('Perfil de velocidad no encontrado.');
    if (!profile.vendorTcontProfile) {
      throw new BadRequestException(
        `El perfil "${profile.name}" no tiene un nombre de perfil TCONT configurado (vendorTcontProfile) — asígnalo antes de sincronizar.`,
      );
    }

    let driver;
    try {
      driver = this.driverRegistry.resolve(olt.vendor);
    } catch (err) {
      if (err instanceof UnknownOltVendorError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const password = decryptCredential(olt.passwordEnc);
    const result = await driver.ensureTcontProfile(
      { host: olt.host, port: olt.port || 23, username: olt.username, password },
      { name: profile.vendorTcontProfile, fixedKbps: profile.upKbps },
    );

    if (!result.ok) {
      throw new BadRequestException(`No se pudo sincronizar el perfil en la OLT: ${result.error}`);
    }

    return {
      success: true,
      message: `Perfil TCONT "${profile.vendorTcontProfile}" asegurado en la OLT "${olt.name}". Nota: esto solo cubre el ancho de banda de SUBIDA — la bajada no se gestiona por esta vía todavía.`,
    };
  }

  // ══════════════════════════════════════════════════
  // 3. Perfiles de Velocidad OLT (RF-OLT-008)
  // ══════════════════════════════════════════════════
  async findAllSpeedProfiles() {
    return this.speedProfileRepository.find({ order: { downKbps: 'ASC' } });
  }

  async findSpeedProfileById(id: string) {
    const profile = await this.speedProfileRepository.findOneBy({ id });
    if (!profile) {
      throw new NotFoundException(`Perfil de velocidad OLT con ID ${id} no encontrado.`);
    }
    return profile;
  }

  async createSpeedProfile(dto: CreateOltSpeedProfileDto) {
    const existing = await this.speedProfileRepository.findOneBy({ code: dto.code });
    if (existing) {
      throw new BadRequestException(`El código de perfil OLT "${dto.code}" ya está registrado.`);
    }

    const tcont = dto.vendorTcontProfile?.trim() || `TCONT-${Math.round(dto.downKbps / 1024)}M`;
    const traffic = dto.vendorTrafficProfile?.trim() || `TRAFFIC-${Math.round(dto.downKbps / 1024)}M`;

    const profile = this.speedProfileRepository.create({
      ...dto,
      vendorTcontProfile: tcont,
      vendorTrafficProfile: traffic,
    });
    return this.speedProfileRepository.save(profile);
  }

  async updateSpeedProfile(id: string, dto: UpdateOltSpeedProfileDto) {
    const profile = await this.findSpeedProfileById(id);

    if (dto.code && dto.code !== profile.code) {
      const existing = await this.speedProfileRepository.findOneBy({ code: dto.code });
      if (existing) {
        throw new BadRequestException(`El código de perfil OLT "${dto.code}" ya está en uso.`);
      }
      profile.code = dto.code;
    }

    if (dto.name !== undefined) profile.name = dto.name;
    if (dto.downKbps !== undefined) profile.downKbps = dto.downKbps;
    if (dto.upKbps !== undefined) profile.upKbps = dto.upKbps;
    if (dto.vendorTcontProfile !== undefined) profile.vendorTcontProfile = dto.vendorTcontProfile;
    if (dto.vendorTrafficProfile !== undefined) profile.vendorTrafficProfile = dto.vendorTrafficProfile;
    if (dto.isActive !== undefined) profile.isActive = dto.isActive;

    return this.speedProfileRepository.save(profile);
  }

  async deleteSpeedProfile(id: string) {
    const profile = await this.findSpeedProfileById(id);

    // Guardia de integridad: Verificar que ningún plan comercial tenga asignado este perfil
    const linkedPlans = await this.planRepository.count({ where: { oltSpeedProfileId: id } });
    if (linkedPlans > 0) {
      throw new BadRequestException(
        `No se puede eliminar el perfil OLT "${profile.name}": está asignado a ${linkedPlans} plan(es) comercial(es). Modifique o desvincule los planes primero.`,
      );
    }

    await this.speedProfileRepository.delete(id);
    return { success: true, message: `Perfil OLT "${profile.name}" eliminado correctamente.` };
  }

  // ══════════════════════════════════════════════════
  // 4. Tipos de ONU (RF-OLT-010)
  // ══════════════════════════════════════════════════
  /**
   * `ponType` filtra por tipo de PON (EPON/GPON), no por fabricante: en una
   * OLT EPON (ej. HiOSO) se puede conectar cualquier ONU EPON de cualquier
   * marca, no hay vendor-lock como suele asumirse en GPON — ver migración
   * 077. Sin `ponType` devuelve todo el catálogo (comportamiento previo).
   */
  async findAllOnuTypes(ponType?: string) {
    return this.onuTypeRepository.find({
      where: ponType ? { ponType } : {},
      order: { vendor: 'ASC', model: 'ASC' },
    });
  }

  async createOnuType(dto: any) {
    const onuType = this.onuTypeRepository.create(dto);
    return this.onuTypeRepository.save(onuType);
  }

  // ══════════════════════════════════════════════════
  // 5. Redes TR-069 (RF-OLT-013)
  // ══════════════════════════════════════════════════
  async findAllTr069Networks() {
    return this.tr069Repository.find({ relations: ['vlan'], order: { name: 'ASC' } });
  }

  async createTr069Network(dto: any) {
    const net = this.tr069Repository.create(dto);
    return this.tr069Repository.save(net);
  }
}
