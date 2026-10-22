import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VlanEntity } from '../entities/vlan.entity';
import { OltInterfaceEntity } from '../entities/olt-interface.entity';
import { OltInterfaceVlanEntity } from '../entities/olt-interface-vlan.entity';
import { OltSpeedProfileEntity } from '../entities/olt-speed-profile.entity';
import { OnuTypeEntity } from '../entities/onu-type.entity';
import { OnuEntity } from '../entities/onu.entity';
import { Tr069NetworkEntity } from '../entities/tr069-network.entity';
import { OltEntity } from '../entities/olt.entity';
import { OltDriverRegistry } from '../drivers/olt-driver.registry';
import { OltConnectionResolverService } from './olt-connection-resolver.service';
import { UnknownOltVendorError } from '../ports/olt-driver.port';
import { encryptCredential } from '../../network-connectivity/utils/crypto.util';

import { PlanEntity } from '../../plans/entities/plan.entity';
import { CreateOltSpeedProfileDto, UpdateOltSpeedProfileDto } from '../dto/speed-profile.dto';
import { CreateOnuTypeDto, UpdateOnuTypeDto } from '../dto/onu-type.dto';
import { CreateTr069NetworkDto } from '../dto/create-tr069-network.dto';
import { UpdateTr069NetworkDto } from '../dto/update-tr069-network.dto';

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
    @InjectRepository(OnuEntity)
    private readonly onuRepository: Repository<OnuEntity>,
    @InjectRepository(Tr069NetworkEntity)
    private readonly tr069Repository: Repository<Tr069NetworkEntity>,
    @InjectRepository(OltEntity)
    private readonly oltRepository: Repository<OltEntity>,
    @InjectRepository(PlanEntity)
    private readonly planRepository: Repository<PlanEntity>,
    private readonly driverRegistry: OltDriverRegistry,
    private readonly connectionResolver: OltConnectionResolverService,
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
    let hardwareError: string | null = null;
    if (applyToHardware && iface.olt) {
      try {
        const driver = this.driverRegistry.resolve(iface.olt.vendor);
        const connParams = await this.connectionResolver.resolve(iface.olt);
        const result = await driver.configureVlanOnInterface(connParams, {
          interfaceName: iface.name,
          vlanId: vlan.vlanId,
          mode,
        });
        if (result.ok) {
          mapping.applyStatus = 'APPLIED';
        } else {
          mapping.applyStatus = 'ERROR';
          hardwareError = result.error || 'Error aplicando VLAN en hardware OLT';
        }
      } catch (err: any) {
        mapping.applyStatus = 'ERROR';
        hardwareError = err.message || 'Error de conexión o vendor no soportado';
      }
    }

    const saved = await this.ifaceVlanRepository.save(mapping);
    if (hardwareError) {
      throw new BadRequestException(`No se pudo aplicar la VLAN en el hardware OLT: ${hardwareError}`);
    }
    return saved;
  }

  /**
   * Descubre las VLANs que REALMENTE están tageadas/untagged en una
   * interfaz física de la OLT (vía `getVlanConfigForInterface`, confirmado
   * en vivo contra OLT_Tabara_Abajo), comparadas contra lo que Sumtech ya
   * tiene registrado en `net.olt_interface_vlans`. Solo lectura -- no
   * escribe nada todavía (ver `importDiscoveredInterfaceVlan`). Mismo
   * problema de brownfield que ya se resolvió para RouterOS: un equipo en
   * producción antes de darse de alta en el ERP puede tener VLANs reales
   * que "Catálogo de VLANs"/"Permitir VLAN Trunk" nunca mostraron porque
   * solo reflejaban lo que el propio Sumtech aplicó.
   */
  async scanRealInterfaceVlans(
    interfaceId: string,
  ): Promise<Array<{ vlanId: number; mode: 'TAG' | 'UNTAG'; alreadyTracked: boolean }>> {
    const iface = await this.ifaceRepository.findOne({ where: { id: interfaceId }, relations: ['olt'] });
    if (!iface) throw new NotFoundException('Interfaz OLT no encontrada.');
    if (!iface.olt) throw new NotFoundException('La interfaz no tiene una OLT asociada.');

    const driver = this.driverRegistry.resolve(iface.olt.vendor);
    if (!driver.getVlanConfigForInterface) {
      throw new BadRequestException(
        `El fabricante "${iface.olt.vendor}" todavía no soporta descubrir VLANs reales de una interfaz.`,
      );
    }

    const connParams = await this.connectionResolver.resolve(iface.olt);
    let realVlans: import('../ports/olt-driver.port').DiscoveredInterfaceVlan[];
    let trackedRows: OltInterfaceVlanEntity[];
    try {
      [realVlans, trackedRows] = await Promise.all([
        driver.getVlanConfigForInterface(connParams, iface.name),
        this.ifaceVlanRepository.find({ where: { interfaceId }, relations: ['vlan'] }),
      ]);
    } catch (err: any) {
      // El driver ya lanza un mensaje legible cuando la OLT rechaza la
      // interfaz (ej. "gei_1/3/X" en un slot sin GEI reales) -- pero es un
      // Error plano de JS, no una excepción de Nest, así que sin este catch
      // el filtro global lo convierte en un 500 genérico sin información
      // (confirmado en producción: el error real quedaba en los logs del
      // backend pero el frontend solo veía "500 Internal Server Error").
      throw new BadRequestException(err.message || 'Error consultando VLANs reales de esta interfaz en la OLT.');
    }

    const trackedKeys = new Set(trackedRows.map((row) => `${row.vlan.vlanId}:${row.mode}`));

    return realVlans.map((v) => ({
      vlanId: v.vlanId,
      mode: v.mode,
      alreadyTracked: trackedKeys.has(`${v.vlanId}:${v.mode}`),
    }));
  }

  /**
   * Da de alta en Sumtech una VLAN descubierta por `scanRealInterfaceVlans`
   * -- no escribe nada en la OLT, ya estaba ahí de verdad. Si el número de
   * VLAN nunca existió en el catálogo `net.vlans`, se crea un catálogo
   * mínimo con nombre de placeholder (mismo criterio ya aplicado al
   * catálogo de Tipos de ONU y al de VLANs de RouterOS: mejor un
   * placeholder editable que bloquear la importación).
   */
  async importDiscoveredInterfaceVlan(
    interfaceId: string,
    discovered: { vlanId: number; mode: 'TAG' | 'UNTAG' },
  ): Promise<OltInterfaceVlanEntity> {
    const iface = await this.ifaceRepository.findOne({ where: { id: interfaceId }, relations: ['olt'] });
    if (!iface) throw new NotFoundException('Interfaz OLT no encontrada.');

    let vlan = await this.vlanRepository.findOneBy({ vlanId: discovered.vlanId });
    if (!vlan) {
      vlan = await this.vlanRepository.save(
        this.vlanRepository.create({
          vlanId: discovered.vlanId,
          name: `VLAN ${discovered.vlanId} (importada de ${iface.olt?.name || iface.name})`,
          type: 'INTERNET',
        }),
      );
    }

    const existing = await this.ifaceVlanRepository.findOneBy({ interfaceId, vlanId: vlan.id, mode: discovered.mode });
    if (existing) {
      throw new ConflictException(`La VLAN ${discovered.vlanId} (${discovered.mode}) ya está registrada para esta interfaz.`);
    }

    const mapping = this.ifaceVlanRepository.create({
      interfaceId,
      vlanId: vlan.id,
      mode: discovered.mode,
      applyStatus: 'APPLIED' as const,
    });
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

    const connParams = await this.connectionResolver.resolve(iface.olt);
    const result = await driver.setInterfaceAdminState(connParams, iface.name, state);

    if (!result.ok) {
      throw new BadRequestException(`No se pudo cambiar el estado de la interfaz: ${result.error}`);
    }

    iface.adminState = state;
    return this.ifaceRepository.save(iface);
  }

  /**
   * Empuja un perfil de velocidad del catálogo (`net.olt_speed_profiles`)
   * como objetos reales en una OLT específica — acción explícita (no
   * automática al crear/editar el perfil) porque el mismo perfil del
   * catálogo puede aplicarse a OLTs de distintos fabricantes, y "crear el
   * objeto en la OLT" es por definición una operación contra un equipo
   * puntual, igual que `assignVlanToInterface`.
   *
   * Requiere `vendor_tcont_profile` ya cargado en el perfil (el nombre con
   * el que se referenciará en la OLT, ej. "FIXED5M") — sin eso no hay un
   * nombre determinístico que usar. `vendor_traffic_profile` (bajada) es
   * opcional: si no está configurado, solo se sincroniza la subida (TCONT)
   * y el mensaje de respuesta lo deja explícito.
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

    const connParams = await this.connectionResolver.resolve(olt);
    const result = await driver.ensureTcontProfile(connParams, {
      name: profile.vendorTcontProfile,
      fixedKbps: profile.upKbps,
    });

    if (!result.ok) {
      throw new BadRequestException(`No se pudo sincronizar el perfil en la OLT: ${result.error}`);
    }

    if (!profile.vendorTrafficProfile) {
      return {
        success: true,
        message: `Perfil TCONT "${profile.vendorTcontProfile}" asegurado en la OLT "${olt.name}". Nota: no tiene un nombre de perfil de bajada (vendorTrafficProfile) configurado, así que esto solo cubre el ancho de banda de SUBIDA — asígnalo y vuelve a sincronizar para cubrir también la bajada.`,
      };
    }

    const trafficResult = await driver.ensureTrafficProfile(connParams, {
      name: profile.vendorTrafficProfile,
      downKbps: profile.downKbps,
    });

    if (!trafficResult.ok) {
      throw new BadRequestException(
        `El perfil TCONT (subida) se sincronizó, pero falló el de bajada en la OLT: ${trafficResult.error}`,
      );
    }

    return {
      success: true,
      message: `Perfiles de subida ("${profile.vendorTcontProfile}") y de bajada ("${profile.vendorTrafficProfile}") asegurados en la OLT "${olt.name}".`,
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

  /**
   * Descubre los perfiles TCONT que REALMENTE existen en una OLT (vía
   * `getTcontProfiles`, confirmado en vivo contra OLT_Tabara_Abajo),
   * comparados contra el catálogo global `net.olt_speed_profiles` por
   * `vendorTcontProfile` (el nombre real del objeto en la OLT). Solo
   * lectura -- no escribe nada todavía (ver `importDiscoveredSpeedProfile`).
   * Mismo problema de brownfield que VLANs: el catálogo de Sumtech puede
   * estar desincronizado de lo que la OLT realmente tiene configurado.
   */
  async scanRealSpeedProfiles(
    oltId: string,
  ): Promise<Array<{ name: string; type: number; fbwKbps: number; abwKbps: number; mbwKbps: number; speedKbps: number; alreadyTracked: boolean }>> {
    const olt = await this.oltRepository.findOneBy({ id: oltId });
    if (!olt) throw new NotFoundException('OLT no encontrada.');

    const driver = this.driverRegistry.resolve(olt.vendor);
    if (!driver.getTcontProfiles) {
      throw new BadRequestException(
        `El fabricante "${olt.vendor}" todavía no soporta descubrir perfiles TCONT reales.`,
      );
    }

    const connParams = await this.connectionResolver.resolve(olt);
    let realProfiles: Awaited<ReturnType<NonNullable<typeof driver.getTcontProfiles>>>;
    try {
      realProfiles = await driver.getTcontProfiles(connParams);
    } catch (err: any) {
      throw new BadRequestException(err.message || 'Error consultando perfiles TCONT reales de esta OLT.');
    }

    const trackedNames = new Set(
      (await this.speedProfileRepository.find()).map((p) => p.vendorTcontProfile).filter(Boolean),
    );

    return realProfiles.map((p) => ({ ...p, alreadyTracked: trackedNames.has(p.name) }));
  }

  /**
   * Da de alta en Sumtech un perfil TCONT descubierto por
   * `scanRealSpeedProfiles` -- no escribe nada en la OLT, ya existía. El
   * `code` se genera a partir del nombre real, evitando colisión si ya hay
   * uno igual (poco probable dado lo específico de los nombres reales, pero
   * no se asume). `downKbps`/`upKbps` se fijan igual a `speedKbps`: TCONT
   * en GPON solo gobierna la SUBIDA (ver nota en `ensureTcontProfile`), así
   * que no hay forma de inferir la bajada real desde este comando -- el
   * admin puede ajustarla después desde el formulario de edición.
   */
  async importDiscoveredSpeedProfile(
    discovered: { name: string; speedKbps: number },
  ): Promise<OltSpeedProfileEntity> {
    const existingByTcont = await this.speedProfileRepository.findOneBy({ vendorTcontProfile: discovered.name });
    if (existingByTcont) {
      throw new ConflictException(`El perfil TCONT "${discovered.name}" ya está registrado en el catálogo.`);
    }

    const baseCode = discovered.name.toUpperCase().replace(/[^A-Z0-9-]/g, '-').slice(0, 45);
    let code = baseCode;
    let suffix = 2;
    while (await this.speedProfileRepository.findOneBy({ code })) {
      code = `${baseCode}-${suffix}`.slice(0, 50);
      suffix += 1;
    }

    const profile = this.speedProfileRepository.create({
      code,
      name: `Perfil real de OLT (${discovered.name})`,
      downKbps: discovered.speedKbps,
      upKbps: discovered.speedKbps,
      vendorTcontProfile: discovered.name,
      // Mismo fallback que `createSpeedProfile()` para un perfil creado a mano
      // -- sin esto, un perfil importado por descubrimiento TCONT se queda SIN
      // traffic-profile para siempre (nadie lo escribe a mano en la práctica),
      // así que la autorización nunca manda "traffic-profile ... direction
      // egress" y el cliente queda con el download sin gestionar en la OLT
      // (bug real confirmado en producción, 2026-10-22: los ~40 perfiles
      // "SMARTOLT-*-UP" importados así nunca tuvieron traffic-profile).
      vendorTrafficProfile: `TRAFFIC-${Math.round(discovered.speedKbps / 1024)}M`,
    });
    return this.speedProfileRepository.save(profile);
  }

  // ══════════════════════════════════════════════════
  // 4. Tipos de ONU (RF-OLT-010)
  // ══════════════════════════════════════════════════
  /**
   * `ponType` filtra por tipo de PON (EPON/GPON), no por fabricante: en una
   * OLT EPON (ej. HiOSO) se puede conectar cualquier ONU EPON de cualquier
   * marca, no hay vendor-lock como suele asumirse en GPON — ver migración
   * 077. Sin `ponType` devuelve todo el catálogo (comportamiento previo).
   *
   * Por defecto solo trae modelos activos -- el selector de "Autorizar ONU"
   * no debe ofrecer modelos descontinuados. `includeInactive` es para el
   * modal de administración del catálogo, que sí necesita verlos todos para
   * poder reactivarlos.
   */
  async findAllOnuTypes(ponType?: string, includeInactive?: boolean) {
    const where: Record<string, unknown> = {};
    if (ponType) where.ponType = ponType;
    if (!includeInactive) where.isActive = true;

    return this.onuTypeRepository.find({
      where,
      order: { vendor: 'ASC', model: 'ASC' },
    });
  }

  private async assertOnuTypeNotDuplicate(vendor: string, model: string, excludeId?: string) {
    const existing = await this.onuTypeRepository.findOneBy({ vendor, model });
    if (existing && existing.id !== excludeId) {
      throw new BadRequestException(`Ya existe un tipo de ONU "${vendor} ${model}" en el catálogo.`);
    }
  }

  async createOnuType(dto: CreateOnuTypeDto) {
    await this.assertOnuTypeNotDuplicate(dto.vendor, dto.model);
    const onuType = this.onuTypeRepository.create({ ...dto });
    return this.onuTypeRepository.save(onuType);
  }

  async updateOnuType(id: string, dto: UpdateOnuTypeDto) {
    const onuType = await this.onuTypeRepository.findOneBy({ id });
    if (!onuType) {
      throw new NotFoundException(`Tipo de ONU ${id} no encontrado.`);
    }

    const nextVendor = dto.vendor ?? onuType.vendor;
    const nextModel = dto.model ?? onuType.model;
    if (dto.vendor !== undefined || dto.model !== undefined) {
      await this.assertOnuTypeNotDuplicate(nextVendor, nextModel, id);
    }

    Object.assign(onuType, dto);
    return this.onuTypeRepository.save(onuType);
  }

  async deleteOnuType(id: string) {
    const onuType = await this.onuTypeRepository.findOneBy({ id });
    if (!onuType) {
      throw new NotFoundException(`Tipo de ONU ${id} no encontrado.`);
    }

    const linkedOnus = await this.onuRepository.count({ where: { onuTypeId: id } });
    if (linkedOnus > 0) {
      throw new BadRequestException(
        `No se puede eliminar el tipo de ONU "${onuType.vendor} ${onuType.model}": ${linkedOnus} ONU(s) real(es) lo tienen asignado. Desactívelo (isActive: false) en vez de eliminarlo.`,
      );
    }

    await this.onuTypeRepository.delete(id);
    return { success: true, message: `Tipo de ONU "${onuType.vendor} ${onuType.model}" eliminado correctamente.` };
  }

  // ══════════════════════════════════════════════════
  // 5. Redes TR-069 (RF-OLT-013)
  // ══════════════════════════════════════════════════
  async findAllTr069Networks() {
    return this.tr069Repository.find({ relations: ['vlan'], order: { name: 'ASC' } });
  }

  async findTr069NetworkById(id: string): Promise<Tr069NetworkEntity> {
    const net = await this.tr069Repository.findOne({ where: { id }, relations: ['vlan'] });
    if (!net) throw new NotFoundException(`Red TR-069 no encontrada: ${id}`);
    return net;
  }

  async createTr069Network(dto: CreateTr069NetworkDto) {
    const { acsPassword, connReqPassword, ...rest } = dto;
    const net = this.tr069Repository.create({
      ...rest,
      acsPasswordEnc: acsPassword ? encryptCredential(acsPassword) : undefined,
      connReqPasswordEnc: connReqPassword ? encryptCredential(connReqPassword) : undefined,
    });
    return this.tr069Repository.save(net);
  }

  async updateTr069Network(id: string, dto: UpdateTr069NetworkDto) {
    const net = await this.findTr069NetworkById(id);
    const { acsPassword, connReqPassword, ...rest } = dto;

    Object.assign(net, rest);
    if (acsPassword) {
      net.acsPasswordEnc = encryptCredential(acsPassword);
    }
    if (connReqPassword) {
      net.connReqPasswordEnc = encryptCredential(connReqPassword);
    }

    return this.tr069Repository.save(net);
  }

  async deleteTr069Network(id: string) {
    const net = await this.findTr069NetworkById(id);
    await this.tr069Repository.delete(id);
    return { success: true, message: `Red TR-069 "${net.name}" eliminada correctamente.` };
  }
}
