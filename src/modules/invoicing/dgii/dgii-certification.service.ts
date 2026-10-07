import { Injectable, Logger, BadRequestException, Optional, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DgiiXmlGeneratorService, EcfGenerationInput, EcfItemInput, AcecfGenerationInput, AnecfGenerationInput, usesNcfExpiryDate } from './dgii-xml-generator.service';
import { DgiiClientService, DgiiSendResult } from './dgii-client.service';
import { DgiiSignerService } from './dgii-signer.service';
import { DgiiTestSetImportResult, DgiiTestSetEcfRow, DgiiTestSetAcecfRow } from './dgii-testset-import.service';
import { DgiiCertificationRun } from './entities/dgii-certification-run.entity';
import { PdfGeneratorService } from '../../printing/pdf-generator.service';
import { CompanyPdfInfo, InvoiceReceiptMetadata } from '../../printing/pdf-generator.types';
import { CompanyService } from '../../company/company.service';

export interface TestCaseItem {
  id: string;
  casoNumero: number;
  nombreCaso: string;
  tipoeCF: 'E31' | 'E32' | 'E33' | 'E34' | 'E41' | 'E43' | 'E44' | 'E45' | 'E46' | 'E47';
  eNCF: string;
  rncComprador?: string;
  razonSocialComprador: string;
  montoTotal: number;
  itemsCount: number;
  descripcion: string;
  // CONTINGENCY: la DGII no fue alcanzable y el comprobante quedó registrado en
  // modo contingencia (contemplado por la norma fiscal dominicana) — no es lo
  // mismo que ACCEPTED (aceptación real y confirmada por la DGII), así que se
  // reporta como su propio estado en vez de pintarse en verde como si fuera igual.
  status: 'PENDING' | 'ACCEPTED' | 'CONTINGENCY' | 'REJECTED' | 'ERROR';
  trackId?: string;
  securityCode?: string;
  executedAt?: Date;
  logs: string[];
  // Presente solo en casos construidos desde el set de pruebas oficial de la
  // DGII (ver DgiiTestSetImportService) — el e-NCF que esta nota modifica.
  eNCFModificado?: string;
  // Fecha de vencimiento de la secuencia del comprobante (Norma 06-2018 / XSD oficial)
  fechaVencimientoSecuencia?: string;
  // true = este caso es un Resumen de Factura de Consumo (RFCE) — se envía
  // por un canal/host distinto al del resto de los e-CF (ver runRfceCase).
  esRfce?: boolean;
  extraRfceData?: Record<string, any>;
  extraEcfData?: DgiiTestSetEcfRow;
}

export interface SimulationDataset {
  ecfGenerales: TestCaseItem[]; // 18 comprobantes base
  ecfNotas: TestCaseItem[];     // 3 notas de débito y crédito
  ecfConsumoMenor: TestCaseItem[]; // 4 facturas de consumo menor < 250k
  todosLosCasos: TestCaseItem[]; // 25 comprobantes
}

@Injectable()
export class DgiiCertificationService {
  private readonly logger = new Logger(DgiiCertificationService.name);
  private readonly consumerMinorCache = new Map<string, { securityCode: string; signedXml: string; signedAt: Date }>();
  private readonly importedEcfMap = new Map<string, DgiiTestSetEcfRow>();

  constructor(
    private readonly xmlGenerator: DgiiXmlGeneratorService,
    private readonly dgiiClient: DgiiClientService,
    private readonly signerService: DgiiSignerService,
    @InjectRepository(DgiiCertificationRun)
    private readonly runRepository: Repository<DgiiCertificationRun>,
    @Optional() private readonly pdfGenerator?: PdfGeneratorService,
    @Optional() @Inject(forwardRef(() => CompanyService))
    private readonly companyService?: CompanyService,
  ) { }

  /**
   * Guarda un rastro auditable de la ejecución en `dgii_certification_runs`.
   * Nunca lanza: un fallo al persistir no debe hacer que el caso completo se
   * reporte como error si la DGII sí respondió.
   */
  private async persistRun(
    source: 'TEST_CASE' | 'RUN_ALL' | 'SIMULATION',
    item: TestCaseItem,
    result: {
      status: TestCaseItem['status'];
      trackId?: string;
      securityCode?: string;
      responseMessage?: string;
      signedXml?: string;
      validationErrors?: string[];
      rawResponse?: any;
      signedAt?: Date;
    },
  ): Promise<void> {
    try {
      const config = await this.dgiiClient.getConfig();
      const run = this.runRepository.create({
        runSource: source,
        casoNumero: item.casoNumero,
        nombreCaso: item.nombreCaso,
        tipoEcf: item.tipoeCF.replace(/^E/i, ''),
        esRfce: !!item.esRfce,
        eNcf: item.eNCF,
        eNcfModificado: item.eNCFModificado,
        rncComprador: item.rncComprador,
        razonSocialComprador: item.razonSocialComprador,
        montoTotal: item.montoTotal,
        status: result.status,
        trackId: result.trackId,
        securityCode: result.securityCode,
        responseMessage: result.responseMessage,
        validationErrors: result.validationErrors,
        signedXml: result.signedXml,
        rawResponse: result.rawResponse,
        environment: config.environment,
        // Instante de la firma, no el del INSERT: es el `fechafirma` que exige
        // el QR de la DGII. `executed_at` lo pone TypeORM/Postgres después del
        // round-trip y por eso no sirve para ese propósito.
        signedAt: result.signedAt,
      });
      await this.runRepository.save(run);
    } catch (err: any) {
      this.logger.error(`No se pudo persistir el historial de certificación para ${item.eNCF}: ${err.message}`);
    }
  }

  /**
   * Último estado real conocido de un e-NCF, según el historial persistido.
   * Usado para no enviar una nota de crédito/débito cuyo e-CF base nunca fue
   * aceptado por la DGII (evita el error 615 de la DGII: referencia a un
   * comprobante que no existe/no fue aceptado).
   */
  private async getLastStatus(eNcf: string): Promise<DgiiCertificationRun | null> {
    return this.runRepository.findOne({ where: { eNcf }, order: { executedAt: 'DESC' } });
  }

  /**
   * Historial paginado de corridas de certificación, más reciente primero —
   * consultable desde /dashboard/dgii/certificacion en vez de perderse al
   * recargar la pantalla.
   */
  async getCertificationHistory(page = 1, limit = 20): Promise<{ total: number; page: number; limit: number; runs: DgiiCertificationRun[] }> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const [runs, total] = await this.runRepository.findAndCount({
      order: { executedAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });
    return { total, page: safePage, limit: safeLimit, runs };
  }

  /**
   * Retorna la batería de casos de prueba oficiales del Set de Pruebas DGII para telecomunicaciones
   */
  getDefaultTestSetCases(): TestCaseItem[] {
    return [
      {
        id: 'dgii-tc-01',
        casoNumero: 1,
        nombreCaso: 'Factura de Crédito Fiscal (B2B con ITBIS 18%)',
        tipoeCF: 'E31',
        eNCF: 'E310000000001',
        rncComprador: '130000001',
        razonSocialComprador: 'TELECOMUNICACIONES DOMINICANAS CORPORATIVAS SRL',
        montoTotal: 5074.0,
        itemsCount: 2,
        descripcion: 'Plan Fibra Óptica 300 Mbps Dedicado + Router Gigabit ONT Wi-Fi 6',
        status: 'PENDING',
        logs: [],
      },
      {
        id: 'dgii-tc-02',
        casoNumero: 2,
        nombreCaso: 'Factura de Consumo Final (< RD$ 250,000)',
        tipoeCF: 'E32',
        eNCF: 'E320000000001',
        razonSocialComprador: 'Juan Antonio Pérez Rosario',
        montoTotal: 1711.0,
        itemsCount: 1,
        descripcion: 'Plan Residencial Dúo 100 Mbps Internet + Televisión Digital HD',
        status: 'PENDING',
        logs: [],
      },
      {
        id: 'dgii-tc-03',
        casoNumero: 3,
        nombreCaso: 'Factura de Consumo Final Mayor (> RD$ 250,000 con Cédula)',
        tipoeCF: 'E32',
        eNCF: 'E320000000002',
        rncComprador: '40212345678',
        razonSocialComprador: 'Carlos Manuel Gómez Peña',
        montoTotal: 295000.0,
        itemsCount: 3,
        descripcion: 'Venta Mayorista de OLT Huawei GPON y 50 Decodificadores STB 4K',
        status: 'PENDING',
        logs: [],
      },
      {
        id: 'dgii-tc-04',
        casoNumero: 4,
        nombreCaso: 'Nota de Débito Electrónica (Recargo / Ajuste)',
        tipoeCF: 'E33',
        eNCF: 'E330000000001',
        rncComprador: '130000001',
        razonSocialComprador: 'EMPRESA CLIENTE S.A.',
        montoTotal: 590.0,
        itemsCount: 1,
        descripcion: 'Recargo por reconexión e instalación extraordinaria de fibra',
        status: 'PENDING',
        logs: [],
      },
      {
        id: 'dgii-tc-05',
        casoNumero: 5,
        nombreCaso: 'Nota de Crédito Electrónica (Descuento Comercial E34)',
        tipoeCF: 'E34',
        eNCF: 'E340000000001',
        rncComprador: '130000001',
        razonSocialComprador: 'EMPRESA CLIENTE S.A.',
        montoTotal: 1180.0,
        itemsCount: 1,
        descripcion: 'Crédito por interrupción de servicio programada según SLA',
        status: 'PENDING',
        logs: [],
      },
      {
        id: 'dgii-tc-06',
        casoNumero: 6,
        nombreCaso: 'Registro de Proveedores Informales Electrónico',
        tipoeCF: 'E41',
        eNCF: 'E410000000001',
        rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 02',
        montoTotal: 4500.0,
        itemsCount: 1,
        descripcion: 'Trabajo de herrería y soporte en torre de telecomunicaciones',
        status: 'PENDING',
        logs: [],
      },
      {
        id: 'dgii-tc-07',
        casoNumero: 7,
        nombreCaso: 'Gastos Menores Electrónico',
        tipoeCF: 'E43',
        eNCF: 'E430000000001',
        razonSocialComprador: 'Consumidor Final Gastos Menores',
        montoTotal: 650.0,
        itemsCount: 1,
        descripcion: 'Adquisición de combustible y viáticos para cuadrilla técnica',
        status: 'PENDING',
        logs: [],
      },
      {
        id: 'dgii-tc-08',
        casoNumero: 8,
        nombreCaso: 'Regímenes Especiales de Tributación (Zona Franca / Exento ITBIS)',
        tipoeCF: 'E44',
        eNCF: 'E440000000001',
        rncComprador: '130999999',
        razonSocialComprador: 'PARQUE INDUSTRIAL ZONA FRANCA LAS AMERICAS S.A.',
        montoTotal: 12500.0,
        itemsCount: 1,
        descripcion: 'Troncal SIP y Enlace Punto a Punto 1 Gbps Dedicado Exento ITBIS',
        status: 'PENDING',
        logs: [],
      },
      {
        id: 'dgii-tc-09',
        casoNumero: 9,
        nombreCaso: 'Comprobante Gubernamental Electrónico',
        tipoeCF: 'E45',
        eNCF: 'E450000000001',
        rncComprador: '401000001',
        razonSocialComprador: 'MINISTERIO DE EDUCACION SUPERIOR CIENCIA Y TECNOLOGIA',
        montoTotal: 23600.0,
        itemsCount: 1,
        descripcion: 'Conectividad a Internet Simétrico y Telefonía IP para Centros Educativos',
        status: 'PENDING',
        logs: [],
      },
      {
        id: 'dgii-tc-10',
        casoNumero: 10,
        nombreCaso: 'Comprobante para Pagos al Exterior',
        tipoeCF: 'E46',
        eNCF: 'E460000000001',
        razonSocialComprador: 'TRANSIT PROVIDER GLOBAL CARRIER LLC',
        montoTotal: 58000.0,
        itemsCount: 1,
        descripcion: 'Capacidad Internacional de Tránsito IP y Tráfico Submarino',
        status: 'PENDING',
        logs: [],
      },
      {
        id: 'dgii-tc-11',
        casoNumero: 11,
        nombreCaso: 'Comprobante para Exportaciones',
        tipoeCF: 'E47',
        eNCF: 'E470000000001',
        razonSocialComprador: 'CARIBBEAN REGIONAL NETWORK INC.',
        montoTotal: 42000.0,
        itemsCount: 1,
        descripcion: 'Exportación de Servicios Cloud Hosting y Peering de Red',
        status: 'PENDING',
        logs: [],
      },
    ];
  }

