import { Injectable, Logger } from '@nestjs/common';
import { DgiiXmlGeneratorService, EcfGenerationInput, AcecfGenerationInput, AnecfGenerationInput } from './dgii-xml-generator.service';
import { DgiiClientService, DgiiSendResult } from './dgii-client.service';
import { DgiiSignerService } from './dgii-signer.service';

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
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'ERROR';
  trackId?: string;
  securityCode?: string;
  executedAt?: Date;
  logs: string[];
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

  constructor(
    private readonly xmlGenerator: DgiiXmlGeneratorService,
    private readonly dgiiClient: DgiiClientService,
    private readonly signerService: DgiiSignerService,
  ) {}

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
        eNCF: 'E3100000001',
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
        eNCF: 'E3200000001',
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
        eNCF: 'E3200000002',
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
        eNCF: 'E3300000001',
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
        eNCF: 'E3400000001',
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
        eNCF: 'E4100000001',
        rncComprador: '00100000001',
        razonSocialComprador: 'José Miguel Albañil y Soldador',
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
        eNCF: 'E4300000001',
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
        eNCF: 'E4400000001',
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
        eNCF: 'E4500000001',
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
        eNCF: 'E4600000001',
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
        eNCF: 'E4700000001',
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
        id: 'sim-10', casoNumero: 10, nombreCaso: 'Simulación 10 - Tipo 41 (Mantenimiento de Torres)',
        tipoeCF: 'E41', eNCF: `E41${pad(1)}`, rncComprador: '00100000001',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 02', montoTotal: 29500.0, itemsCount: 1,
        descripcion: 'Mantenimiento preventivo, pintura y sujeción de retenidas en torre', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-11', casoNumero: 11, nombreCaso: 'Simulación 11 - Tipo 41 (Tendido Aéreo Contratista)',
        tipoeCF: 'E41', eNCF: `E41${pad(2)}`, rncComprador: '00100000002',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 11', montoTotal: 21240.0, itemsCount: 1,
        descripcion: 'Tendido aéreo de cable troncal de fibra óptica 48 hilos', status: 'PENDING', logs: [],
      },
      // 2x E43 (Gastos Menores)
      {
        id: 'sim-12', casoNumero: 12, nombreCaso: 'Simulación 12 - Tipo 43 (Materiales de Ferretería)',
        tipoeCF: 'E43', eNCF: `E43${pad(1)}`,
        razonSocialComprador: 'Consumidor Final Gastos Menores', montoTotal: 4500.0, itemsCount: 1,
        descripcion: 'Materiales menores de anclaje, tornillos y precintos de seguridad', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-13', casoNumero: 13, nombreCaso: 'Simulación 13 - Tipo 43 (Combustible de Planta)',
        tipoeCF: 'E43', eNCF: `E43${pad(2)}`,
        razonSocialComprador: 'Consumidor Final Gastos Menores', montoTotal: 3200.0, itemsCount: 1,
        descripcion: 'Combustible diesel para generador de emergencia de cabecera', status: 'PENDING', logs: [],
      },
      // 2x E44 (Regímenes Especiales - Zona Franca ITBIS 0%)
      {
        id: 'sim-14', casoNumero: 14, nombreCaso: 'Simulación 14 - Tipo 44 (Zona Franca - Enlace 1 Gbps)',
        tipoeCF: 'E44', eNCF: `E44${pad(1)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 85000.0, itemsCount: 1,
        descripcion: 'Enlace Punto a Punto 1 Gbps Exonerado de ITBIS Ley 8-90', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-15', casoNumero: 15, nombreCaso: 'Simulación 15 - Tipo 44 (Zona Franca - Nube Privada)',
        tipoeCF: 'E44', eNCF: `E44${pad(2)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 75000.0, itemsCount: 1,
        descripcion: 'Servicio de Interconexión en Nube Privada Exonerado de ITBIS', status: 'PENDING', logs: [],
      },
      // 2x E45 (Gubernamental)
      {
        id: 'sim-16', casoNumero: 16, nombreCaso: 'Simulación 16 - Tipo 45 (Gubernamental - Ministerio)',
        tipoeCF: 'E45', eNCF: `E45${pad(1)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 141600.0, itemsCount: 1,
        descripcion: 'Servicio de Internet Simétrico y Telefonía IP para Ministerio', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-17', casoNumero: 17, nombreCaso: 'Simulación 17 - Tipo 45 (Gubernamental - Dirección)',
        tipoeCF: 'E45', eNCF: `E45${pad(2)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 112100.0, itemsCount: 1,
        descripcion: 'Conectividad Segura VPN MPLS para Oficinas Gubernamentales', status: 'PENDING', logs: [],
      },
      // 2x E46 (Exportación Tasa 0%)
      {
        id: 'sim-18', casoNumero: 18, nombreCaso: 'Simulación 18 - Tipo 46 (Exportación Tránsito IP)',
        tipoeCF: 'E46', eNCF: `E46${pad(1)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 150000.0, itemsCount: 1,
        descripcion: 'Exportación de Capacidad Internacional de Tránsito IP (Tasa 0%)', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-19', casoNumero: 19, nombreCaso: 'Simulación 19 - Tipo 46 (Exportación Peering)',
        tipoeCF: 'E46', eNCF: `E46${pad(2)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 135000.0, itemsCount: 1,
        descripcion: 'Servicio de Interconexión Internacional de Peering y DNS Anycast', status: 'PENDING', logs: [],
      },
      // 2x E47 (Pagos al Exterior - Extranjero)
      {
        id: 'sim-20', casoNumero: 20, nombreCaso: 'Simulación 20 - Tipo 47 (Pagos al Exterior - Cable Submarino)',
        tipoeCF: 'E47', eNCF: `E47${pad(1)}`,
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 80000.0, itemsCount: 1,
        descripcion: 'Pago por Capacidad de Cable Submarino Internacional Carrier Tier-1', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-21', casoNumero: 21, nombreCaso: 'Simulación 21 - Tipo 47 (Pagos al Exterior - Servidores Cloud)',
        tipoeCF: 'E47', eNCF: `E47${pad(2)}`,
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 65000.0, itemsCount: 1,
        descripcion: 'Servicios de Almacenamiento en Nube Global e Infraestructura Cloud', status: 'PENDING', logs: [],
      },
    ];

    // 2. 3 Notas de Débito y Crédito (Etapa 2)
    const ecfNotas: TestCaseItem[] = [
      {
        id: 'sim-07', casoNumero: 7, nombreCaso: 'Simulación 7 - Tipo 33 (Nota Débito por Ajuste)',
        tipoeCF: 'E33', eNCF: `E33${pad(1)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 5900.0, itemsCount: 1,
        descripcion: 'Ajuste de cargo por instalación técnica extraordinaria', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-08', casoNumero: 8, nombreCaso: 'Simulación 8 - Tipo 34 (Nota Crédito Anulación Total E44)',
        tipoeCF: 'E34', eNCF: `E34${pad(1)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 85000.0, itemsCount: 1,
        descripcion: 'Anulación total de factura por cancelación de orden comercial', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-09', casoNumero: 9, nombreCaso: 'Simulación 9 - Tipo 34 (Nota Crédito Corrección Texto)',
        tipoeCF: 'E34', eNCF: `E34${pad(2)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 0.0, itemsCount: 1,
        descripcion: 'Corrección de descripción de servicio en factura previa', status: 'PENDING', logs: [],
      },
    ];

    // 3. 4 Facturas de Consumo Menor < 250k (Etapa 3 para RFCE)
    const ecfConsumoMenor: TestCaseItem[] = [
      {
        id: 'sim-22', casoNumero: 22, nombreCaso: 'Simulación 22 - Tipo 32 < 250k (Plan Residencial 50M)',
        tipoeCF: 'E32', eNCF: `E32${pad(3)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 4130.0, itemsCount: 1,
        descripcion: 'Plan Fibra Residencial 50 Mbps + Router Wi-Fi', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-23', casoNumero: 23, nombreCaso: 'Simulación 23 - Tipo 32 < 250k (Plan Dúo 100M)',
        tipoeCF: 'E32', eNCF: `E32${pad(4)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 4956.0, itemsCount: 1,
        descripcion: 'Plan Dúo 100 Mbps Internet + Televisión HD', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-24', casoNumero: 24, nombreCaso: 'Simulación 24 - Tipo 32 < 250k (Control Remoto & Deco)',
        tipoeCF: 'E32', eNCF: `E32${pad(5)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 3304.0, itemsCount: 1,
        descripcion: 'Venta de Control Remoto Universal y Decodificador Adicional', status: 'PENDING', logs: [],
      },
      {
        id: 'sim-25', casoNumero: 25, nombreCaso: 'Simulación 25 - Tipo 32 < 250k (Cargo Reubicación)',
        tipoeCF: 'E32', eNCF: `E32${pad(6)}`, rncComprador: '131880681',
        razonSocialComprador: 'DOCUMENTOS ELECTRONICOS DE 03', montoTotal: 1770.0, itemsCount: 1,
        descripcion: 'Cargo por Reubicación de Acometida de Fibra Óptica', status: 'PENDING', logs: [],
      },
    ];

    return {
      ecfGenerales,
      ecfNotas,
      ecfConsumoMenor,
      todosLosCasos: [...ecfGenerales, ...ecfNotas, ...ecfConsumoMenor],
    };
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
      const res = await this.runTestCase(item);
      results.push(res);
      if (res.status === 'ACCEPTED') aceptadosEtapa1++;
      globalLogs.push(`[${now()}] [Etapa 1] ${item.eNCF} (${item.tipoeCF}) -> ${res.status} | TrackId: ${res.trackId || 'N/A'}`);
    }

    // ETAPA 2: 3 Notas de Débito y Crédito
    globalLogs.push(`\n[${now()}] --- ETAPA 2: Enviando Notas de Débito y Crédito (3 comprobantes) ---`);
    for (const item of dataset.ecfNotas) {
      // Vincular con eNCF correspondiente
      if (item.tipoeCF === 'E33') item.eNCF = item.eNCF; // referencia a E31
      const res = await this.runTestCase(item);
      results.push(res);
      if (res.status === 'ACCEPTED') aceptadosEtapa2++;
      globalLogs.push(`[${now()}] [Etapa 2] ${item.eNCF} (${item.tipoeCF}) -> ${res.status} | TrackId: ${res.trackId || 'N/A'}`);
    }

    // ETAPA 3: 4 Resúmenes RFCE
    globalLogs.push(`\n[${now()}] --- ETAPA 3: Enviando Resúmenes RFCE para Consumo Menor (4 comprobantes) ---`);
    for (const item of dataset.ecfConsumoMenor) {
      const res = await this.runTestCase(item);
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
   * Ejecuta un caso individual del Set de Pruebas DGII
   */
  async runTestCase(item: TestCaseItem): Promise<TestCaseItem> {
    const logs: string[] = [];
    const now = () => new Date().toLocaleTimeString('es-DO', { hour12: false });

    logs.push(`[${now()}] 🚀 Iniciando ejecución de Caso ${item.casoNumero}: ${item.nombreCaso} (${item.tipoeCF})`);

    try {
      const config = this.dgiiClient.getConfig();
      logs.push(`[${now()}] ⚙️ Entorno: ${config.environment.toUpperCase()} | Emisor: ${config.rncEmisor}`);

      // Caso especial: Nota de Crédito Informativa / Corrección de texto (MontoTotal = 0)
      const isTextoCorrige = item.tipoeCF === 'E34' && item.montoTotal === 0;

      const input: EcfGenerationInput = {
        ncfType: item.tipoeCF,
        eNcf: item.eNCF,
        rncComprador: item.rncComprador,
        razonSocialComprador: item.razonSocialComprador,
        correoComprador: 'cliente_simulacion@sumtech.com.do',
        direccionComprador: 'Av. Winston Churchill #100, Santo Domingo',
        tipoPago: '1',
        ncfModificado: (item.tipoeCF === 'E33' || item.tipoeCF === 'E34') ? 'E3100000001' : undefined,
        codigoModificacion: isTextoCorrige ? '2' : '1',
        razonModificacion: isTextoCorrige ? 'Corrección de texto descriptivo' : 'Ajuste de facturación de pruebas',
        items: [
          {
            numeroLinea: 1,
            nombreItem: item.descripcion,
            indicadorBienoServicio: item.tipoeCF === 'E41' || item.tipoeCF === 'E43' ? '1' : '2',
            indicadorFacturacion: isTextoCorrige ? '4' : item.tipoeCF === 'E44' || item.tipoeCF === 'E46' || item.tipoeCF === 'E47' ? '4' : '1',
            cantidad: 1,
            precioUnitario: isTextoCorrige ? 0 : item.tipoeCF === 'E44' ? item.montoTotal : item.montoTotal / 1.18,
            montoItem: isTextoCorrige ? 0 : item.tipoeCF === 'E44' ? item.montoTotal : item.montoTotal / 1.18,
          },
        ],
      };

      logs.push(`[${now()}] 📄 Construyendo documento XML e-CF estándar XSD v1.0...`);
      const rawXml = this.xmlGenerator.generateEcfXml(input, config);
      logs.push(`[${now()}] ✅ XML generado (${rawXml.length} bytes)`);

      logs.push(`[${now()}] 🔐 Aplicando firma digital XMLDSig RSA-SHA256 y C14N...`);
      const { securityCode } = this.signerService.signXml(rawXml, config.certPath, config.certPassword || '');
      logs.push(`[${now()}] 🔑 Código de Seguridad DGII extraído: [${securityCode}]`);

      logs.push(`[${now()}] 🌐 Transmitiendo comprobante a la DGII...`);
      const result: DgiiSendResult = await this.dgiiClient.submitEcf(
        rawXml,
        item.eNCF,
        item.montoTotal,
        item.rncComprador,
      );

      logs.push(`[${now()}] 📥 Respuesta DGII recibida: ${result.status} | TrackId: ${result.trackId}`);

      return {
        ...item,
        status: result.status === 'ACCEPTED' || result.status === 'CONTINGENCY' ? 'ACCEPTED' : 'REJECTED',
        trackId: result.trackId,
        securityCode: result.securityCode,
        executedAt: new Date(),
        logs,
      };
    } catch (error: any) {
      logs.push(`[${now()}] ❌ ERROR durante la ejecución: ${error.message}`);
      return {
        ...item,
        status: 'ERROR',
        executedAt: new Date(),
        logs,
      };
    }
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
    const list = cases && cases.length > 0 ? cases : this.getDefaultTestSetCases();
    const results: TestCaseItem[] = [];
    let passed = 0;
    let failed = 0;

    for (const item of list) {
      const executed = await this.runTestCase(item);
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
   * Ejecuta Aprobación Comercial (Paso 3 ACECF)
   */
  async runCommercialApproval(dto: {
    rncEmisorProveedor: string;
    eNcf: string;
    estadoAprobacion: 1 | 2;
    comentario?: string;
  }) {
    const config = this.dgiiClient.getConfig();
    const acecfInput: AcecfGenerationInput = {
      rncEmisor: dto.rncEmisorProveedor,
      rncComprador: config.rncEmisor,
      eNcf: dto.eNcf,
      estadoAprobacion: dto.estadoAprobacion,
      comentario: dto.comentario,
      fechaAprobacion: new Date(),
    };

    const rawXml = this.xmlGenerator.generateAcecfXml(acecfInput);
    return this.dgiiClient.submitCommercialApproval(rawXml, dto.eNcf);
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
    const config = this.dgiiClient.getConfig();
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
}
