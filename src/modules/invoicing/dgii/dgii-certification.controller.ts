import { Controller, Get, Post, Body, Query, Param, UseGuards, UseInterceptors, UploadedFile, BadRequestException, Inject, forwardRef, Logger, Res } from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { DgiiCertificationService, TestCaseItem } from './dgii-certification.service';
import { DgiiClientService } from './dgii-client.service';
import { DgiiTestSetImportService, DgiiTestSetAcecfRow } from './dgii-testset-import.service';
import { CompanyService } from '../../company/company.service';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';

@Controller('invoicing/dgii')
@UseGuards(AuthGuard, RolesGuard)
export class DgiiCertificationController {
  private readonly logger = new Logger(DgiiCertificationController.name);

  constructor(
    private readonly certService: DgiiCertificationService,
    private readonly dgiiClient: DgiiClientService,
    private readonly testSetImportService: DgiiTestSetImportService,
    @Inject(forwardRef(() => CompanyService))
    private readonly companyService: CompanyService,
  ) {}

  @Get('config')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getConfig() {
    const config = await this.dgiiClient.getConfig();
    let certMetadata = null;
    let hasCertObjectKey = false;
    let hasCertPassword = false;

    if (this.companyService) {
      try {
        const profile = await this.companyService.getProfile();
        hasCertObjectKey = !!profile.dgiiCertObjectKey;
        hasCertPassword = !!profile.dgiiCertPassword;
        certMetadata = profile.settings?.dgiiCertMetadata || null;
      } catch (err: any) {
        // Fallback silencioso si no hay perfil inicializado
      }
    }

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
      hasCertificate: hasCertObjectKey || config.environment === 'sandbox',
      hasCertPassword,
      certMetadata,
    };
  }

  @Post('config')
  @Roles(Role.ADMIN)
  async updateConfig(@Body() newConfig: any) {
    await this.dgiiClient.updateConfig(newConfig);
    return { message: 'Configuración fiscal DGII actualizada correctamente' };
  }

  @Post('config/certificate')
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async uploadCertificate(
    @UploadedFile() file: Express.Multer.File,
    @Body('certPassword') certPassword?: string,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('Debes adjuntar el archivo .p12 o .pfx del certificado digital.');
    }
    this.logger.log(`Procesando instalación de certificado digital: ${file.originalname} (${file.size} bytes)`);
    return this.companyService.uploadDgiiCertificate(file.buffer, file.originalname, certPassword);
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

  /**
   * Historial auditable de corridas de certificación (persistido en
   * `dgii_certification_runs`) — sobrevive a un recargo de pantalla, a
   * diferencia de los casos en memoria de arriba.
   */
  @Get('certification/history')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getCertificationHistory(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.certService.getCertificationHistory(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  /**
   * Importa el set de pruebas oficial que la DGII asigna y entrega por RNC
   * para la certificación (.xlsx descargado de su portal, hojas "ECF" y
   * "RFCE") — reemplaza los casos de demostración hardcodeados por los
   * e-NCF/tipo/monto reales que la DGII prescribió para esta ronda.
   */
  @Post('certification/import-testset')
  @Roles(Role.ADMIN, Role.GERENTE)
  @UseInterceptors(FileInterceptor('file'))
  async importTestSet(@UploadedFile() file: Express.Multer.File) {
    if (!file || !file.buffer) {
      throw new BadRequestException('Debes adjuntar el archivo .xlsx del set de pruebas de la DGII.');
    }
    const imported = await this.testSetImportService.parseWorkbook(file.buffer);
    const cases = this.certService.buildTestCasesFromImport(imported);
    return { totalEcf: imported.ecfRows.length, totalRfce: imported.rfceRows.length, cases };
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
    @Body() dto: {
      rncEmisorProveedor: string;
      eNcf: string;
      fechaEmisionEcf: string;
      montoTotalEcf: number;
      estadoAprobacion: 1 | 2;
      comentario?: string;
    },
  ) {
    return this.certService.runCommercialApproval({
      ...dto,
      fechaEmisionEcf: dto.fechaEmisionEcf,
    });
  }

  @Post('certification/import-acecf')
  @Roles(Role.ADMIN, Role.GERENTE)
  @UseInterceptors(FileInterceptor('file'))
  async importAcecfTestSet(@UploadedFile() file: Express.Multer.File) {
    if (!file || !file.buffer) {
      throw new BadRequestException('Debes adjuntar el archivo .xlsx de Aprobaciones Comerciales de la DGII.');
    }
    const cases = await this.testSetImportService.parseAcecfWorkbook(file.buffer);
    return {
      total: cases.length,
      cases,
    };
  }

  @Post('certification/generate-acecf-xmls')
  @Roles(Role.ADMIN, Role.GERENTE)
  async generateAcecfXmls(@Body() body: { cases: DgiiTestSetAcecfRow[] }) {
    if (!body?.cases || body.cases.length === 0) {
      throw new BadRequestException('No se suministraron casos de Aprobación Comercial.');
    }
    return this.certService.generateSignedAcecfList(body.cases);
  }

  @Post('certification/run-acecf-case')
  @Roles(Role.ADMIN)
  async runAcecfCase(@Body() body: DgiiTestSetAcecfRow) {
    return this.certService.runAcecfCase(body);
  }

  @Post('certification/run-all-acecf')
  @Roles(Role.ADMIN)
  async runAllAcecfCases(@Body() body: { cases: DgiiTestSetAcecfRow[] }) {
    return this.certService.runAllAcecfCases(body.cases);
  }

  @Post('certification/anecf')
  @Roles(Role.ADMIN)
  async submitSequenceVoiding(
    @Body() dto: { tipoComprobante: string; secuenciaDesde: string; secuenciaHasta: string; motivo?: string },
  ) {
    return this.certService.runSequenceVoiding(dto);
  }

  /**
   * Descarga/obtiene el XML firmado de un e-CF individual por su e-NCF.
   */
  @Get('certification/xml/:eNcf')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getSignedXml(@Param('eNcf') eNcf: string) {
    const result = await this.certService.getSignedXmlByEncf(eNcf);
    if (!result) {
      throw new BadRequestException(`No se encontró un XML firmado registrado para el comprobante ${eNcf}`);
    }
    return result;
  }

  /**
   * Obtiene la lista de los 4 XMLs firmados de las Facturas de Consumo < 250k
   * para su carga en el portal DGII (Paso 2 "Elegir archivo" tras aceptación de RFCE).
   */
  @Get('certification/rfce-base-xmls')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getRfceBaseSignedXmls() {
    return this.certService.getRfceBaseSignedXmls();
  }

  /**
   * Genera y descarga/previsualiza la Representación Impresa (PDF A4 o Ticket 80mm)
   * de cualquier comprobante de simulación o del historial de certificación DGII.
   */
  @Get('certification/pdf/:eNcf')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getSimulationPdf(
    @Param('eNcf') eNcf: string,
    @Query('format') format: 'a4' | '80mm' = 'a4',
    @Query('offset') offset?: string,
    @Res() res?: Response,
  ) {
    const seqOffset = offset ? parseInt(offset, 10) : 0;
    const buffer = await this.certService.generateSimulationPdf(eNcf, format, seqOffset);
    if (res) {
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="RI-${eNcf}-${format}.pdf"`,
        'Content-Length': buffer.length,
      });
      res.end(buffer);
      return;
    }
    return buffer;
  }

  /**
   * Obtiene la lista completa de todos los XMLs firmados de la batería de simulación (Paso 4)
   * para su descarga masiva o inspección de timbrados.
   */
  @Get('certification/simulation-signed-xmls')
  @Roles(Role.ADMIN, Role.GERENTE)
  async getSimulationSignedXmls(@Query('offset') offset?: string) {
    const seqOffset = offset ? parseInt(offset, 10) : 0;
    return this.certService.getSimulationSignedXmls(seqOffset);
  }
}
