import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  Inject,
  Optional,
  ServiceUnavailableException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { SaasFeatureGuard } from '../../../common/guards/saas-feature.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequireFeature } from '../../../common/decorators/require-feature.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { GENIEACS_CLIENT } from '../genieacs-client-factory';
import { GenieAcsClient } from '../genieacs-client';
import { CpeConfiguratorService } from '../services/cpe-configurator.service';
import { CpeConfigurationInput } from '../services/cpe-parameter-mapper';
import { GenieAcsSnapshotService } from '../services/genieacs-snapshot.service';
import { GenieAcsActivityLogService } from '../services/genieacs-activity-log.service';
import { GenieAcsSectionWriteService } from '../services/genieacs-section-write.service';
import { GenieAcsPortForwardingService } from '../services/genieacs-port-forwarding.service';
import { AddPortMappingDto } from '../dto/add-port-mapping.dto';
import { GenieAcsDiagnosticsService } from '../services/genieacs-diagnostics.service';
import { TriggerDiagnosticDto } from '../dto/trigger-diagnostic.dto';
import { DiagnosticType } from '../dto/diagnostics.dto';
import { GenieAcsVendorParameterService } from '../services/genieacs-vendor-parameter.service';
import { SetVendorToggleDto } from '../dto/vendor-parameter.dto';
import { GenieAcsFirmwareService } from '../services/genieacs-firmware.service';
import { PushFirmwareDto } from '../dto/firmware.dto';
import { UpdatePppInterfaceDto } from '../dto/update-ppp-interface.dto';
import { UpdateLanDhcpServerDto } from '../dto/update-lan-dhcp-server.dto';
import { ToggleLanPortDto } from '../dto/toggle-lan-port.dto';
import { UpdateWirelessLanDto } from '../dto/update-wireless-lan.dto';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';

@Controller('genieacs/devices')
@UseGuards(AuthGuard, RolesGuard, SaasFeatureGuard)
@RequireFeature('GENIEACS')
export class GenieAcsDevicesController {
  private readonly logger = new Logger(GenieAcsDevicesController.name);

