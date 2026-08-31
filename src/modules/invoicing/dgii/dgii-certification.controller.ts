import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { DgiiCertificationService, TestCaseItem } from './dgii-certification.service';
import { DgiiClientService } from './dgii-client.service';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';

@Controller('invoicing/dgii')
@UseGuards(AuthGuard, RolesGuard)
export class DgiiCertificationController {
  constructor(
    private readonly certService: DgiiCertificationService,
    private readonly dgiiClient: DgiiClientService,
  ) {}

  @Get('config')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getConfig() {
    const config = this.dgiiClient.getConfig();
    return {
      environment: config.environment,
      baseUrl: config.baseUrl,
      baseUrlRfce: config.baseUrlRfce,
      rncEmisor: config.rncEmisor,
      razonSocialEmisor: config.razonSocialEmisor,
      nombreComercial: config.nombreComercial,
      direccionEmisor: config.direccionEmisor,
      municipioEmisor: config.municipioEmisor,
      provinciaEmisor: config.provinciaEmisor,
      correoEmisor: config.correoEmisor,
      telefonoEmisor: config.telefonoEmisor,
      webSite: config.webSite,
      certPath: config.certPath,
    };
  }

  @Post('config')
  @Roles(Role.ADMIN)
  async updateConfig(@Body() newConfig: any) {
    this.dgiiClient.updateConfig(newConfig);
    return { message: 'Configuración fiscal DGII actualizada correctamente' };
  }

  @Get('test-connection')
  @Roles(Role.ADMIN, Role.GERENTE)
  async testConnection() {
    return this.dgiiClient.testConnectionDiagnostic();
  }

  @Get('certification/cases')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getTestSetCases() {
    return this.certService.getDefaultTestSetCases();
  }

  @Post('certification/run-case')
  @Roles(Role.ADMIN)
  async runTestCase(@Body() caseItem: TestCaseItem) {
    return this.certService.runTestCase(caseItem);
  }

  @Post('certification/run-all')
  @Roles(Role.ADMIN)
  async runAllTestCases(@Body() body: { cases?: TestCaseItem[] }) {
    return this.certService.runAllTestCases(body.cases);
  }

  @Get('certification/simulation-dataset')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getSimulationDataset(@Query('offset') offset?: string) {
    const seqOffset = offset ? parseInt(offset, 10) : 0;
    return this.certService.get25SimulationDataset(seqOffset);
  }

  @Post('certification/run-simulation')
  @Roles(Role.ADMIN)
  async runSimulationStep4(@Body() body: { offset?: number }) {
    const seqOffset = body?.offset || 0;
    return this.certService.runSimulationStep4(seqOffset);
  }

  @Post('certification/acecf')
  @Roles(Role.ADMIN, Role.GERENTE)
  async submitCommercialApproval(
    @Body() dto: { rncEmisorProveedor: string; eNcf: string; estadoAprobacion: 1 | 2; comentario?: string },
  ) {
    return this.certService.runCommercialApproval(dto);
  }

  @Post('certification/anecf')
  @Roles(Role.ADMIN)
  async submitSequenceVoiding(
    @Body() dto: { tipoComprobante: string; secuenciaDesde: string; secuenciaHasta: string; motivo?: string },
  ) {
    return this.certService.runSequenceVoiding(dto);
  }
}
