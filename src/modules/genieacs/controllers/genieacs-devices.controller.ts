import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Inject,
  Optional,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { SaasFeatureGuard } from '../../../common/guards/saas-feature.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequireFeature } from '../../../common/decorators/require-feature.decorator';
import { Role } from '../../../common/enums/role.enum';
import { GENIEACS_CLIENT } from '../genieacs-client-factory';
import { GenieAcsClient } from '../genieacs-client';
import { CpeConfiguratorService } from '../services/cpe-configurator.service';
import { CpeConfigurationInput } from '../services/cpe-parameter-mapper';
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
    private readonly tenantContext: TenantContextService,
  ) {}

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
    await client.rebootDevice(id);
    return {
      success: true,
      message: 'Orden de reinicio enviada al equipo.',
      deviceId: id,
    };
  }
}