  constructor(
    @Optional()
    @Inject(GENIEACS_CLIENT)
    private readonly client: GenieAcsClient | null,
    private readonly cpeConfigurator: CpeConfiguratorService,
    private readonly snapshotService: GenieAcsSnapshotService,
    private readonly activityLogService: GenieAcsActivityLogService,
    private readonly sectionWriteService: GenieAcsSectionWriteService,
    private readonly portForwardingService: GenieAcsPortForwardingService,
    private readonly diagnosticsService: GenieAcsDiagnosticsService,
    private readonly vendorParameterService: GenieAcsVendorParameterService,
    private readonly firmwareService: GenieAcsFirmwareService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private static readonly DIAGNOSTIC_TYPES: DiagnosticType[] = ['PING', 'TRACEROUTE', 'DOWNLOAD', 'UPLOAD', 'SITE_SURVEY'];

  private parseDiagnosticType(type: string): DiagnosticType {
    if (!GenieAcsDevicesController.DIAGNOSTIC_TYPES.includes(type as DiagnosticType)) {
      throw new BadRequestException(
        `Tipo de diagnóstico inválido "${type}" -- debe ser uno de: ${GenieAcsDevicesController.DIAGNOSTIC_TYPES.join(', ')}.`,
      );
    }
    return type as DiagnosticType;
  }

  private getClient(): GenieAcsClient {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'El servidor GenieACS no está configurado (falta GENIEACS_NBI_BASE_URL o GENIEACS_NBI_API_KEY).',
      );
    }
    return this.client;
  }

  /**
   * Listado de CPEs administrados por GenieACS para el personal de staff.
   */
  @Get()
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async getDevices(
    @Query('search') search?: string,
    @Query('limit') limit?: number,
  ) {
    const client = this.getClient();

    // GenieACS es una sola instancia compartida entre tenants (sin concepto
    // propio de tenant) — el único aislamiento real es el tag TENANT:<slug>
    // que CpeConfiguratorService.configureCpe() ya escribe al autorizar un
    // ONU (ver OnuManagementService.authorizeOnu). Sin este filtro, cualquier
    // tenant vería los CPEs de todos los demás.
    // Mismo formato/normalización que CpeConfiguratorService.configureCpe()
    // usa al escribir el tag (toLowerCase().trim()) — si no coinciden
    // exactamente, el filtro nunca encuentra nada.
    //
    // GenieACS 1.2.9 guarda los tags como un arreglo de strings en "_tags"
    // (confirmado contra la instancia real), no como un objeto de booleanos
    // "Tags.<tag>": true — ese esquema es de versiones más viejas. Con el
    // esquema viejo este filtro nunca encontraba nada, para ningún tenant.
    const tenantTag = `TENANT:${this.tenantContext.getSlug().toLowerCase().trim()}`;
    const tenantFilter = { _tags: tenantTag };

    let query: any = tenantFilter;
    if (search) {
      const q = search.trim();
      query = {
        $and: [
          tenantFilter,
          {
            $or: [
              { '_deviceId._SerialNumber': { $regex: q, $options: 'i' } },
              { '_deviceId._Manufacturer': { $regex: q, $options: 'i' } },
              { _id: { $regex: q, $options: 'i' } },
            ],
          },
        ],
      };
    }

    let rawDocs: any[] = [];
    try {
      rawDocs = await client.getDevices({ query, limit: limit ? Number(limit) : 100 });
    } catch (err: any) {
      this.logger.warn(`Error consultando dispositivos GenieACS: ${err.message}`);
      throw new ServiceUnavailableException(
        `Servidor GenieACS no disponible (${err.message}). Verifique que el servicio NBI de GenieACS esté activo.`,
      );
    }

    return rawDocs.map((doc: any) => {
      const isTR181 = doc.Device !== undefined;
      const lastInformDate = doc._lastInform ? new Date(doc._lastInform) : undefined;
      const isOnline = lastInformDate
        ? Date.now() - lastInformDate.getTime() < 300000 // 5 minutos
        : false;

      // Extraer IP de gestión o WAN
      const ip =
        doc.Device?.IP?.Interface?.['1']?.IPv4Address?.['1']?.IPAddress?._value ||
        doc.InternetGatewayDevice?.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANIPConnection?.['1']?.ExternalIPAddress?._value ||
        doc.InternetGatewayDevice?.WANDevice?.['1']?.WANConnectionDevice?.['1']?.WANPPPConnection?.['1']?.ExternalIPAddress?._value ||
        doc._ip ||
        'N/A';

      // Extraer tags activos — GenieACS 1.2.9 los guarda como arreglo en
      // "_tags" (ver nota sobre tenantFilter más arriba), no como objeto de
      // booleanos "Tags".
      const tags = Array.isArray(doc._tags) ? doc._tags : [];

      return {
        deviceId: doc._id,
        serialNumber: doc._deviceId?._SerialNumber || doc._id,
        manufacturer: doc._deviceId?._Manufacturer || 'Desconocido',
        productClass: doc._deviceId?._ProductClass || 'CPE',
        softwareVersion:
          doc.Device?.DeviceInfo?.SoftwareVersion?._value ||
          doc.InternetGatewayDevice?.DeviceInfo?.SoftwareVersion?._value ||
          'N/A',
        isTR181,
        ip,
        isOnline,
        lastInform: doc._lastInform,
        registeredAt: doc._registered,
        tags,
      };
    });
  }

  /**
   * Pestaña "TR-069 / GenieACS" de la Ficha 360 de ONU -- snapshot normalizado
   * del árbol TR-069 real del CPE (ver
   * Plan_Implementacion_Pestana_TR069_Avanzada_ONU.md). Se agregan más
   * secciones al DTO en fases posteriores; hoy solo trae "General".
   */
  @Get(':id/tr069-snapshot')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async getTr069Snapshot(@Param('id') id: string) {
    try {
      return await this.snapshotService.getFullSnapshot(id);
    } catch (err: any) {
      if (err instanceof ServiceUnavailableException) {
        throw err;
      }
      throw new ServiceUnavailableException(err.message);
    }
  }

  /**
   * "Historial de actividad TR-069" (§3.16 del plan) -- tareas+faults reales
   * de GenieACS para este CPE, no un log del equipo (TR-069 no estandariza
   * eso).
   */
  @Get(':id/activity-log')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async getActivityLog(@Param('id') id: string) {
    try {
      return await this.activityLogService.getActivityLog(id);
    } catch (err: any) {
      if (err instanceof ServiceUnavailableException) {
        throw err;
      }
      throw new ServiceUnavailableException(err.message);
    }
  }

  /**
   * Edición de la interfaz PPP (WAN PPPoE) -- §3.2 del plan. Riesgo alto: un
   * error aquí puede cortar el internet del cliente.
   */
  @Patch(':id/ppp-interface')
  @Roles(Role.ADMIN, Role.GERENTE)
  async updatePppInterface(
    @Param('id') id: string,
    @Body() dto: UpdatePppInterfaceDto,
    @CurrentUser('sub') userId: string,
  ) {
    const result = await this.sectionWriteService.updatePppInterface(id, dto, userId);
    return { success: true, ...result };
  }

  /**
   * Edición del servidor DHCP de la LAN -- §3.5 del plan. Riesgo alto: un
   * rango mal puesto desconecta todo el LAN del cliente, no solo internet.
   */
  @Patch(':id/lan-dhcp-server')
  @Roles(Role.ADMIN, Role.GERENTE)
  async updateLanDhcpServer(
    @Param('id') id: string,
    @Body() dto: UpdateLanDhcpServerDto,
    @CurrentUser('sub') userId: string,
  ) {
    const result = await this.sectionWriteService.updateLanDhcpServer(id, dto, userId);
    return { success: true, ...result };
  }

  /**
   * Habilita/deshabilita un puerto Ethernet físico -- §3.6 del plan.
   */
  @Patch(':id/lan-ports/:portIndex')
  @Roles(Role.ADMIN, Role.GERENTE)
  async toggleLanPort(
    @Param('id') id: string,
    @Param('portIndex', ParseIntPipe) portIndex: number,
    @Body() dto: ToggleLanPortDto,
    @CurrentUser('sub') userId: string,
  ) {
    await this.sectionWriteService.toggleLanPort(id, portIndex, dto.enabled, userId);
    return { success: true };
  }

  /**
   * Edición avanzada de una radio WiFi (más allá de SSID/clave) -- §3.8 del plan.
   */
  @Patch(':id/wireless-lan/:ssidIndex')
  @Roles(Role.ADMIN, Role.GERENTE)
  async updateWirelessLan(
    @Param('id') id: string,
    @Param('ssidIndex', ParseIntPipe) ssidIndex: number,
    @Body() dto: UpdateWirelessLanDto,
    @CurrentUser('sub') userId: string,
  ) {
    const result = await this.sectionWriteService.updateWirelessLan(id, ssidIndex, dto, userId);
    return { success: true, ...result };
  }

  /**
   * Agrega una regla de Port Forward -- §3.3 del plan.
   */
  @Post(':id/port-mappings')
  @Roles(Role.ADMIN, Role.GERENTE)
  async addPortMapping(@Param('id') id: string, @Body() dto: AddPortMappingDto, @CurrentUser('sub') userId: string) {
    const result = await this.portForwardingService.addPortMapping(id, dto, userId);
    return { success: true, ...result };
  }

  /**
   * Elimina una regla de Port Forward existente -- §3.3 del plan.
   */
  @Delete(':id/port-mappings/:index')
  @Roles(Role.ADMIN, Role.GERENTE)
  async deletePortMapping(
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
    @CurrentUser('sub') userId: string,
  ) {
    await this.portForwardingService.deletePortMapping(id, index, userId);
    return { success: true };
  }

  /**
   * Dispara un diagnóstico TR-143 (Ping/Traceroute/Download/Upload/Site
   * Survey) -- §3.15/§3.10 del plan. No espera el resultado; el frontend
   * hace polling contra el endpoint de abajo.
   */
  @Post(':id/diagnostics/:type/trigger')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async triggerDiagnostic(
    @Param('id') id: string,
    @Param('type') type: string,
    @Body() dto: TriggerDiagnosticDto,
    @CurrentUser('sub') userId: string,
  ) {
    await this.diagnosticsService.triggerDiagnostic(id, this.parseDiagnosticType(type), dto, userId);
    return { success: true, message: 'Diagnóstico encolado -- consulta el estado con GET .../status.' };
  }

  /**
   * Estado/resultado de un diagnóstico ya disparado -- el frontend llama
   * esto en loop (poll) hasta ver status COMPLETE/ERROR.
   */
  @Get(':id/diagnostics/:type/status')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async getDiagnosticStatus(@Param('id') id: string, @Param('type') type: string) {
    return this.diagnosticsService.getDiagnosticStatus(id, this.parseDiagnosticType(type));
  }

  /**
   * Toggles de Security (§3.12) / Miscellaneous (§3.14) -- SOLO los que
   * existen en el catálogo verificado para el vendor/modelo real de este
   * equipo (ver GenieAcsVendorParameterService). Sin filas = arreglo vacío,
   * nunca un toggle inventado.
   */
  @Get(':id/vendor-toggles')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async getVendorToggles(@Param('id') id: string, @Query('category') category: string) {
    const normalized = category === 'MISCELLANEOUS' ? 'MISCELLANEOUS' : 'SECURITY';
    return this.vendorParameterService.getTogglesForDevice(id, normalized);
  }

  @Patch(':id/vendor-toggles/:parameterKey')
  @Roles(Role.ADMIN, Role.GERENTE)
  async setVendorToggle(
    @Param('id') id: string,
    @Param('parameterKey') parameterKey: string,
    @Body() dto: SetVendorToggleDto,
    @CurrentUser('sub') userId: string,
  ) {
    await this.vendorParameterService.setToggle(id, parameterKey, dto.value, userId);
    return { success: true };
  }

  /**
   * Empuja un firmware del catálogo al equipo -- §3.17 del plan, la sección
   * de mayor riesgo de toda la pestaña. SOLO ADMIN, y exige reescribir la
   * versión destino exacta como confirmación (ver PushFirmwareDto).
   */
  @Post(':id/firmware/:firmwareId/push')
  @Roles(Role.ADMIN)
  async pushFirmware(
    @Param('id') id: string,
    @Param('firmwareId') firmwareId: string,
    @Body() dto: PushFirmwareDto,
    @CurrentUser('sub') userId: string,
  ) {
    const result = await this.firmwareService.pushFirmware(id, firmwareId, dto.confirmVersion, userId);
    return {
      success: true,
      ...result,
      message:
        'Orden de actualización de firmware enviada. No hay confirmación automática de "transferencia completa" -- revisa la Versión de Software en la sección General en unos minutos.',
    };
  }

  /**
   * Refresca los parámetros de un CPE forzando lectura del árbol vía TR-069.
   */
  @Post(':id/refresh')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async refreshDevice(@Param('id') id: string) {
    const result = await this.cpeConfigurator.refreshCpe(id);
    return {
      success: true,
      message: 'Orden de refresco de parámetros enviada con éxito al CPE.',
      deviceId: result.deviceId,
    };
  }

  /**
   * Aplica configuración técnica completa al CPE (TR-181 / TR-098).
   */
  @Post(':id/configure')
  @Roles(Role.ADMIN, Role.GERENTE)
  async configureDevice(
    @Param('id') id: string,
    @Body() body: Partial<CpeConfigurationInput>,
  ) {
    const input: CpeConfigurationInput = {
      serialNumber: body.serialNumber || id,
      vendor: body.vendor,
      model: body.model,
      tenantSlug: body.tenantSlug,
      operationMode: body.operationMode,
      ipProtocol: body.ipProtocol,
      wanMode: body.wanMode,
      serviceVlan: body.serviceVlan,
      pppoeUsername: body.pppoeUsername,
      pppoePassword: body.pppoePassword,
      wanStaticIp: body.wanStaticIp,
      wanStaticMask: body.wanStaticMask,
      wanStaticGw: body.wanStaticGw,
      managementServer: body.managementServer,
      wifi: body.wifi,
    };

    return this.cpeConfigurator.configureCpe(input);
  }

  /**
   * Ejecuta un Factory Reset TR-069 en el CPE.
   */
  @Post(':id/factory-reset')
  @Roles(Role.ADMIN, Role.GERENTE)
  async factoryResetDevice(@Param('id') id: string) {
    const result = await this.cpeConfigurator.factoryResetCpe(id);
    return {
      success: true,
      message: 'Orden de restablecimiento a valores de fábrica enviada al CPE.',
      deviceId: result.deviceId,
    };
  }

  /**
   * Reinicia el CPE remotamente.
   */
  @Post(':id/reboot')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async rebootDevice(@Param('id') id: string) {
    const client = this.getClient();
    try {
      await client.rebootDevice(id);
    } catch (err: any) {
      throw new ServiceUnavailableException(err.message);
    }
    return {
      success: true,
      message: 'Orden de reinicio enviada al equipo.',
      deviceId: id,
    };
  }
}
