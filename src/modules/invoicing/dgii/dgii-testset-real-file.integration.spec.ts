import * as fs from 'fs';
import * as path from 'path';
import { DgiiTestSetImportService } from './dgii-testset-import.service';
import { DgiiXmlGeneratorService, ecfTipoDoc } from './dgii-xml-generator.service';
import { DgiiXsdValidatorService } from './dgii-xsd-validator.service';
import { DgiiSignerService } from './dgii-signer.service';
import { DgiiCertificationService } from './dgii-certification.service';

const TEST_CERT_PATH = './certs/22817887_identity.p12';
const TEST_CERT_PASSWORD = 'hagmauhig1255';

describe('DGII Real Excel Test Set Integration Test', () => {
  const filePath = path.resolve(
    __dirname,
    '../../../../../Documetos certificacion electronica dgii/Set_Pruebas_que_proporciona_dgii/131148697-02102026144959.xlsx',
  );

  let importService: DgiiTestSetImportService;
  let xmlGenerator: DgiiXmlGeneratorService;
  let signerService: DgiiSignerService;
  let xsdValidator: DgiiXsdValidatorService;
  let certService: DgiiCertificationService;

  beforeAll(() => {
    importService = new DgiiTestSetImportService();
    xmlGenerator = new DgiiXmlGeneratorService();
    signerService = new DgiiSignerService();
    xsdValidator = new DgiiXsdValidatorService();
    certService = new DgiiCertificationService(
      xmlGenerator,
      {} as any,
      signerService,
      {} as any,
    );
  });

  it('debe parsear las 25 filas de e-CF y 4 RFCE sin errores y extraer datos dinámicos', async () => {
    if (!fs.existsSync(filePath)) {
      console.warn('Archivo oficial no encontrado en ruta local, omitiendo prueba');
      return;
    }

    const buffer = fs.readFileSync(filePath);
    const imported = await importService.parseWorkbook(buffer);

    expect(imported.ecfRows.length).toBe(25);
    expect(imported.rfceRows.length).toBe(4);

    // Verificar que los datos del emisor y comprador se extrajeron dinámicamente del Excel
    const firstRow = imported.ecfRows[0];
    expect(firstRow.razonSocialEmisor).toBe('DOCUMENTOS ELECTRONICOS DE 02');
    expect(firstRow.fechaEmision).toBeDefined();
    expect(firstRow.items).toBeDefined();
    expect(firstRow.items!.length).toBeGreaterThan(0);

    const testCases = certService.buildTestCasesFromImport(imported);
    // 25 comprobantes e-CF individuales + 4 RFCE = 29 casos en total
    expect(testCases.length).toBe(29);

    // Validar orden oficial de 4 etapas DGII:
    // Primero (1..18): Facturas base (31, 32>=250k, 41, 43, 44, 45, 46, 47)
    for (let i = 0; i < 18; i++) {
      const tc = testCases[i];
      expect(tc.esRfce).toBeFalsy();
      expect(['E31', 'E32', 'E41', 'E43', 'E44', 'E45', 'E46', 'E47']).toContain(tc.tipoeCF);
      if (tc.tipoeCF === 'E32') {
        expect(tc.montoTotal).toBeGreaterThanOrEqual(250000);
      }
    }

    // Segundo (19..21): Notas modificatorias (33, 34)
    expect(testCases[18].tipoeCF).toBe('E33');
    expect(testCases[19].tipoeCF).toBe('E34');
    expect(testCases[20].tipoeCF).toBe('E34');

    // Tercero (22..25): Resúmenes RFCE
    for (let i = 21; i < 25; i++) {
      expect(testCases[i].esRfce).toBe(true);
    }

    // Cuarto (26..29): Facturas de consumo < 250k individuales
    for (let i = 25; i < 29; i++) {
      expect(testCases[i].esRfce).toBeFalsy();
      expect(testCases[i].tipoeCF).toBe('E32');
      expect(testCases[i].montoTotal).toBeLessThan(250000);
    }

    // Probar generación y validación XSD de los 25 e-CF individuales
    const ecfCases = testCases.filter((tc) => !tc.esRfce);
    let successCount = 0;
    const errors: string[] = [];

    for (const item of ecfCases) {
      const extra = item.extraEcfData!;
      const tipoDoc = ecfTipoDoc(item.tipoeCF);
      const esNota = item.tipoeCF === 'E33' || item.tipoeCF === 'E34';
      const isTextoCorrige = item.tipoeCF === 'E34' && item.montoTotal === 0;

      const items = extra.items && extra.items.length > 0
        ? extra.items.map((it) => ({
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
          }))
        : [
            {
              numeroLinea: 1,
              nombreItem: item.descripcion,
              indicadorBienoServicio: (item.tipoeCF === 'E41' || item.tipoeCF === 'E43' ? '1' : '2') as '1' | '2',
              indicadorFacturacion: '1' as any,
              cantidad: 1,
              precioUnitario: item.montoTotal,
              montoItem: item.montoTotal,
            },
          ];

      const input = {
        ncfType: item.tipoeCF,
        eNcf: item.eNCF,
        rncComprador: extra.rncComprador || item.rncComprador,
        razonSocialComprador: extra.razonSocialComprador || item.razonSocialComprador,
        correoComprador: extra.correoComprador,
        direccionComprador: extra.direccionComprador,
        informacionesAdicionales: extra.informacionesAdicionales,
        tipoPago: extra.tipoPago,
        terminoPago: extra.terminoPago,
        numeroReferencia: extra.numeroReferencia,
        tipoIngresos: extra.tipoIngresos,
        indicadorMontoGravado: extra.indicadorMontoGravado,
        fechaVencimientoSecuencia: extra.fechaVencimientoSecuencia,
        indicadorNotaCredito:
          extra.indicadorNotaCredito !== undefined && extra.indicadorNotaCredito !== ''
            ? (String(extra.indicadorNotaCredito) as any)
            : (esNota ? '1' : undefined),
        ncfModificado: esNota ? (extra.eNCFModificado || item.eNCFModificado) : undefined,
        fechaNcfModificado: extra.fechaNCFModificado,
        codigoModificacion:
          extra.codigoModificacion !== undefined && extra.codigoModificacion !== ''
            ? (String(extra.codigoModificacion) as any)
            : (isTextoCorrige ? '2' : '1'),
        razonModificacion: extra.razonModificacion !== undefined ? extra.razonModificacion : 'Ajuste de prueba',
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

      const rawXml = xmlGenerator.generateEcfXml(input);
      const { signedXml } = signerService.signXml(rawXml, TEST_CERT_PATH, TEST_CERT_PASSWORD);
      const validation = xsdValidator.validateEcf(signedXml, tipoDoc);
      if (validation.valid) {
        successCount++;
      } else {
        errors.push(`Error en eNCF ${item.eNCF} (tipo ${tipoDoc}): ${validation.errors.join('; ')}`);
      }

      // Verificaciones específicas de campos de auditoría DGII
      if (item.eNCF === 'E330000000001' || item.eNCF === 'E340000000001' || item.eNCF === 'E310000000001') {
        expect(rawXml).toContain('<NumeroContenedor>8019289</NumeroContenedor>');
      }
      if (item.eNCF === 'E450000000007') {
        expect(rawXml).toContain('<NumeroContenedor>1025536</NumeroContenedor>');
        expect(rawXml).toContain('<FechaEmbarque>08-06-2020</FechaEmbarque>');
        expect(rawXml).toContain('<NumeroEmbarque>1550523</NumeroEmbarque>');
        expect(rawXml).toContain('<PesoBruto>25.00</PesoBruto>');
        expect(rawXml).toContain('<TablaSubcantidad>');
        expect(rawXml).toContain('<Subcantidad>0.355</Subcantidad>');
        expect(rawXml).toContain('<CodigoSubcantidad>24</CodigoSubcantidad>');
      }
      if (item.eNCF === 'E310000000004') {
        expect(rawXml).toContain('<DescuentosORecargos>');
        expect(rawXml).toContain('<MontoDescuentooRecargo>200.00</MontoDescuentooRecargo>');
        expect(rawXml).toContain('<MontoDescuentooRecargo>50.00</MontoDescuentooRecargo>');
      }
    }

    if (errors.length > 0) {
      console.error('Errores XSD encontrados:', errors);
    }

    expect(errors).toEqual([]);
    expect(successCount).toBe(25);
  });
});