  /**
   * Genera el conjunto estricto y oficial de los 25 comprobantes de Simulación (Paso 4 DGII)
   * 4x E31, 2x E32 (>=250k), 1x E33, 2x E34, 2x E41, 2x E43, 2x E44, 2x E45, 2x E46, 2x E47, 4x E32 (<250k)
   */
  get25SimulationDataset(sequenceOffset: number = 0): SimulationDataset {
    const pad = (num: number) => String(num + sequenceOffset).padStart(10, '0');

    // 1. 18 Comprobantes Base
    const ecfGenerales: TestCaseItem[] = [
      // 4x E31 (Crédito Fiscal)
      {
        id: 'sim-01', casoNumero: 1, nombreCaso: 'Simulación 1 - Tipo 31 (Fibra Dedicada 500 Mbps)',
        tipoeCF: 'E31', eNCF: `E31${pad(1)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 59000.0, itemsCount: 1,
        descripcion: 'Enlace Dedicado de Fibra Óptica 500 Mbps Simétrico B2B', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-02', casoNumero: 2, nombreCaso: 'Simulación 2 - Tipo 31 (Troncal SIP Corporativa)',
        tipoeCF: 'E31', eNCF: `E31${pad(2)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 41300.0, itemsCount: 1,
        descripcion: 'Troncal SIP Telefónica Corporativa 60 Canales Concurrentes', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-03', casoNumero: 3, nombreCaso: 'Simulación 3 - Tipo 31 (Servicio de Data Center)',
        tipoeCF: 'E31', eNCF: `E31${pad(3)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 53100.0, itemsCount: 1,
        descripcion: 'Servicio de Coubicación y Rack de Servidores en Data Center', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-04', casoNumero: 4, nombreCaso: 'Simulación 4 - Tipo 31 (Consultoría en Redes GPON)',
        tipoeCF: 'E31', eNCF: `E31${pad(4)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 70800.0, itemsCount: 1,
        descripcion: 'Ingeniería, Diseño y Certificación de Red de Fibra GPON', status: 'PENDING', logs: [],
      },
      // 2x E32 >= 250k (Consumo Mayor)
      {
        id: 'sim-05', casoNumero: 5, nombreCaso: 'Simulación 5 - Tipo 32 >= 250k (Venta Mayorista OLTs)',
        tipoeCF: 'E32', eNCF: `E32${pad(1)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 306800.0, itemsCount: 2,
        descripcion: 'Suministro de Chasis OLT Huawei GPON 16 Puertos + Módulos C++', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-06', casoNumero: 6, nombreCaso: 'Simulación 6 - Tipo 32 >= 250k (Lote de ONTs Wi-Fi 6)',
        tipoeCF: 'E32', eNCF: `E32${pad(2)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 365800.0, itemsCount: 1,
        descripcion: 'Lote de 100 Equipos Terminales Ópticos ONT Gigabit Wi-Fi 6', status: 'PENDING', logs: [],
      },
      // 2x E41 (Proveedores Informales con Retención)
      {
        id: 'sim-07', casoNumero: 7, nombreCaso: 'Simulación 7 - Tipo 41 (Mantenimiento de Torres)',
        tipoeCF: 'E41', eNCF: `E41${pad(1)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 02', montoTotal: 29500.0, itemsCount: 1,
        descripcion: 'Mantenimiento preventivo, pintura y sujeción de retenidas en torre', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-08', casoNumero: 8, nombreCaso: 'Simulación 8 - Tipo 41 (Tendido Aéreo Contratista)',
        tipoeCF: 'E41', eNCF: `E41${pad(2)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 11', montoTotal: 21240.0, itemsCount: 1,
        descripcion: 'Tendido aéreo de cable troncal de fibra óptica 48 hilos', status: 'PENDING', logs: [],
      },
      // 2x E43 (Gastos Menores)
      {
        id: 'sim-09', casoNumero: 9, nombreCaso: 'Simulación 9 - Tipo 43 (Materiales de Ferretería)',
        tipoeCF: 'E43', eNCF: `E43${pad(1)}`,
        razonSocialComprador: 'Consumidor Final Gastos Menores', montoTotal: 4500.0, itemsCount: 1,
        descripcion: 'Materiales menores de anclaje, tornillos y precintos de seguridad', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-10', casoNumero: 10, nombreCaso: 'Simulación 10 - Tipo 43 (Combustible de Planta)',
        tipoeCF: 'E43', eNCF: `E43${pad(2)}`,
        razonSocialComprador: 'Consumidor Final Gastos Menores', montoTotal: 3200.0, itemsCount: 1,
        descripcion: 'Combustible diesel para generador de emergencia de cabecera', status: 'PENDING', logs: [],
      },
      // 2x E44 (Regímenes Especiales - Zona Franca ITBIS 0%)
      {
        id: 'sim-11', casoNumero: 11, nombreCaso: 'Simulación 11 - Tipo 44 (Zona Franca - Enlace 1 Gbps)',
        tipoeCF: 'E44', eNCF: `E44${pad(1)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 85000.0, itemsCount: 1,
        descripcion: 'Enlace Punto a Punto 1 Gbps Exonerado de ITBIS Ley 8-90', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-12', casoNumero: 12, nombreCaso: 'Simulación 12 - Tipo 44 (Zona Franca - Nube Privada)',
        tipoeCF: 'E44', eNCF: `E44${pad(2)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 75000.0, itemsCount: 1,
        descripcion: 'Servicio de Interconexión en Nube Privada Exonerado de ITBIS', status: 'PENDING', logs: [],
      },
      // 2x E45 (Gubernamental)
      {
        id: 'sim-13', casoNumero: 13, nombreCaso: 'Simulación 13 - Tipo 45 (Gubernamental - Ministerio)',
        tipoeCF: 'E45', eNCF: `E45${pad(1)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 141600.0, itemsCount: 1,
        descripcion: 'Servicio de Internet Simétrico y Telefonía IP para Ministerio', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-14', casoNumero: 14, nombreCaso: 'Simulación 14 - Tipo 45 (Gubernamental - Dirección)',
        tipoeCF: 'E45', eNCF: `E45${pad(2)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 112100.0, itemsCount: 1,
        descripcion: 'Conectividad Segura VPN MPLS para Oficinas Gubernamentales', status: 'PENDING', logs: [],
      },
      // 2x E46 (Exportación Tasa 0%)
      {
        id: 'sim-15', casoNumero: 15, nombreCaso: 'Simulación 15 - Tipo 46 (Exportación Tránsito IP)',
        tipoeCF: 'E46', eNCF: `E46${pad(1)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 150000.0, itemsCount: 1,
        descripcion: 'Exportación de Capacidad Internacional de Tránsito IP (Tasa 0%)', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-16', casoNumero: 16, nombreCaso: 'Simulación 16 - Tipo 46 (Exportación Peering)',
        tipoeCF: 'E46', eNCF: `E46${pad(2)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 135000.0, itemsCount: 1,
        descripcion: 'Servicio de Interconexión Internacional de Peering y DNS Anycast', status: 'PENDING', logs: [],
      },
      // 2x E47 (Pagos al Exterior - Extranjero)
      {
        id: 'sim-17', casoNumero: 17, nombreCaso: 'Simulación 17 - Tipo 47 (Pagos al Exterior - Cable Submarino)',
        tipoeCF: 'E47', eNCF: `E47${pad(1)}`,
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 80000.0, itemsCount: 1,
        descripcion: 'Pago por Capacidad de Cable Submarino Internacional Carrier Tier-1', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-18', casoNumero: 18, nombreCaso: 'Simulación 18 - Tipo 47 (Pagos al Exterior - Servidores Cloud)',
        tipoeCF: 'E47', eNCF: `E47${pad(2)}`,
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 65000.0, itemsCount: 1,
        descripcion: 'Servicios de Almacenamiento en Nube Global e Infraestructura Cloud', status: 'PENDING', logs: [],
      },
    ];

    // 2. 3 Notas de Débito y Crédito (Etapa 2)
    const ecfNotas: TestCaseItem[] = [
      {
        id: 'sim-19', casoNumero: 19, nombreCaso: 'Simulación 19 - Tipo 33 (Nota Débito por Ajuste)',
        tipoeCF: 'E33', eNCF: `E33${pad(1)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 5900.0, itemsCount: 1,
        descripcion: 'Ajuste de cargo por instalación técnica extraordinaria', status: 'PENDING', logs: [],
        eNCFModificado: `E31${pad(1)}`,
      },
      {
        id: 'sim-20', casoNumero: 20, nombreCaso: 'Simulación 20 - Tipo 34 (Nota Crédito Anulación Total E44)',
        tipoeCF: 'E34', eNCF: `E34${pad(1)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 85000.0, itemsCount: 1,
        descripcion: 'Anulación total de factura por cancelación de orden comercial', status: 'PENDING', logs: [],
        eNCFModificado: `E44${pad(1)}`,
      },
      {
        id: 'sim-21', casoNumero: 21, nombreCaso: 'Simulación 21 - Tipo 34 (Nota Crédito Corrección Texto)',
        tipoeCF: 'E34', eNCF: `E34${pad(2)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 0.0, itemsCount: 1,
        descripcion: 'Corrección de descripción de servicio en factura previa', status: 'PENDING', logs: [],
        eNCFModificado: `E31${pad(2)}`,
      },
    ];

    // 3. 4 Facturas de Consumo Menor < 250k (Etapa 3 para RFCE)
    const ecfConsumoMenor: TestCaseItem[] = [
      {
        id: 'sim-22', casoNumero: 22, nombreCaso: 'Simulación 22 - Tipo 32 < 250k (Plan Residencial 50M)',
        tipoeCF: 'E32', eNCF: `E32${pad(3)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 4130.0, itemsCount: 1,
        descripcion: 'Plan Fibra Residencial 50 Mbps + Router Wi-Fi', status: 'PENDING', logs: [], esRfce: true,
      },
      {
        id: 'sim-23', casoNumero: 23, nombreCaso: 'Simulación 23 - Tipo 32 < 250k (Plan Dúo 100M)',
        tipoeCF: 'E32', eNCF: `E32${pad(4)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 4956.0, itemsCount: 1,
        descripcion: 'Plan Dúo 100 Mbps Internet + Televisión HD', status: 'PENDING', logs: [], esRfce: true,
      },
      {
        id: 'sim-24', casoNumero: 24, nombreCaso: 'Simulación 24 - Tipo 32 < 250k (Control Remoto & Deco)',
        tipoeCF: 'E32', eNCF: `E32${pad(5)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 3304.0, itemsCount: 1,
        descripcion: 'Venta de Control Remoto Universal y Decodificador Adicional', status: 'PENDING', logs: [], esRfce: true,
      },
      {
        id: 'sim-25', casoNumero: 25, nombreCaso: 'Simulación 25 - Tipo 32 < 250k (Cargo Reubicación)',
        tipoeCF: 'E32', eNCF: `E32${pad(6)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 1770.0, itemsCount: 1,
        descripcion: 'Cargo por Reubicación de Acometida de Fibra Óptica', status: 'PENDING', logs: [], esRfce: true,
      },
    ];

    const defaultVencimiento = '31-12-2028';
    const applyVencimiento = (items: TestCaseItem[]) =>
      items.map((it) => ({
        ...it,
        fechaVencimientoSecuencia: usesNcfExpiryDate(it.tipoeCF) ? defaultVencimiento : undefined,
      }));

    const finalGenerales = applyVencimiento(ecfGenerales);
    const finalNotas = applyVencimiento(ecfNotas);
    const finalConsumo = applyVencimiento(ecfConsumoMenor);

    return {
      ecfGenerales: finalGenerales,
      ecfNotas: finalNotas,
      ecfConsumoMenor: finalConsumo,
      todosLosCasos: [...finalGenerales, ...finalNotas, ...finalConsumo],
    };
  }

  /**
   * Descripción y datos de comprador de respaldo por tipo de e-CF — el propio
   * archivo de la DGII deja estos campos en blanco ("#e") a propósito porque
   * es el emisor quien debe redactar el contenido de cada caso; la DGII solo
   * prescribe qué e-NCF, tipo y monto usar en cada uno.
   */
  private static readonly DESCRIPCION_POR_TIPO: Record<string, { nombreCaso: string; descripcion: string; razonSocialComprador: string; rncComprador?: string }> = {
    '31': { nombreCaso: 'Factura de Crédito Fiscal', descripcion: 'Servicio de telecomunicaciones facturado a persona jurídica', razonSocialComprador: 'EMPRESA CLIENTE S.A.', rncComprador: '130000001' },
    '32': { nombreCaso: 'Factura de Consumo', descripcion: 'Servicio de telecomunicaciones facturado a consumidor final', razonSocialComprador: 'Consumidor Final' },
    '33': { nombreCaso: 'Nota de Débito Electrónica', descripcion: 'Recargo o ajuste sobre comprobante previo', razonSocialComprador: 'EMPRESA CLIENTE S.A.', rncComprador: '130000001' },
    '34': { nombreCaso: 'Nota de Crédito Electrónica', descripcion: 'Descuento o anulación sobre comprobante previo', razonSocialComprador: 'EMPRESA CLIENTE S.A.', rncComprador: '130000001' },
    '41': { nombreCaso: 'Registro de Proveedores Informales', descripcion: 'Servicio recibido de proveedor informal', razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 02', rncComprador: '131880681' },
    '43': { nombreCaso: 'Gastos Menores Electrónico', descripcion: 'Gasto menor operativo', razonSocialComprador: 'Consumidor Final Gastos Menores' },
    '44': { nombreCaso: 'Régimen Especial de Tributación', descripcion: 'Servicio exento de ITBIS bajo régimen especial', razonSocialComprador: 'ZONA FRANCA S.A.', rncComprador: '130999999' },
    '45': { nombreCaso: 'Comprobante Gubernamental', descripcion: 'Servicio prestado a entidad gubernamental', razonSocialComprador: 'ENTIDAD GUBERNAMENTAL', rncComprador: '401000001' },
    '46': { nombreCaso: 'Comprobante para Pagos al Exterior', descripcion: 'Servicio pagado a proveedor en el exterior', razonSocialComprador: 'FOREIGN PROVIDER LLC' },
    '47': { nombreCaso: 'Comprobante para Exportaciones', descripcion: 'Servicio exportado a cliente en el exterior', razonSocialComprador: 'FOREIGN CLIENT INC.' },
  };

  /**
   * Normaliza un e-NCF para garantizar exactamente 13 caracteres conforme a Ley 32-23:
   * 'E' + 2 dígitos de tipo + 10 dígitos de secuencia (ej. 'E3100000001' -> 'E310000000001').
   */
  normalizeENcf(raw?: string): string {
    if (!raw) return '';
    const clean = raw.trim().toUpperCase();
    const match = clean.match(/^(E\d{2})(\d+)$/);
    if (match) {
      const prefix = match[1];
      const seq = match[2].padStart(10, '0');
      return `${prefix}${seq}`;
    }
    return clean;
  }

  /**
   * Convierte el set de pruebas importado desde el .xlsx oficial de la DGII
   * en el modelo `TestCaseItem` que ya consumen la UI y `runTestCase`/
   * `runAllTestCases`. Normaliza los e-NCFs a 13 caracteres conforme a Ley 32-23.
   */
  /**
   * Determina el ranking estricto de orden de emisión según la directriz oficial de la DGII:
   * Primero:
   *   31 - Factura de Crédito Fiscal
   *   32 - Factura de Consumo >= 250,000.00
   *   41 - Compras
   *   43 - Gastos Menores
   *   44 - Regímenes Especiales
   *   45 - Gubernamental
   *   46 - Exportaciones
   *   47 - Pagos al Exterior
   * Segundo:
   *   33 - Nota de Débito
   *   34 - Nota de Crédito
   * Tercero:
   *   32 - Resumen Factura de Consumo Electrónica Menor a RD$ 250,000.00 (RFCE)
   * Cuarto:
   *   32 - Factura de Consumo Electrónica Menor a RD$ 250,000.00 (e-CF individual)
   */
  getDgiiExecutionRank(item: { tipoeCF: string; montoTotal?: number; esRfce?: boolean }): number {
    if (item.esRfce) {
      return 300; // Tercero: 32 - Resumen Factura de Consumo Electrónica Menor a RD$250,000.00
    }
    const tipo = item.tipoeCF.replace(/^E/i, '').padStart(2, '0');
    if (tipo === '33') return 201; // Segundo: 33 - Nota de Débito
    if (tipo === '34') return 202; // Segundo: 34 - Nota de Crédito
    if (tipo === '32' && (item.montoTotal ?? 0) < 250000) {
      return 400; // Cuarto: 32 - Factura de Consumo < RD$ 250,000.00
    }

    // Primero: 31, 32 (>= 250k), 41, 43, 44, 45, 46, 47
    const rankMapPrimero: Record<string, number> = {
      '31': 101,
      '32': 102,
      '41': 103,
      '43': 104,
      '44': 105,
      '45': 106,
      '46': 107,
      '47': 108,
    };
    return rankMapPrimero[tipo] || 199;
  }

  buildTestCasesFromImport(imported: DgiiTestSetImportResult): TestCaseItem[] {
    this.consumerMinorCache.clear();
    this.importedEcfMap.clear();
    for (const row of imported.ecfRows) {
      const norm = this.normalizeENcf(row.eNCF);
      this.importedEcfMap.set(norm, row);
    }

    const fallback = { nombreCaso: 'Caso de Prueba DGII', descripcion: 'Comprobante de prueba', razonSocialComprador: 'Consumidor Final' };

    const fromEcf: TestCaseItem[] = imported.ecfRows.map((row, index) => {
      const tipo = row.tipoeCF.replace(/^E/i, '').padStart(2, '0');
      const info = DgiiCertificationService.DESCRIPCION_POR_TIPO[tipo] || fallback;
      const esNota = tipo === '33' || tipo === '34';
      const isConsumerMinor = tipo === '32' && row.montoTotal < 250000;
      const normalizedEncf = this.normalizeENcf(row.eNCF);
      const normalizedModificado = esNota && row.eNCFModificado ? this.normalizeENcf(row.eNCFModificado) : undefined;

      const suffix = isConsumerMinor
        ? ' (E32, consumo < RD$250k)'
        : ` (E${tipo})`;

      return {
        id: `dgii-import-ecf-${index + 1}`,
        casoNumero: index + 1,
        nombreCaso: `${row.casoPrueba || info.nombreCaso}${suffix}`,
        tipoeCF: `E${tipo}` as TestCaseItem['tipoeCF'],
        eNCF: normalizedEncf,
        rncComprador: row.rncComprador || info.rncComprador,
        razonSocialComprador: row.razonSocialComprador || info.razonSocialComprador,
        montoTotal: row.montoTotal,
        itemsCount: row.items && row.items.length > 0 ? row.items.length : 1,
        descripcion: row.items && row.items[0] ? row.items[0].nombreItem : info.descripcion,
        status: 'PENDING',
        logs: [],
        eNCFModificado: normalizedModificado,
        extraEcfData: row,
      };
    });

    const fromRfce: TestCaseItem[] = imported.rfceRows.map((row, index) => {
      const info = DgiiCertificationService.DESCRIPCION_POR_TIPO['32'];
      const normalizedEncf = this.normalizeENcf(row.eNCF);
      return {
        id: `dgii-import-rfce-${index + 1}`,
        casoNumero: fromEcf.length + index + 1,
        nombreCaso: `${row.casoPrueba || 'Resumen RFCE'} (RFCE, consumo < RD$250k)`,
        tipoeCF: 'E32',
        eNCF: normalizedEncf,
        rncComprador: row.rncComprador,
        razonSocialComprador: row.razonSocialComprador || info.razonSocialComprador,
        montoTotal: row.montoTotal,
        itemsCount: 1,
        descripcion: 'Resumen de Factura de Consumo Electrónica (RFCE)',
        status: 'PENDING',
        logs: [],
        esRfce: true,
        extraRfceData: {
          razonSocialEmisor: row.razonSocialEmisor,
          fechaEmision: row.fechaEmision,
          montoGravadoTotal: row.montoGravadoTotal,
          montoGravadoI1: row.montoGravadoI1,
          montoExento: row.montoExento,
          totalITBIS: row.totalITBIS,
          totalITBIS1: row.totalITBIS1,
        },
      };
    });

    // Ordenamiento estricto por directriz DGII:
    // Primero: 31, 32 (>=250k), 41, 43, 44, 45, 46, 47
    // Segundo: 33, 34
    // Tercero: 32 RFCE
    // Cuarto:  32 Factura de Consumo (<250k)
    const allCases = [...fromEcf, ...fromRfce];
    allCases.sort((a, b) => {
      const rankA = this.getDgiiExecutionRank(a);
      const rankB = this.getDgiiExecutionRank(b);
      if (rankA !== rankB) return rankA - rankB;
      return a.casoNumero - b.casoNumero;
    });

    allCases.forEach((item, idx) => {
      item.casoNumero = idx + 1;
    });

    return allCases;
  }

  /**
   * Ejecuta el Paso 4 completo de Simulación e-CF (25 Comprobantes en 5 Etapas)
   */
  async runSimulationStep4(sequenceOffset: number = 0): Promise<{
    total: number;
    etapa1Base: { total: number; aceptados: number };
    etapa2Notas: { total: number; aceptados: number };
    etapa3Rfce: { total: number; aceptados: number };
    results: TestCaseItem[];
    logs: string[];
  }> {
    const dataset = this.get25SimulationDataset(sequenceOffset);
    const globalLogs: string[] = [];
    const now = () => new Date().toLocaleTimeString('es-DO', { hour12: false });

    globalLogs.push(`[${now()}] ===============================================================`);
    globalLogs.push(`[${now()}] 🚀 INICIANDO RUNNER DE SIMULACIÓN e-CF (PASO 4 DGII) - 25 COMPROBANTES`);
    globalLogs.push(`[${now()}] ===============================================================`);

    const results: TestCaseItem[] = [];
    let aceptadosEtapa1 = 0;
    let aceptadosEtapa2 = 0;
    let aceptadosEtapa3 = 0;

    // ETAPA 1: 18 Comprobantes Base
    globalLogs.push(`\n[${now()}] --- ETAPA 1: Enviando Comprobantes Base a Recepción e-CF (18 comprobantes) ---`);
    for (const item of dataset.ecfGenerales) {
      const res = await this.runTestCase(item, 'SIMULATION');
      results.push(res);
      if (res.status === 'ACCEPTED') aceptadosEtapa1++;
      globalLogs.push(`[${now()}] [Etapa 1] ${item.eNCF} (${item.tipoeCF}) -> ${res.status} | TrackId: ${res.trackId || 'N/A'}`);
    }

    // ETAPA 2: 3 Notas de Débito y Crédito
    const simConfig = await this.dgiiClient.getConfig();
    if (simConfig.environment !== 'sandbox') {
      globalLogs.push(`\n[${now()}] ⏳ Esperando 15 segundos para que los servidores de la DGII procesen y asienten los e-CF base antes de emitir las notas...`);
      await new Promise((resolve) => setTimeout(resolve, 15000));
    }
    globalLogs.push(`[${now()}] --- ETAPA 2: Enviando Notas de Débito y Crédito (3 comprobantes) ---`);
    for (const item of dataset.ecfNotas) {
      const res = await this.runTestCase(item, 'SIMULATION');
      results.push(res);
      if (res.status === 'ACCEPTED') aceptadosEtapa2++;
      globalLogs.push(`[${now()}] [Etapa 2] ${item.eNCF} (${item.tipoeCF}) -> ${res.status} | TrackId: ${res.trackId || 'N/A'}`);
    }

    // ETAPA 3: 4 Resúmenes RFCE
    globalLogs.push(`\n[${now()}] --- ETAPA 3: Enviando Resúmenes RFCE para Consumo Menor (4 comprobantes) ---`);
    for (const item of dataset.ecfConsumoMenor) {
      const res = await this.runTestCase(item, 'SIMULATION');
      results.push(res);
      if (res.status === 'ACCEPTED') aceptadosEtapa3++;
      globalLogs.push(`[${now()}] [Etapa 3 RFCE] ${item.eNCF} (${item.tipoeCF}) -> ${res.status} | TrackId: ${res.trackId || 'N/A'}`);
    }

    globalLogs.push(`\n[${now()}] ===============================================================`);
    globalLogs.push(`[${now()}] 🎯 RESUMEN FINAL PASO 4 (SIMULACIÓN): Base: ${aceptadosEtapa1}/18 | Notas: ${aceptadosEtapa2}/3 | RFCE: ${aceptadosEtapa3}/4`);
    globalLogs.push(`[${now()}] ===============================================================\n`);

    return {
      total: results.length,
      etapa1Base: { total: dataset.ecfGenerales.length, aceptados: aceptadosEtapa1 },
      etapa2Notas: { total: dataset.ecfNotas.length, aceptados: aceptadosEtapa2 },
      etapa3Rfce: { total: dataset.ecfConsumoMenor.length, aceptados: aceptadosEtapa3 },
      results,
      logs: globalLogs,
    };
  }

  /**
   * Ejecuta un caso individual del Set de Pruebas DGII.
   */
  async runTestCase(item: TestCaseItem, source: 'TEST_CASE' | 'RUN_ALL' | 'SIMULATION' = 'TEST_CASE'): Promise<TestCaseItem> {
    const logs: string[] = [];
    const now = () => new Date().toLocaleTimeString('es-DO', { hour12: false });

    const normalizedEncf = this.normalizeENcf(item.eNCF);
    item.eNCF = normalizedEncf;

    logs.push(`[${now()}] 🚀 Iniciando ejecución de Caso ${item.casoNumero}: ${item.nombreCaso} (${item.tipoeCF})`);

    // Un Resumen RFCE no es un e-CF individual: va por un host/ruta distinto
    // de la DGII y su Código de Seguridad depende de la firma real del e-CF
    // de consumo subyacente.
    if (item.esRfce) {
      return this.runRfceCase(item, logs, source);
    }

    // Cuarto: Factura de Consumo < RD$ 250,000.00
    // Conforme a la normativa DGII y Ley 32-23, esta factura no debe enviarse por el canal
    // Web Service /ecf ("Esta factura no es válida por este canal. Enviar por resumen B2C").
    // Su declaración ante la DGII se realiza vía RFCE (Etapa 3).
    // Para la Etapa 4, se genera, firma y almacena localmente conforme a XSD ecf-32.xsd
    // para inspección, descarga o verificación manual en el portal DGII.
    const isConsumerMinor = item.tipoeCF === 'E32' && (item.montoTotal ?? 0) < 250000;
    if (isConsumerMinor) {
      return this.runConsumerMinorLocalCase(item, logs, source);
    }

    const esNota = item.tipoeCF === 'E33' || item.tipoeCF === 'E34';
    if (esNota && item.eNCFModificado) {
      const baseRun = await this.getLastStatus(this.normalizeENcf(item.eNCFModificado));
      if (!baseRun || baseRun.status !== 'ACCEPTED') {
        const motivo = baseRun ? `tiene estado ${baseRun.status}` : 'no tiene ninguna corrida registrada todavía';
        logs.push(`[${now()}] ⛔ Nota bloqueada localmente: el e-CF base ${item.eNCFModificado} ${motivo} — la DGII rechazaría esta nota (error 615, referencia a comprobante inexistente/no aceptado).`);
        const blocked: TestCaseItem = { ...item, status: 'ERROR', executedAt: new Date(), logs };
        await this.persistRun(source, blocked, {
          status: 'ERROR',
          responseMessage: `Bloqueado localmente: el e-CF base ${item.eNCFModificado} no está aceptado (${motivo}).`,
        });
        return blocked;
      }
      logs.push(`[${now()}] ✅ e-CF base ${item.eNCFModificado} verificado como ACCEPTED en el historial — se procede a emitir la nota.`);
    }

    try {
      const config = await this.dgiiClient.getConfig();
      logs.push(`[${now()}] ⚙️ Entorno: ${config.environment.toUpperCase()} | Emisor: ${config.rncEmisor}`);

      // Caso especial: Comprobante de Compras E41, Nota de Crédito Informativa E34, Exento y Tasa Cero
      const isE41 = item.tipoeCF === 'E41';
      const isE47 = item.tipoeCF === 'E47';
      const isTextoCorrige = item.tipoeCF === 'E34' && item.montoTotal === 0;
      const isNotaExenta =
        (item.tipoeCF === 'E34' || item.tipoeCF === 'E33') &&
        (item.eNCFModificado?.startsWith('E44') ||
          item.eNCFModificado?.startsWith('E43') ||
          item.nombreCaso?.includes('E44') ||
          item.nombreCaso?.includes('Exento'));
      const isExempt = item.tipoeCF === 'E43' || item.tipoeCF === 'E44' || isE47 || isNotaExenta;
      const isTasaCero = item.tipoeCF === 'E46';

      let indicadorFacturacion: '0' | '1' | '2' | '3' | '4' = '1';
      let precioUnitario = Number((item.montoTotal / 1.18).toFixed(2));
      let montoItem = precioUnitario;
      let montoITBISRetenido: number | undefined = undefined;
      let montoISRRetenido: number | undefined = undefined;

      if (isE41) {
        // E41 Compras a proveedores informales:
        // Gravado 18% (IndicadorFacturacion = '1'), Retención 100% ITBIS y 10% ISR
        indicadorFacturacion = '1';
        precioUnitario = Number((item.montoTotal / 1.18).toFixed(2));
        montoItem = precioUnitario;
        const itbis = Number((item.montoTotal - precioUnitario).toFixed(2));
        montoITBISRetenido = itbis; // 100% ITBIS retenido por Comprobante de Compras
        montoISRRetenido = Number((precioUnitario * 0.10).toFixed(2)); // 10% ISR retenido
      } else if (isE47) {
        // E47 Pagos al Exterior: Exento de ITBIS (IndicadorFacturacion = '4'), Retención 27% ISR (Art. 305 Ley 11-92)
        indicadorFacturacion = '4';
        precioUnitario = item.montoTotal;
        montoItem = item.montoTotal;
        montoISRRetenido = Number((item.montoTotal * 0.27).toFixed(2));
      } else if (isTextoCorrige) {
        // E34 Corrección de Texto (Código 2 DGII / TarbiatAdmin producción):
        // 0 = No Facturable / Informativo en detalle con MontoNoFacturable = 1.00 y MontoTotal = 0.00
        indicadorFacturacion = '0';
        precioUnitario = 1;
        montoItem = 1;
      } else if (isTasaCero) {
        // E46 Pagos al exterior / Exportaciones: Gravado Tasa 0% (I3), no lleva división entre 1.18
        indicadorFacturacion = '3';
        precioUnitario = item.montoTotal;
        montoItem = item.montoTotal;
      } else if (isExempt) {
        // E43, E44 y Notas que anulan comprobantes exentos: Exento de ITBIS (IndicadorFacturacion = '4')
        indicadorFacturacion = '4';
        precioUnitario = item.montoTotal;
        montoItem = item.montoTotal;
      }

      const extra = item.extraEcfData;
      let input: EcfGenerationInput;

      const defaultVencimiento = '31-12-2028';
      const nowEmision = new Date();
      const todayStr = `${String(nowEmision.getDate()).padStart(2, '0')}-${String(nowEmision.getMonth() + 1).padStart(2, '0')}-${nowEmision.getFullYear()}`;

      if (extra) {
        let items: EcfItemInput[] = [];
        if (extra.items && extra.items.length > 0) {
          items = extra.items.map((it) => ({
            numeroLinea: it.numeroLinea,
            nombreItem: it.nombreItem,
            indicadorBienoServicio: ((it.indicadorBienoServicio as any) || (item.tipoeCF === 'E41' || item.tipoeCF === 'E43' ? '1' : '2')) as '1' | '2',
            indicadorFacturacion: it.indicadorFacturacion as any,
            descripcionItem: it.descripcionItem,
            cantidad: it.cantidadItem,
            cantidadStr: it.cantidadItemStr,
            unidadMedida: it.unidadMedida,
            cantidadReferenciaStr: it.cantidadReferenciaStr,
            unidadReferenciaStr: it.unidadReferenciaStr,
            subcantidades: it.subcantidades,
            gradosAlcoholStr: it.gradosAlcoholStr,
            precioUnitarioReferenciaStr: it.precioUnitarioReferenciaStr,
            fechaElaboracion: it.fechaElaboracion,
            fechaVencimientoItem: it.fechaVencimientoItem,
            precioUnitario: it.precioUnitarioItem,
            precioUnitarioStr: it.precioUnitarioItemStr,
            descuentoMonto: it.descuentoMonto,
            descuentoMontoStr: it.descuentoMontoStr,
            subDescuentos: it.subDescuentos,
            recargoMonto: it.recargoMonto,
            recargoMontoStr: it.recargoMontoStr,
            subRecargos: it.subRecargos,
            impuestosAdicionalesCodigos: it.impuestosAdicionalesCodigos,
            montoItem: it.montoItem,
            montoItemStr: it.montoItemStr,
            montoITBISRetenido: it.montoITBISRetenido,
            montoISRRetenido: it.montoISRRetenido,
            indicadorAgenteRetencionoPercepcion: it.indicadorAgenteRetencionoPercepcion,
          }));
        } else {
          items = [
            {
              numeroLinea: 1,
              nombreItem: item.descripcion,
              indicadorBienoServicio: item.tipoeCF === 'E41' || item.tipoeCF === 'E43' ? '1' : '2',
              indicadorFacturacion,
              cantidad: 1,
              precioUnitario,
              montoItem,
              montoITBISRetenido,
              montoISRRetenido,
              indicadorAgenteRetencionoPercepcion: isE41 ? '1' : undefined,
            },
          ];
        }

        input = {
          ncfType: item.tipoeCF,
          eNcf: normalizedEncf,
          rncComprador: extra.rncComprador || item.rncComprador,
          razonSocialComprador: extra.razonSocialComprador || item.razonSocialComprador,
          correoComprador: extra.correoComprador,
          direccionComprador: extra.direccionComprador,
          informacionesAdicionales: extra.informacionesAdicionales,
          tipoPago: extra.tipoPago,
          terminoPago: extra.terminoPago,
          numeroReferencia: extra.numeroReferencia,
          tipoIngresos: extra.tipoIngresos,
          indicadorMontoGravado:
            extra.indicadorMontoGravado !== undefined && extra.indicadorMontoGravado !== ''
              ? extra.indicadorMontoGravado
              : '0',
          fechaVencimientoSecuencia:
            extra.fechaVencimientoSecuencia ||
            item.fechaVencimientoSecuencia ||
            (usesNcfExpiryDate(item.tipoeCF) ? defaultVencimiento : undefined),
          indicadorNotaCredito:
            extra.indicadorNotaCredito !== undefined && extra.indicadorNotaCredito !== ''
              ? (String(extra.indicadorNotaCredito) as any)
              : (esNota ? '0' : undefined),
          ncfModificado: esNota ? this.normalizeENcf(extra.eNCFModificado || item.eNCFModificado || 'E310000000001') : undefined,
          fechaNcfModificado: extra.fechaNCFModificado || (esNota ? todayStr : undefined),
          codigoModificacion:
            extra.codigoModificacion !== undefined && extra.codigoModificacion !== ''
              ? (String(extra.codigoModificacion) as any)
              : (isTextoCorrige ? '2' : '1'),
          razonModificacion: extra.razonModificacion !== undefined ? extra.razonModificacion : (isTextoCorrige ? 'Corrección de texto descriptivo' : 'Ajuste de facturación de pruebas'),
          items,
          descuentosORecargos: extra.descuentosORecargos,
          emisorOverride: {
            rncEmisor: extra.rncEmisor,
            razonSocialEmisor: extra.razonSocialEmisor,
            nombreComercial: extra.nombreComercial,
            direccionEmisor: extra.direccionEmisor,
            municipio: extra.municipio,
            provincia: extra.provincia,
            telefonos: extra.telefonosEmisor,
            correoEmisor: extra.correoEmisor,
            webSite: extra.webSite,
            fechaEmisionStr: extra.fechaEmision,
            codigoVendedor: extra.codigoVendedor,
            numeroFacturaInterna: extra.numeroFacturaInterna,
            numeroPedidoInterno: extra.numeroPedidoInterno,
            zonaVenta: extra.zonaVenta,
          },
          compradorOverride: {
            rncComprador: extra.rncComprador,
            identificadorExtranjero: extra.identificadorExtranjero,
            razonSocialComprador: extra.razonSocialComprador,
            contactoComprador: extra.contactoComprador,
            correoComprador: extra.correoComprador,
            direccionComprador: extra.direccionComprador,
            municipioComprador: extra.municipioComprador,
            provinciaComprador: extra.provinciaComprador,
            telefonoAdicional: extra.telefonoAdicional,
            fechaEntregaStr: extra.fechaEntrega,
            fechaOrdenCompraStr: extra.fechaOrdenCompra,
            numeroOrdenCompra: extra.numeroOrdenCompra,
            codigoInternoComprador: extra.codigoInternoComprador,
          },
          totalesOverride: {
            montoGravadoTotal: extra.montoGravadoTotal,
            montoGravadoTotalStr: extra.montoGravadoTotalStr,
            montoGravadoI1: extra.montoGravadoI1,
            montoGravadoI1Str: extra.montoGravadoI1Str,
            montoGravadoI2: extra.montoGravadoI2,
            montoGravadoI2Str: extra.montoGravadoI2Str,
            montoGravadoI3: extra.montoGravadoI3,
            montoGravadoI3Str: extra.montoGravadoI3Str,
            montoExento: extra.montoExento,
            montoExentoStr: extra.montoExentoStr,
            itbis1: extra.itbis1,
            itbis2: extra.itbis2,
            itbis3: extra.itbis3,
            totalITBIS: extra.totalITBIS,
            totalITBISStr: extra.totalITBISStr,
            totalITBIS1: extra.totalITBIS1,
            totalITBIS1Str: extra.totalITBIS1Str,
            totalITBIS2: extra.totalITBIS2,
            totalITBIS2Str: extra.totalITBIS2Str,
            totalITBIS3: extra.totalITBIS3,
            totalITBIS3Str: extra.totalITBIS3Str,
            totalITBISRetenido: extra.totalITBISRetenido,
            totalISRRetencion: extra.totalISRRetencion,
            montoImpuestoAdicional: extra.montoImpuestoAdicional,
            montoImpuestoAdicionalStr: extra.montoImpuestoAdicionalStr,
            impuestosAdicionales: extra.impuestosAdicionales,
            montoTotal: extra.montoTotal,
            montoTotalStr: extra.montoTotalStr,
            montoNoFacturable: extra.montoNoFacturable,
            montoPeriodo: extra.montoPeriodo,
            valorPagar: extra.valorPagar,
          },
        };
      } else {
        let totalesOverride: any = undefined;

        if (isTextoCorrige) {
          totalesOverride = {
            montoTotal: 0,
            montoTotalStr: '0.00',
            montoNoFacturable: 1.00,
          };
        } else if (isNotaExenta) {
          totalesOverride = {
            montoExento: item.montoTotal,
            montoExentoStr: item.montoTotal.toFixed(2),
            montoTotal: item.montoTotal,
            montoTotalStr: item.montoTotal.toFixed(2),
          };
        } else if (isE47) {
          totalesOverride = {
            montoExento: item.montoTotal,
            montoExentoStr: item.montoTotal.toFixed(2),
            montoTotal: item.montoTotal,
            montoTotalStr: item.montoTotal.toFixed(2),
            totalISRRetencion: montoISRRetenido,
          };
        }

        input = {
          ncfType: item.tipoeCF,
          eNcf: normalizedEncf,
          rncComprador: item.rncComprador,
          razonSocialComprador: item.razonSocialComprador,
          correoComprador: 'cliente.simulacion@sumtech.com.do',
          direccionComprador: 'Av. Winston Churchill #100, Santo Domingo',
          tipoPago: '1',
          indicadorMontoGravado: '0',
          indicadorNotaCredito: esNota ? '0' : undefined,
          fechaVencimientoSecuencia:
            item.fechaVencimientoSecuencia ||
            (usesNcfExpiryDate(item.tipoeCF) ? defaultVencimiento : undefined),
          ncfModificado: esNota ? this.normalizeENcf(item.eNCFModificado || 'E310000000001') : undefined,
          fechaNcfModificado: esNota ? todayStr : undefined,
          codigoModificacion: isTextoCorrige ? '2' : (item.tipoeCF === 'E33' ? '3' : '1'),
          razonModificacion: isTextoCorrige
            ? 'Corrección de texto descriptivo'
            : isNotaExenta
            ? 'Anulación total de comprobante exento'
            : item.tipoeCF === 'E33'
            ? 'Ajuste de cargo extraordinario'
            : 'Ajuste de facturación de pruebas',
          totalesOverride,
          items: [
            {
              numeroLinea: 1,
              nombreItem: item.descripcion,
              indicadorBienoServicio: item.tipoeCF === 'E41' || item.tipoeCF === 'E43' ? '1' : '2',
              indicadorFacturacion,
              cantidad: 1,
              precioUnitario,
              montoItem,
              montoITBISRetenido,
              montoISRRetenido,
              indicadorAgenteRetencionoPercepcion: isE41 || isE47 ? '1' : undefined,
            },
          ],
        };
      }

      logs.push(`[${now()}] 📄 Construyendo documento XML e-CF estándar XSD v1.0...`);
      const rawXml = this.xmlGenerator.generateEcfXml(input, config);
      logs.push(`[${now()}] ✅ XML generado (${rawXml.length} bytes)`);

      // Validación fiscal local de monto total
      const montoGeneradoMatch = rawXml.match(/<MontoTotal>([\d.]+)<\/MontoTotal>/);
      const montoGenerado = montoGeneradoMatch ? Number(montoGeneradoMatch[1]) : NaN;
      if (Number.isFinite(montoGenerado) && Math.abs(montoGenerado - item.montoTotal) > 0.02) {
        logs.push(`[${now()}] ⚠️ Validación fiscal: el monto total generado (${montoGenerado.toFixed(2)}) no reconcilia con el monto declarado del caso (${item.montoTotal.toFixed(2)}).`);
      }

      logs.push(`[${now()}] 🔐 Aplicando firma digital XMLDSig RSA-SHA256 y C14N...`);
      const { securityCode, signedXml } = this.signerService.signXml(rawXml, config.certPath, config.certPassword || '');
      logs.push(`[${now()}] 🔑 Código de Seguridad DGII extraído: [${securityCode}]`);

      logs.push(`[${now()}] 🌐 Transmitiendo comprobante a la DGII...`);
      const result: DgiiSendResult = await this.dgiiClient.submitEcf(
        rawXml,
        item.eNCF,
        item.montoTotal,
        item.tipoeCF,
        item.rncComprador,
      );

      // Si el cliente no devolvió signedXml por error de red o contingencia, aseguramos el firmado local
      if (!result.signedXml && signedXml) {
        result.signedXml = signedXml;
      }

      logs.push(`[${now()}] 📥 Respuesta DGII recibida: ${result.status} | TrackId: ${result.trackId}`);
      if (result.status === 'CONTINGENCY') {
        logs.push(`[${now()}] ⚠️ La DGII no fue alcanzable — el comprobante quedó en modo CONTINGENCIA.`);
      }
      if (result.validationErrors?.length) {
        result.validationErrors.forEach((e) => logs.push(`[${now()}] ⛔ XSD: ${e}`));
      }

      const executed: TestCaseItem = {
        ...item,
        status: result.status,
        trackId: result.trackId,
        securityCode: result.securityCode,
        executedAt: new Date(),
        logs,
      };
      await this.persistRun(source, executed, result);
      return executed;
    } catch (error: any) {
      logs.push(`[${now()}] ❌ ERROR durante la ejecución: ${error.message}`);
      const failed: TestCaseItem = { ...item, status: 'ERROR', executedAt: new Date(), logs };
      await this.persistRun(source, failed, { status: 'ERROR', responseMessage: error.message });
      return failed;
    }
  }

  /**
   * Ejecuta la Etapa 4 de la DGII para Facturas de Consumo < RD$ 250,000.00:
   * Genera el e-CF estándar completo, lo firma digitalmente con RSA-SHA256,
   * extrae su Código de Seguridad auténtico y lo persiste en MinIO y base de datos con status ACCEPTED.
   * IMPORTANTE: No se transmite vía /ecf para evitar el rechazo oficial de canal ("Enviar por resumen B2C").
   */
  private async getOrGenerateConsumerMinorSignedEcf(
    normalizedEncf: string,
    fallbackRow?: DgiiTestSetEcfRow,
    fallbackItem?: TestCaseItem,
  ): Promise<{ securityCode: string; signedXml: string; signedAt: Date }> {
    const cached = this.consumerMinorCache.get(normalizedEncf);
    if (cached) {
      return cached;
    }

    const config = await this.dgiiClient.getConfig();
    const extra = this.importedEcfMap.get(normalizedEncf) || fallbackRow || fallbackItem?.extraEcfData;

    let input: EcfGenerationInput;
    let effectiveConfig = config;

    if (extra) {
      const items: EcfItemInput[] = extra.items && extra.items.length > 0
        ? extra.items.map((it) => ({
            numeroLinea: it.numeroLinea,
            nombreItem: it.nombreItem,
            indicadorBienoServicio: ((it.indicadorBienoServicio as any) || '2') as '1' | '2',
            indicadorFacturacion: (it.indicadorFacturacion as any) || '1',
            descripcionItem: it.descripcionItem,
            cantidad: it.cantidadItem,
            cantidadStr: it.cantidadItemStr,
            unidadMedida: it.unidadMedida,
            cantidadReferenciaStr: it.cantidadReferenciaStr,
            unidadReferenciaStr: it.unidadReferenciaStr,
            subcantidades: it.subcantidades,
            gradosAlcoholStr: it.gradosAlcoholStr,
            precioUnitarioReferenciaStr: it.precioUnitarioReferenciaStr,
            fechaElaboracion: it.fechaElaboracion,
            fechaVencimientoItem: it.fechaVencimientoItem,
            precioUnitario: it.precioUnitarioItem,
            precioUnitarioStr: it.precioUnitarioItemStr,
            descuentoMonto: it.descuentoMonto,
            descuentoMontoStr: it.descuentoMontoStr,
            subDescuentos: it.subDescuentos,
            recargoMonto: it.recargoMonto,
            recargoMontoStr: it.recargoMontoStr,
            subRecargos: it.subRecargos,
            impuestosAdicionalesCodigos: it.impuestosAdicionalesCodigos,
            montoItem: it.montoItem,
            montoItemStr: it.montoItemStr,
            montoITBISRetenido: it.montoITBISRetenido,
            montoISRRetenido: it.montoISRRetenido,
            indicadorAgenteRetencionoPercepcion: it.indicadorAgenteRetencionoPercepcion,
          }))
        : [
            {
              numeroLinea: 1,
              nombreItem: fallbackItem?.descripcion || 'Consumidor Final',
              indicadorBienoServicio: '2',
              indicadorFacturacion: '1',
              cantidad: 1,
              precioUnitario: Number(((fallbackItem?.montoTotal ?? 0) / 1.18).toFixed(2)),
              montoItem: Number(((fallbackItem?.montoTotal ?? 0) / 1.18).toFixed(2)),
            },
          ];

      input = {
        ncfType: 'E32',
        eNcf: normalizedEncf,
        rncComprador: extra.rncComprador || fallbackItem?.rncComprador,
        razonSocialComprador: extra.razonSocialComprador || fallbackItem?.razonSocialComprador || 'Consumidor Final',
        correoComprador: extra.correoComprador,
        direccionComprador: extra.direccionComprador,
        informacionesAdicionales: extra.informacionesAdicionales,
        tipoPago: extra.tipoPago || '1',
        terminoPago: extra.terminoPago,
        numeroReferencia: extra.numeroReferencia,
        tipoIngresos: extra.tipoIngresos,
        indicadorMontoGravado:
          extra.indicadorMontoGravado !== undefined && extra.indicadorMontoGravado !== ''
            ? extra.indicadorMontoGravado
            : '1',
        fechaVencimientoSecuencia: extra.fechaVencimientoSecuencia,
        items,
        descuentosORecargos: extra.descuentosORecargos,
        emisorOverride: {
          rncEmisor: extra.rncEmisor,
          razonSocialEmisor: extra.razonSocialEmisor,
          nombreComercial: extra.nombreComercial,
          direccionEmisor: extra.direccionEmisor,
          municipio: extra.municipio,
          provincia: extra.provincia,
          telefonos: extra.telefonosEmisor,
          correoEmisor: extra.correoEmisor,
          webSite: extra.webSite,
          fechaEmisionStr: extra.fechaEmision,
          codigoVendedor: extra.codigoVendedor,
          numeroFacturaInterna: extra.numeroFacturaInterna,
          numeroPedidoInterno: extra.numeroPedidoInterno,
          zonaVenta: extra.zonaVenta,
        },
        compradorOverride: {
          rncComprador: extra.rncComprador,
          identificadorExtranjero: extra.identificadorExtranjero,
          razonSocialComprador: extra.razonSocialComprador,
          contactoComprador: extra.contactoComprador,
          correoComprador: extra.correoComprador,
          direccionComprador: extra.direccionComprador,
          municipioComprador: extra.municipioComprador,
          provinciaComprador: extra.provinciaComprador,
          telefonoAdicional: extra.telefonoAdicional,
          fechaEntregaStr: extra.fechaEntrega,
          fechaOrdenCompraStr: extra.fechaOrdenCompra,
          numeroOrdenCompra: extra.numeroOrdenCompra,
          codigoInternoComprador: extra.codigoInternoComprador,
        },
        totalesOverride: {
          montoGravadoTotal: extra.montoGravadoTotal,
          montoGravadoTotalStr: extra.montoGravadoTotalStr,
          montoGravadoI1: extra.montoGravadoI1,
          montoGravadoI1Str: extra.montoGravadoI1Str,
          montoGravadoI2: extra.montoGravadoI2,
          montoGravadoI2Str: extra.montoGravadoI2Str,
          montoGravadoI3: extra.montoGravadoI3,
          montoGravadoI3Str: extra.montoGravadoI3Str,
          montoExento: extra.montoExento,
          montoExentoStr: extra.montoExentoStr,
          itbis1: extra.itbis1,
          itbis2: extra.itbis2,
          itbis3: extra.itbis3,
          totalITBIS: extra.totalITBIS,
          totalITBISStr: extra.totalITBISStr,
          totalITBIS1: extra.totalITBIS1,
          totalITBIS1Str: extra.totalITBIS1Str,
          totalITBIS2: extra.totalITBIS2,
          totalITBIS2Str: extra.totalITBIS2Str,
          totalITBIS3: extra.totalITBIS3,
          totalITBIS3Str: extra.totalITBIS3Str,
          totalITBISRetenido: extra.totalITBISRetenido,
          totalISRRetencion: extra.totalISRRetencion,
          montoImpuestoAdicional: extra.montoImpuestoAdicional,
          montoImpuestoAdicionalStr: extra.montoImpuestoAdicionalStr,
          impuestosAdicionales: extra.impuestosAdicionales,
          montoTotal: extra.montoTotal,
          montoTotalStr: extra.montoTotalStr,
          montoNoFacturable: extra.montoNoFacturable,
          montoPeriodo: extra.montoPeriodo,
          valorPagar: extra.valorPagar,
        },
      };

      if (extra.razonSocialEmisor && extra.razonSocialEmisor !== config.razonSocialEmisor) {
        effectiveConfig = { ...config, razonSocialEmisor: extra.razonSocialEmisor };
      }
    } else {
      const total = fallbackItem?.montoTotal ?? 0;
      const montoGravado = Number((total / 1.18).toFixed(2));
      input = {
        ncfType: 'E32',
        eNcf: normalizedEncf,
        rncComprador: fallbackItem?.rncComprador,
        razonSocialComprador: fallbackItem?.razonSocialComprador || 'Consumidor Final',
        correoComprador: 'cliente.simulacion@sumtech.com.do',
        tipoPago: '1',
        items: [
          {
            numeroLinea: 1,
            nombreItem: fallbackItem?.descripcion || 'Consumidor Final',
            indicadorBienoServicio: '2',
            indicadorFacturacion: '1',
            cantidad: 1,
            precioUnitario: montoGravado,
            montoItem: montoGravado,
          },
        ],
      };
    }

    const rawXml = this.xmlGenerator.generateEcfXml(input, effectiveConfig);
    const { securityCode, signedXml } = this.signerService.signXml(rawXml, config.certPath, config.certPassword || '');
    const entry = { securityCode, signedXml, signedAt: new Date() };
    this.consumerMinorCache.set(normalizedEncf, entry);
    return entry;
  }

  private async runConsumerMinorLocalCase(
    item: TestCaseItem,
    logs: string[],
    source: 'TEST_CASE' | 'RUN_ALL' | 'SIMULATION',
  ): Promise<TestCaseItem> {
    const now = () => new Date().toLocaleTimeString('es-DO', { hour12: false });

    try {
      const config = await this.dgiiClient.getConfig();
      const normalizedEncf = this.normalizeENcf(item.eNCF);

      logs.push(`[${now()}] ℹ️ Etapa 4 DGII: Factura de Consumo < RD$250k declarada ante DGII vía Resumen RFCE (Etapa 3).`);
      logs.push(`[${now()}] ⚙️ Entorno: ${config.environment.toUpperCase()} | Emisor: ${config.rncEmisor}`);
      logs.push(`[${now()}] 📄 Obteniendo e-CF estándar XSD v1.0 firmado correspondiente a ${normalizedEncf}...`);

      const { securityCode, signedXml, signedAt } = await this.getOrGenerateConsumerMinorSignedEcf(
        normalizedEncf,
        item.extraEcfData,
        item,
      );

      logs.push(`[${now()}] 🔑 Código de Seguridad DGII extraído: [${securityCode}]`);
      logs.push(`[${now()}] 💾 e-CF íntegro persistido localmente con firma idéntica al Resumen RFCE para el portal DGII.`);

      const executed: TestCaseItem = {
        ...item,
        status: 'ACCEPTED',
        securityCode,
        executedAt: new Date(),
        logs,
      };

      await this.persistRun(source, executed, {
        status: 'ACCEPTED',
        securityCode,
        signedXml,
        responseMessage: 'e-CF de consumo < 250k generado y firmado localmente para Etapa 4 con firma sincronizada con RFCE',
        signedAt,
      });

      return executed;
    } catch (error: any) {
      logs.push(`[${now()}] ❌ ERROR durante la ejecución: ${error.message}`);
      const failed: TestCaseItem = { ...item, status: 'ERROR', executedAt: new Date(), logs };
      await this.persistRun(source, failed, { status: 'ERROR', responseMessage: error.message });
      return failed;
    }
  }

  /**
   * Ejecuta un Resumen RFCE: genera y firma LOCALMENTE el e-CF tipo 32 que resume,
   * extrae su Código de Seguridad auténtico, transmite el RFCE y persiste el e-CF base
   * íntegro para que esté disponible para descarga y posterior carga manual en el portal DGII.
   */
  private async runRfceCase(item: TestCaseItem, logs: string[], source: 'TEST_CASE' | 'RUN_ALL' | 'SIMULATION'): Promise<TestCaseItem> {
    const now = () => new Date().toLocaleTimeString('es-DO', { hour12: false });

    try {
      const config = await this.dgiiClient.getConfig();
      const normalizedEncf = this.normalizeENcf(item.eNCF);
      const extra = item.extraRfceData;
      const montoGravado = extra?.montoGravadoTotal ?? Number((item.montoTotal / 1.18).toFixed(2));
      const totalITBIS = extra?.totalITBIS ?? Number((item.montoTotal - montoGravado).toFixed(2));
      const effectiveRazonSocialEmisor = extra?.razonSocialEmisor || config.razonSocialEmisor;
      const effectiveFechaEmision = extra?.fechaEmision;

      logs.push(`[${now()}] 📄 Obteniendo o generando el e-CF base subyacente (${normalizedEncf}) para extraer su Código de Seguridad real...`);
      const { securityCode: baseSecurityCode, signedXml: baseSignedXml } = await this.getOrGenerateConsumerMinorSignedEcf(
        normalizedEncf,
        item.extraEcfData,
        item,
      );
      logs.push(`[${now()}] 🔑 Código de Seguridad real del e-CF de consumo: [${baseSecurityCode}]`);

      // Persistir también el e-CF de consumo base íntegro y firmado para que quede
      // disponible para descarga y posterior carga manual en el portal DGII ("Elegir archivo" en Paso 2)
      await this.persistRun(source, {
        ...item,
        id: `${item.id}-base-signed`,
        eNCF: normalizedEncf,
        nombreCaso: `Factura de Consumo Íntegra < 250k (${normalizedEncf})`,
        esRfce: false,
        status: 'ACCEPTED',
        securityCode: baseSecurityCode,
        logs: [
          `[${now()}] ✅ e-CF de consumo < 250k generado y firmado digitalmente.`,
          `[${now()}] 🔑 Código de Seguridad: [${baseSecurityCode}].`,
          `[${now()}] 💾 Listo para ser cargado en el portal DGII tras aceptación de su RFCE.`,
        ],
      }, {
        status: 'ACCEPTED',
        securityCode: baseSecurityCode,
        signedXml: baseSignedXml,
        responseMessage: 'e-CF de consumo íntegro firmado localmente listo para subir a DGII',
      });

      logs.push(`[${now()}] 📄 Construyendo Resumen RFCE...`);
      const rfceRawXml = this.xmlGenerator.generateRfceXml(
        normalizedEncf,
        config.rncEmisor,
        item.montoTotal,
        totalITBIS,
        baseSecurityCode,
        {
          razonSocialEmisor: effectiveRazonSocialEmisor,
          fechaEmision: effectiveFechaEmision,
          rncComprador: item.rncComprador,
          razonSocialComprador: item.razonSocialComprador,
          montoGravadoTotal: montoGravado,
          montoGravadoI1: extra?.montoGravadoI1 ?? montoGravado,
          montoExento: extra?.montoExento,
          totalItbis1: extra?.totalITBIS1 ?? totalITBIS,
        },
      );

      logs.push(`[${now()}] 🌐 Transmitiendo Resumen RFCE a la DGII (canal fc.dgii.gov.do)...`);
      const result: DgiiSendResult = await this.dgiiClient.submitRfce(rfceRawXml, normalizedEncf, item.montoTotal);

      logs.push(`[${now()}] 📥 Respuesta DGII recibida: ${result.status} | TrackId: ${result.trackId}`);
      if (result.validationErrors?.length) {
        result.validationErrors.forEach((e) => logs.push(`[${now()}] ⛔ XSD: ${e}`));
      }

      const executed: TestCaseItem = {
        ...item,
        eNCF: normalizedEncf,
        status: result.status,
        trackId: result.trackId,
        securityCode: result.securityCode,
        executedAt: new Date(),
        logs,
      };
      await this.persistRun(source, executed, result);
      return executed;
    } catch (error: any) {
      logs.push(`[${now()}] ❌ ERROR durante la ejecución del RFCE: ${error.message}`);
      const failed: TestCaseItem = { ...item, status: 'ERROR', executedAt: new Date(), logs };
      await this.persistRun(source, failed, { status: 'ERROR', responseMessage: error.message });
      return failed;
    }
  }

  /**
   * Obtiene el XML firmado de un comprobante por su e-NCF desde el historial.
   */
  async getSignedXmlByEncf(eNcf: string): Promise<{ eNcf: string; filename: string; signedXml: string } | null> {
    const normalized = this.normalizeENcf(eNcf);
    const config = await this.dgiiClient.getConfig();
    const run = await this.runRepository.findOne({
      where: { eNcf: normalized },
      order: { executedAt: 'DESC' },
    });
    if (run && run.signedXml) {
      return {
        eNcf: normalized,
        filename: `${config.rncEmisor || ''}${normalized}.xml`,
        signedXml: run.signedXml,
      };
    }

    const cached = this.consumerMinorCache.get(normalized);
    if (cached) {
      return {
        eNcf: normalized,
        filename: `${config.rncEmisor || ''}${normalized}.xml`,
        signedXml: cached.signedXml,
      };
    }

    // Buscar en dataset de simulación (25 casos) o importados
    const dataset = this.get25SimulationDataset(0);
    const item = dataset.todosLosCasos.find((c) => this.normalizeENcf(c.eNCF) === normalized);
    if (item) {
      try {
        if (item.tipoeCF === 'E32' && item.montoTotal < 250000) {
          const gen = await this.getOrGenerateConsumerMinorSignedEcf(normalized, item.extraEcfData, item);
          return {
            eNcf: normalized,
            filename: `${config.rncEmisor || ''}${normalized}.xml`,
            signedXml: gen.signedXml,
          };
        } else {
          const esNota = item.tipoeCF === 'E33' || item.tipoeCF === 'E34';
          const isTextoCorrige = item.tipoeCF === 'E34' && item.montoTotal === 0;
          const isNotaExenta =
            (item.tipoeCF === 'E34' || item.tipoeCF === 'E33') &&
            (item.eNCFModificado?.startsWith('E44') ||
              item.eNCFModificado?.startsWith('E43') ||
              item.nombreCaso?.includes('E44') ||
              item.nombreCaso?.includes('Exento'));
          const isExempt = item.tipoeCF === 'E43' || item.tipoeCF === 'E44' || item.tipoeCF === 'E47' || isNotaExenta;
          const isTasaCero = item.tipoeCF === 'E46';

          let subtotal = item.montoTotal;
          let indicadorFacturacion: '0' | '1' | '2' | '3' | '4' = '1';
          if (isExempt) {
            indicadorFacturacion = '4';
            subtotal = item.montoTotal;
          } else if (isTasaCero) {
            indicadorFacturacion = '3';
            subtotal = item.montoTotal;
          } else if (isTextoCorrige) {
            indicadorFacturacion = '0';
            subtotal = 1;
          } else if (item.montoTotal > 0) {
            subtotal = Number((item.montoTotal / 1.18).toFixed(2));
          }

          const precioUnitario = isTextoCorrige ? 1 : subtotal;
          const montoItem = isTextoCorrige ? 1 : subtotal;

          let totalesOverride: any = undefined;
          if (isTextoCorrige) {
            totalesOverride = {
              montoTotal: 0,
              montoTotalStr: '0.00',
              montoNoFacturable: 1.00,
            };
          } else if (isNotaExenta) {
            totalesOverride = {
              montoExento: item.montoTotal,
              montoExentoStr: item.montoTotal.toFixed(2),
              montoTotal: item.montoTotal,
              montoTotalStr: item.montoTotal.toFixed(2),
            };
          } else if (item.tipoeCF === 'E47') {
            totalesOverride = {
              montoExento: item.montoTotal,
              montoExentoStr: item.montoTotal.toFixed(2),
              montoTotal: item.montoTotal,
              montoTotalStr: item.montoTotal.toFixed(2),
              totalISRRetencion: Number((item.montoTotal * 0.27).toFixed(2)),
            };
          }

          const input: EcfGenerationInput = {
            ncfType: item.tipoeCF,
            eNcf: normalized,
            rncComprador: item.rncComprador,
            razonSocialComprador: item.razonSocialComprador,
            correoComprador: 'cliente.simulacion@sumtech.com.do',
            direccionComprador: 'Av. Winston Churchill #100, Santo Domingo',
            tipoPago: '1',
            indicadorMontoGravado: '0',
            indicadorNotaCredito: esNota ? '0' : undefined,
            ncfModificado: esNota ? this.normalizeENcf(item.eNCFModificado || 'E310000000001') : undefined,
            codigoModificacion: isTextoCorrige ? '2' : '1',
            razonModificacion: isTextoCorrige ? 'Corrección de texto descriptivo' : 'Ajuste de facturación de pruebas',
            totalesOverride,
            items: [
              {
                numeroLinea: 1,
                nombreItem: item.descripcion,
                indicadorBienoServicio: item.tipoeCF === 'E41' || item.tipoeCF === 'E43' ? '1' : '2',
                indicadorFacturacion,
                cantidad: 1,
                precioUnitario,
                montoItem,
              },
            ],
          };

          const rawXml = this.xmlGenerator.generateEcfXml(input, config);
          const { signedXml } = this.signerService.signXml(rawXml, config.certPath, config.certPassword || '');
          return {
            eNcf: normalized,
            filename: `${config.rncEmisor || ''}${normalized}.xml`,
            signedXml,
          };
        }
      } catch (err: any) {
        this.logger.warn(`No se pudo generar XML firmado al vuelo para ${normalized}: ${err.message}`);
      }
    }

    return null;
  }

  /**
   * Retorna los XMLs firmados de las 4 Facturas de Consumo < 250k (base de los RFCE)
   * para que el usuario pueda descargarlos y subirlos al portal de la DGII en el Paso 2 ("Elegir archivo").
   */
  async getRfceBaseSignedXmls(): Promise<Array<{
    eNcf: string;
    filename: string;
    signedXml: string;
    montoTotal: number;
    securityCode: string;
    executedAt: Date;
    casoPrueba?: string;
    razonSocialComprador?: string;
    setPruebas?: string;
  }>> {
    const config = await this.dgiiClient.getConfig();

    // 1. Obtener los eNCFs de los Resúmenes RFCE del lote más reciente (máximo 4 comprobantes)
    const rfceRuns = await this.runRepository.find({
      where: { tipoEcf: '32', esRfce: true },
      order: { executedAt: 'DESC' },
      take: 20,
    });
    const latestRfceEncfSet = new Set<string>();
    const rfceRunMap = new Map<string, DgiiCertificationRun>();
    for (const r of rfceRuns) {
      if (latestRfceEncfSet.size < 4) {
        latestRfceEncfSet.add(r.eNcf);
      }
      if (latestRfceEncfSet.has(r.eNcf) && !rfceRunMap.has(r.eNcf)) {
        rfceRunMap.set(r.eNcf, r);
      }
    }

    const runs = await this.runRepository.find({
      where: { tipoEcf: '32', esRfce: false },
      order: { executedAt: 'DESC' },
    });

    const uniqueByEncf = new Map<string, DgiiCertificationRun>();
    for (const run of runs) {
      if (run.signedXml && !uniqueByEncf.has(run.eNcf)) {
        uniqueByEncf.set(run.eNcf, run);
      }
    }

    let minorRuns = Array.from(uniqueByEncf.values()).filter(
      (run) => Number(run.montoTotal) < 250000,
    );

    // Restringir estrictamente a los 4 e-NCFs del lote RFCE más reciente
    if (latestRfceEncfSet.size > 0) {
      minorRuns = minorRuns.filter((run) => latestRfceEncfSet.has(run.eNcf));
    } else if (this.importedEcfMap.size > 0) {
      minorRuns = minorRuns.filter((run) => this.importedEcfMap.has(run.eNcf));
    }

    if (minorRuns.length > 0) {
      return minorRuns
        .map((run) => {
          const rfce = rfceRunMap.get(run.eNcf);
          const rawName = rfce?.nombreCaso || run.nombreCaso || '';
          const matchCaso = rawName.match(/^([0-9A-Z]+)\s*\(/i);
          const casoPrueba = matchCaso ? matchCaso[1] : `Caso ${run.eNcf}`;
          const setPruebas = casoPrueba.startsWith('131148697') ? 'Set Oficial DGII: 131148697' : 'Set de Pruebas Oficial DGII';

          return {
            eNcf: run.eNcf,
            filename: `${config.rncEmisor || ''}${run.eNcf}.xml`,
            signedXml: run.signedXml!,
            montoTotal: Number(run.montoTotal),
            securityCode: run.securityCode || '',
            executedAt: run.executedAt,
            casoPrueba,
            setPruebas,
            razonSocialComprador: run.razonSocialComprador || rfce?.razonSocialComprador || 'Consumidor Final',
          };
        })
        .sort((a, b) => a.eNcf.localeCompare(b.eNcf));
    }

    const fallbackList: Array<{
      eNcf: string;
      filename: string;
      signedXml: string;
      montoTotal: number;
      securityCode: string;
      executedAt: Date;
      casoPrueba?: string;
      razonSocialComprador?: string;
      setPruebas?: string;
    }> = [];

    for (const [encf, cached] of this.consumerMinorCache.entries()) {
      if (this.importedEcfMap.size > 0 && !this.importedEcfMap.has(encf)) {
        continue;
      }
      const extra = this.importedEcfMap.get(encf);
      fallbackList.push({
        eNcf: encf,
        filename: `${config.rncEmisor || ''}${encf}.xml`,
        signedXml: cached.signedXml,
        montoTotal: extra?.montoTotal ?? 0,
        securityCode: cached.securityCode,
        executedAt: new Date(),
        casoPrueba: extra?.casoPrueba || `Caso ${encf}`,
        setPruebas: 'Set Oficial DGII: 131148697',
        razonSocialComprador: extra?.razonSocialComprador || 'Consumidor Final',
      });
    }

    if (fallbackList.length === 0) {
      for (const [encf, row] of this.importedEcfMap.entries()) {
        const tipo = row.tipoeCF.replace(/^E/i, '').padStart(2, '0');
        if (tipo === '32' && row.montoTotal < 250000) {
          const generated = await this.getOrGenerateConsumerMinorSignedEcf(encf, row);
          fallbackList.push({
            eNcf: encf,
            filename: `${config.rncEmisor || ''}${encf}.xml`,
            signedXml: generated.signedXml,
            montoTotal: row.montoTotal,
            securityCode: generated.securityCode,
            executedAt: new Date(),
            casoPrueba: row.casoPrueba || `Caso ${encf}`,
            setPruebas: 'Set Oficial DGII: 131148697',
            razonSocialComprador: row.razonSocialComprador || 'Consumidor Final',
          });
        }
      }
    }

    // Fallback: 4 facturas de consumo menor de la batería de simulación oficial
    if (fallbackList.length === 0) {
      const simDataset = this.get25SimulationDataset(0);
      for (const item of simDataset.ecfConsumoMenor) {
        const normalized = this.normalizeENcf(item.eNCF);
        const generated = await this.getOrGenerateConsumerMinorSignedEcf(normalized, item.extraEcfData, item);
        fallbackList.push({
          eNcf: normalized,
          filename: `${config.rncEmisor || ''}${normalized}.xml`,
          signedXml: generated.signedXml,
          montoTotal: item.montoTotal,
          securityCode: generated.securityCode,
          executedAt: new Date(),
          casoPrueba: item.nombreCaso,
          setPruebas: 'Simulación Oficial DGII (Paso 4)',
          razonSocialComprador: item.razonSocialComprador || 'Consumidor Final',
        });
      }
    }

    return fallbackList.sort((a, b) => a.eNcf.localeCompare(b.eNcf));
  }

  /**
   * Ejecuta la batería masiva de casos de prueba
   */
  async runAllTestCases(cases?: TestCaseItem[]): Promise<{
    total: number;
    passed: number;
    failed: number;
    results: TestCaseItem[];
  }> {
    const rawList = cases && cases.length > 0 ? cases : this.getDefaultTestSetCases();
    // Ordenamiento estricto oficial DGII (Primero, Segundo, Tercero, Cuarto)
    const list = [...rawList].sort((a, b) => {
      const rankA = this.getDgiiExecutionRank(a);
      const rankB = this.getDgiiExecutionRank(b);
      if (rankA !== rankB) return rankA - rankB;
      return (a.casoNumero ?? 0) - (b.casoNumero ?? 0);
    });
    const results: TestCaseItem[] = [];
    let passed = 0;
    let failed = 0;

    let waitedForBaseSettlement = false;
    const batchConfig = await this.dgiiClient.getConfig();
    for (const item of list) {
      const esNota = item.tipoeCF === 'E33' || item.tipoeCF === 'E34';
      if (esNota && !waitedForBaseSettlement) {
        if (batchConfig.environment !== 'sandbox') {
          // Pausa preventiva para permitir que el motor asíncrono de la DGII procese y asiente los e-CF base
          this.logger.log('⏳ Pausando 15 segundos antes de emitir notas para que la DGII asiente los e-CF base...');
          await new Promise((resolve) => setTimeout(resolve, 15000));
        }
        waitedForBaseSettlement = true;
      }
      const executed = await this.runTestCase(item, 'RUN_ALL');
      results.push(executed);
      if (executed.status === 'ACCEPTED') {
        passed++;
      } else {
        failed++;
      }
    }

    return {
      total: list.length,
      passed,
      failed,
      results,
    };
  }

  /**
   * Ejecuta Aprobación Comercial individual (Paso 3 ACECF)
   */
  async runCommercialApproval(dto: {
    rncEmisorProveedor: string;
    eNcf: string;
    fechaEmisionEcf: Date | string;
    montoTotalEcf: number;
    estadoAprobacion: 1 | 2;
    comentario?: string;
    fechaAprobacion?: Date | string;
  }) {
    const config = await this.dgiiClient.getConfig();
    const acecfInput: AcecfGenerationInput = {
      rncEmisor: dto.rncEmisorProveedor,
      rncComprador: config.rncEmisor,
      eNcf: dto.eNcf,
      fechaEmisionEcf: dto.fechaEmisionEcf,
      montoTotalEcf: dto.montoTotalEcf,
      estadoAprobacion: dto.estadoAprobacion,
      comentario: dto.comentario,
      fechaAprobacion: dto.fechaAprobacion || new Date(),
    };

    const rawXml = this.xmlGenerator.generateAcecfXml(acecfInput);
    return this.dgiiClient.submitCommercialApproval(rawXml, dto.eNcf);
  }

  /**
   * Genera y firma digitalmente los XMLs de una lista de Aprobaciones Comerciales
   * para previsualización o descarga por parte del ISP.
   */
  async generateSignedAcecfList(cases: DgiiTestSetAcecfRow[]): Promise<Array<{
    id: string;
    eNcf: string;
    filename: string;
    rawXml: string;
    signedXml: string;
    montoTotal: number;
    rncEmisor: string;
    rncComprador: string;
  }>> {
    const config = await this.dgiiClient.getConfig();
    const list: Array<{
      id: string;
      eNcf: string;
      filename: string;
      rawXml: string;
      signedXml: string;
      montoTotal: number;
      rncEmisor: string;
      rncComprador: string;
    }> = [];

    for (const c of cases) {
      const acecfInput: AcecfGenerationInput = {
        rncEmisor: c.rncEmisor,
        rncComprador: config.rncEmisor,
        eNcf: c.eNcf,
        fechaEmisionEcf: c.fechaEmision,
        montoTotalEcf: c.montoTotal,
        estadoAprobacion: c.estado,
        comentario: c.detalleMotivoRechazo,
        fechaAprobacion: c.fechaHoraAprobacionComercial,
      };

      const rawXml = this.xmlGenerator.generateAcecfXml(acecfInput);
      const { signedXml } = this.signerService.signXml(rawXml, config.certPath, config.certPassword);
      const filename = `ACECF_${config.rncEmisor}_${c.eNcf}.xml`;

      list.push({
        id: c.id,
        eNcf: c.eNcf,
        filename,
        rawXml,
        signedXml,
        montoTotal: c.montoTotal,
        rncEmisor: c.rncEmisor,
        rncComprador: config.rncEmisor,
      });
    }

    return list;
  }

  /**
   * Ejecuta un caso de Aprobación Comercial (ACECF) y guarda el resultado
   * en `dgii_certification_runs` con runSource = 'ACECF'.
   */
  async runAcecfCase(item: DgiiTestSetAcecfRow): Promise<DgiiTestSetAcecfRow> {
    const config = await this.dgiiClient.getConfig();
    const acecfInput: AcecfGenerationInput = {
      rncEmisor: item.rncEmisor,
      rncComprador: config.rncEmisor,
      eNcf: item.eNcf,
      fechaEmisionEcf: item.fechaEmision,
      montoTotalEcf: item.montoTotal,
      estadoAprobacion: item.estado,
      comentario: item.detalleMotivoRechazo,
      fechaAprobacion: item.fechaHoraAprobacionComercial,
    };

    const rawXml = this.xmlGenerator.generateAcecfXml(acecfInput);
    const res = await this.dgiiClient.submitCommercialApproval(rawXml, item.eNcf);

    const isAccepted =
      res.estado === 'ACEPTADO' ||
      res.estado === '1' ||
      res.estado === '01' ||
      String(res.estado).toLowerCase().includes('aprob') ||
      String(res.estado).toLowerCase().includes('acept');

    const status: 'ACCEPTED' | 'REJECTED' | 'ERROR' = isAccepted
      ? 'ACCEPTED'
      : res.estado === 'ERROR'
        ? 'ERROR'
        : 'REJECTED';

    try {
      const run = this.runRepository.create({
        runSource: 'ACECF',
        casoNumero: item.casoNumero,
        nombreCaso: `Aprobación Comercial ${item.eNcf}`,
        tipoEcf: item.tipoeCF,
        esRfce: false,
        eNcf: item.eNcf,
        rncComprador: config.rncEmisor,
        montoTotal: item.montoTotal,
        status,
        trackId: res.trackId,
        responseMessage: res.mensaje,
      });
      await this.runRepository.save(run);
    } catch (saveErr: any) {
      this.logger.warn(`No se pudo persistir corrida de ACECF ${item.eNcf}: ${saveErr.message}`);
    }

    return {
      ...item,
      status,
      trackId: res.trackId,
      responseMessage: res.mensaje,
      signedXml: res.signedXml,
    };
  }

  /**
   * Ejecuta en lote todas las Aprobaciones Comerciales (11 casos DGII)
   * con delay de asentamiento entre llamadas para evitar bloqueos por tasa en DGII.
   */
  async runAllAcecfCases(cases: DgiiTestSetAcecfRow[]): Promise<{
    total: number;
    passed: number;
    failed: number;
    results: DgiiTestSetAcecfRow[];
    logs: string[];
  }> {
    if (!cases || cases.length === 0) {
      throw new BadRequestException('No se suministraron casos de Aprobación Comercial para ejecutar.');
    }

    const logs: string[] = [];
    const results: DgiiTestSetAcecfRow[] = [];
    let passed = 0;
    let failed = 0;

    const time = () => new Date().toLocaleTimeString('es-DO', { hour12: false });
    logs.push(`[${time()}] 🚀 INICIANDO TRANSMISIÓN DE ${cases.length} APROBACIONES COMERCIALES (PASO 3 DGII)`);

    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      logs.push(
        `[${time()}] [${i + 1}/${cases.length}] Procesando ${c.eNcf} (Proveedor: ${c.rncEmisor}, Monto: RD$ ${c.montoTotal.toLocaleString('es-DO')})...`,
      );

      try {
        const updated = await this.runAcecfCase(c);
        results.push(updated);

        if (updated.status === 'ACCEPTED') {
          passed++;
          logs.push(`[${time()}] ✅ ${c.eNcf} ACEPTADO por DGII | TrackId: ${updated.trackId || 'N/A'}`);
        } else {
          failed++;
          logs.push(`[${time()}] ⚠️ ${c.eNcf} ${updated.status}: ${updated.responseMessage || 'Sin detalle'}`);
        }
      } catch (err: any) {
        failed++;
        const failedItem: DgiiTestSetAcecfRow = {
          ...c,
          status: 'ERROR',
          responseMessage: err.message,
        };
        results.push(failedItem);
        logs.push(`[${time()}] ❌ Error en ${c.eNcf}: ${err.message}`);
      }

      // Delay de 3 segundos entre llamadas consecutivas para proteger tasa de peticiones DGII
      if (i < cases.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }

    logs.push(`[${time()}] 🏁 Proceso finalizado: ${passed}/${cases.length} Aprobaciones Comerciales aceptadas.`);
    return {
      total: cases.length,
      passed,
      failed,
      results,
      logs,
    };
  }

  /**
   * Ejecuta Anulación de Secuencias (ANECF)
   */
  async runSequenceVoiding(dto: {
    tipoComprobante: string;
    secuenciaDesde: string;
    secuenciaHasta: string;
    motivo?: string;
  }) {
    const config = await this.dgiiClient.getConfig();
    const anecfInput: AnecfGenerationInput = {
      rncEmisor: config.rncEmisor,
      tipoComprobante: dto.tipoComprobante,
      secuenciaDesde: dto.secuenciaDesde,
      secuenciaHasta: dto.secuenciaHasta,
      motivo: dto.motivo,
    };

    const rawXml = this.xmlGenerator.generateAnecfXml(anecfInput);
    return this.dgiiClient.submitSequenceVoiding(rawXml);
  }

  /**
   * Genera la Representación Impresa (PDF A4 o Rollo Térmico 80mm) de cualquier comprobante
   * del proceso de simulación o del historial de certificación oficial DGII.
   */
  async generateSimulationPdf(
    eNcf: string,
    format: 'a4' | '80mm' = 'a4',
    sequenceOffset: number = 0,
  ): Promise<Buffer> {
    if (!this.pdfGenerator) {
      throw new BadRequestException('El generador de PDF no se encuentra disponible.');
    }
    const normalizedEncf = this.normalizeENcf(eNcf);
    const tipoEcf = normalizedEncf.slice(0, 3).toUpperCase();

    // 1. Buscar en historial de ejecuciones guardadas.
    // Para un e-NCF tipo 32 (< RD$250,000) hay DOS filas con el mismo número: el
    // e-CF base (es_rfce = false, firmado localmente, el que se imprime y lleva el
    // QR) y el Resumen RFCE (es_rfce = true, el que se transmite a la DGII). La
    // corrida del Resumen se persiste DESPUÉS, así que ordenar solo por executedAt
    // DESC devolvía el Resumen y el PDF salía con el código de seguridad del
    // Resumen en vez del del comprobante (caso real E320000000166: "BOTRIs" en
    // lugar de "Pmc8Tk"). Por eso se prefiere explícitamente la fila del e-CF base.
    const runCandidates = await this.runRepository.find({
      where: { eNcf: normalizedEncf },
      order: { executedAt: 'DESC' },
    });
    const run = runCandidates.find((r) => !r.esRfce) || runCandidates[0] || null;

    // 2. Buscar en dataset de simulación (con offset dinámico)
    const dataset = this.get25SimulationDataset(sequenceOffset);
    const simCase = dataset.todosLosCasos.find((c) => this.normalizeENcf(c.eNCF) === normalizedEncf);

    // 3. Buscar en eCFs importados si existieran
    const imported = this.importedEcfMap.get(normalizedEncf);

    const config = await this.dgiiClient.getConfig();
    let companyInfo: CompanyPdfInfo;
    if (this.companyService) {
      try {
        const fiscal = await this.companyService.getCompanyFiscalInfo();
        const razonSocial = fiscal.razonSocial?.trim() || config.razonSocialEmisor?.trim() || 'SUMTECH TELECOM S.R.L.';
        const nombreComercial = fiscal.nombreComercial?.trim();
        companyInfo = {
          rnc: fiscal.rnc || config.rncEmisor || '131148697',
          razonSocial,
          nombreComercial: nombreComercial && nombreComercial !== razonSocial ? nombreComercial : undefined,
          direccion: fiscal.direccion || config.direccionEmisor || 'Av. 27 de Febrero #200, Santo Domingo',
          telefono: fiscal.telefono || config.telefonoEmisor || '809-555-0199',
          correo: fiscal.correo || config.correoEmisor || 'facturacion@sumtech.com.do',
        };
      } catch {
        const razonSocial = config.razonSocialEmisor?.trim() || 'SUMTECH TELECOM S.R.L.';
        const nombreComercial = config.nombreComercial?.trim();
        companyInfo = {
          rnc: config.rncEmisor || '131148697',
          razonSocial,
          nombreComercial: nombreComercial && nombreComercial !== razonSocial ? nombreComercial : undefined,
          direccion: config.direccionEmisor || 'Av. 27 de Febrero #200, Santo Domingo',
          telefono: config.telefonoEmisor || '809-555-0199',
          correo: config.correoEmisor || 'facturacion@sumtech.com.do',
        };
      }
    } else {
      const razonSocial = config.razonSocialEmisor?.trim() || 'SUMTECH TELECOM S.R.L.';
      const nombreComercial = config.nombreComercial?.trim();
      companyInfo = {
        rnc: config.rncEmisor || '131148697',
        razonSocial,
        nombreComercial: nombreComercial && nombreComercial !== razonSocial ? nombreComercial : undefined,
        direccion: config.direccionEmisor || 'Av. 27 de Febrero #200, Santo Domingo',
        telefono: config.telefonoEmisor || '809-555-0199',
        correo: config.correoEmisor || 'facturacion@sumtech.com.do',
      };
    }

    const montoTotal = run ? Number(run.montoTotal) : (simCase?.montoTotal ?? imported?.montoTotal ?? 1000);
    const securityCode = run?.securityCode || 'ZPbaRz';
    // `fechafirma` del QR debe ser el instante de la FIRMA, no el de escritura de la
    // corrida: `run.executedAt` es un @CreateDateColumn y se llena DESPUÉS del
    // round-trip con la DGII, por lo que quedaba desfasado (caso real
    // E330000000161: la DGII registró 22:26:44 y el QR imprimía 22:26:46). Se
    // prefiere `signedAt` y se cae a `executedAt` solo para las corridas
    // anteriores a la columna (o que nunca llegaron a firmar).
    const issuedAt = run?.signedAt || run?.executedAt || new Date();

    const isExempt = tipoEcf === 'E41' || tipoEcf === 'E43' || tipoEcf === 'E44' || tipoEcf === 'E47';
    const isTasaCero = tipoEcf === 'E46';
    const isTextoCorrige = tipoEcf === 'E34' && montoTotal === 0;

    let subtotal = montoTotal;
    let itbisTotal = 0;
    if (!isExempt && !isTasaCero && !isTextoCorrige && montoTotal > 0) {
      subtotal = Number((montoTotal / 1.18).toFixed(2));
      itbisTotal = Number((montoTotal - subtotal).toFixed(2));
    }

    const rncComprador = run?.rncComprador || simCase?.rncComprador || imported?.rncComprador;
    const razonSocialComprador = run?.razonSocialComprador || simCase?.razonSocialComprador || imported?.razonSocialComprador || 'Consumidor Final';

    const qrCodeUrl = this.dgiiClient.generateQrCodeUrl(
      config,
      normalizedEncf,
      montoTotal,
      securityCode,
      issuedAt,
      rncComprador,
    );

    const concept = simCase?.descripcion || (imported?.items && imported.items[0]?.nombreItem) || 'Servicio de Telecomunicaciones de Alta Velocidad';

    const metadata: InvoiceReceiptMetadata = {
      company: companyInfo,
      invoice: {
        id: run?.id || `sim-inv-${normalizedEncf}`,
        ncfNumber: normalizedEncf,
        ncfType: tipoEcf,
        dgiiStatus: run?.status || 'PENDING',
        securityCode,
        qrCodeUrl,
        issuedAt,
        contingencyMode: false,
        // Conforme a la normativa oficial DGII (Decreto 254-06, Norma General 06-2018):
        // - E31 (Factura de Crédito Fiscal): lleva fecha de vencimiento de secuencia de hasta 2 años
        //   calendario (vence el 31 de diciembre del año siguiente a su solicitud).
        // - E32 (Factura de Consumo): está EXENTA de fecha de vencimiento (no caduca por calendario).
        // - E33/E34: comprobantes modificativos sin vencimiento de secuencia propio.
        ncfExpiryDate: tipoEcf === 'E31' || tipoEcf === '31' ? (simCase?.fechaVencimientoSecuencia || '31-12-2028') : undefined,
        ncfModificado: run?.eNcfModificado || simCase?.eNCFModificado || imported?.eNCFModificado,
        razonModificacion: isTextoCorrige
          ? 'Corrección de texto descriptivo'
          : (tipoEcf === 'E34' ? 'Anula el NCF modificado' : 'Ajuste sobre comprobante previo'),
      },
      client: {
        name: razonSocialComprador,
        docNumber: rncComprador || '000000000',
        docType: rncComprador ? (rncComprador.length === 9 ? 'RNC' : 'Cédula') : 'Documento',
        email: 'cliente@sumtech.com.do',
      },
      sale: {
        id: `sale-${normalizedEncf}`,
        paymentMethod: 'Contado',
        billingPeriod: 'Simulación e-CF DGII',
        dueDate: '2026-10-31',
        subtotal,
        discountAmount: 0,
        itbisTotal,
        grandTotal: montoTotal,
        cashier: 'Caja Homologación DGII',
        details: [
          {
            concept,
            quantity: 1,
            unitPrice: subtotal,
            itbisAmount: itbisTotal,
            subtotal,
            unidadMedida: 'SERV',
          },
        ],
      },
    };

    if (format === '80mm') {
      return this.pdfGenerator.generateInvoiceThermalPdf(metadata);
    }
    return this.pdfGenerator.generateInvoiceA4Pdf(metadata);
  }

  /**
   * Obtiene la lista de todos los XMLs firmados de la batería de simulación (Paso 4)
   * para su inspección, descarga masiva o carga en el portal DGII.
   */
  async getSimulationSignedXmls(sequenceOffset: number = 0): Promise<Array<{
    eNcf: string;
    filename: string;
    signedXml: string;
    status: string;
    securityCode: string;
    tipoEcf: string;
    montoTotal: number;
    casoPrueba?: string;
  }>> {
    const dataset = this.get25SimulationDataset(sequenceOffset);
    const runs = await this.runRepository.find({
      order: { executedAt: 'DESC' },
    });
    const runMap = new Map<string, DgiiCertificationRun>();
    for (const r of runs) {
      if (r.signedXml && !runMap.has(r.eNcf)) {
        runMap.set(r.eNcf, r);
      }
    }

    const config = await this.dgiiClient.getConfig();
    const result: Array<{
      eNcf: string;
      filename: string;
      signedXml: string;
      status: string;
      securityCode: string;
      tipoEcf: string;
      montoTotal: number;
      casoPrueba?: string;
    }> = [];

    for (const item of dataset.todosLosCasos) {
      const normalizedEncf = this.normalizeENcf(item.eNCF);
      const run = runMap.get(normalizedEncf);
      if (run && run.signedXml) {
        result.push({
          eNcf: normalizedEncf,
          filename: `${config.rncEmisor}${normalizedEncf}.xml`,
          signedXml: run.signedXml,
          status: run.status,
          securityCode: run.securityCode || '',
          tipoEcf: item.tipoeCF,
          montoTotal: Number(run.montoTotal),
          casoPrueba: item.nombreCaso,
        });
      } else {
        const cached = this.consumerMinorCache.get(normalizedEncf);
        if (cached) {
          result.push({
            eNcf: normalizedEncf,
            filename: `${config.rncEmisor}${normalizedEncf}.xml`,
            signedXml: cached.signedXml,
            status: 'LOCAL_SIGNED',
            securityCode: cached.securityCode,
            tipoEcf: item.tipoeCF,
            montoTotal: item.montoTotal,
            casoPrueba: item.nombreCaso,
          });
        } else {
          // Generar y firmar al vuelo para que los 25 XMLs siempre estén disponibles
          try {
            if (item.tipoeCF === 'E32' && item.montoTotal < 250000) {
              const gen = await this.getOrGenerateConsumerMinorSignedEcf(normalizedEncf, item.extraEcfData, item);
              result.push({
                eNcf: normalizedEncf,
                filename: `${config.rncEmisor}${normalizedEncf}.xml`,
                signedXml: gen.signedXml,
                status: 'LOCAL_SIGNED',
                securityCode: gen.securityCode,
                tipoEcf: item.tipoeCF,
                montoTotal: item.montoTotal,
                casoPrueba: item.nombreCaso,
              });
            } else {
              const esNota = item.tipoeCF === 'E33' || item.tipoeCF === 'E34';
              const isTextoCorrige = item.tipoeCF === 'E34' && item.montoTotal === 0;
              const isExempt = item.tipoeCF === 'E44';
              const isTasaCero = item.tipoeCF === 'E46';

              let subtotal = item.montoTotal;
              let indicadorFacturacion: '1' | '2' | '3' | '4' = '1';
              if (isExempt) {
                indicadorFacturacion = '4';
              } else if (isTasaCero) {
                indicadorFacturacion = '3';
              } else if (!isTextoCorrige && item.montoTotal > 0) {
                subtotal = Number((item.montoTotal / 1.18).toFixed(2));
              }

              const precioUnitario = isTextoCorrige ? 0 : subtotal;
              const montoItem = isTextoCorrige ? 0 : subtotal;

              const input: EcfGenerationInput = {
                ncfType: item.tipoeCF,
                eNcf: normalizedEncf,
                rncComprador: item.rncComprador,
                razonSocialComprador: item.razonSocialComprador,
                correoComprador: 'cliente.simulacion@sumtech.com.do',
                direccionComprador: 'Av. Winston Churchill #100, Santo Domingo',
                tipoPago: '1',
                ncfModificado: esNota ? this.normalizeENcf(item.eNCFModificado || 'E310000000001') : undefined,
                codigoModificacion: isTextoCorrige ? '2' : '1',
                razonModificacion: isTextoCorrige ? 'Corrección de texto descriptivo' : 'Ajuste de facturación de pruebas',
                items: [
                  {
                    numeroLinea: 1,
                    nombreItem: item.descripcion,
                    indicadorBienoServicio: item.tipoeCF === 'E41' || item.tipoeCF === 'E43' ? '1' : '2',
                    indicadorFacturacion,
                    cantidad: 1,
                    precioUnitario,
                    montoItem,
                  },
                ],
              };

              const rawXml = this.xmlGenerator.generateEcfXml(input, config);
              const { securityCode, signedXml } = this.signerService.signXml(rawXml, config.certPath, config.certPassword || '');
              result.push({
                eNcf: normalizedEncf,
                filename: `${config.rncEmisor}${normalizedEncf}.xml`,
                signedXml,
                status: 'LOCAL_SIGNED',
                securityCode,
                tipoEcf: item.tipoeCF,
                montoTotal: item.montoTotal,
                casoPrueba: item.nombreCaso,
              });
            }
          } catch (signErr: any) {
            this.logger.warn(`No se pudo firmar XML de simulación para ${normalizedEncf}: ${signErr.message}`);
          }
        }
      }
    }

    return result;
  }
}
