import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
// libxmljs2 no publica tipos oficiales; se usa como módulo dinámico.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const libxmljs = require('libxmljs2');

export interface XsdValidationResult {
  valid: boolean;
  errors: string[];
}

const SCHEMAS_DIR = path.join(__dirname, 'schemas');

/**
 * Valida los documentos e-CF/ACECF/ANECF/ARECF/RFCE contra los esquemas XSD
 * que la propia DGII publica (copiados sin modificar a `./schemas`, ver
 * Documentacion_Tecnica_(XSD) del proveedor de referencia). Nada se envía a
 * la DGII sin pasar por aquí primero — hoy nada en el backend valida forma
 * antes de firmar/transmitir.
 *
 * IMPORTANTE — el orden de firma vs. validación es específico por tipo de
 * documento, no un patrón único:
 *  - e-CF: el XSD exige la firma al final (`xs:any minOccurs="1"` tras
 *    `FechaHoraFirma`, ver ecf-31.xsd:427) — hay que FIRMAR primero y validar
 *    el XML YA FIRMADO, o la validación siempre falla por faltar ese nodo.
 *  - ACECF: la firma es opcional en el XSD (`xs:any minOccurs="0"`,
 *    acecf.xsd:21) — se valida el contenido SIN firmar primero (más fácil de
 *    depurar) y se firma después, ya validado.
 */
@Injectable()
export class DgiiXsdValidatorService {
  private readonly logger = new Logger(DgiiXsdValidatorService.name);
  private readonly schemaCache = new Map<string, any>();

  private readonly ECF_SCHEMA_BY_TIPO: Record<string, string> = {
    '31': 'ecf-31.xsd',
    '32': 'ecf-32.xsd',
    '33': 'ecf-33.xsd',
    '34': 'ecf-34.xsd',
    '41': 'ecf-41.xsd',
    '43': 'ecf-43.xsd',
    '44': 'ecf-44.xsd',
    '45': 'ecf-45.xsd',
    '46': 'ecf-46.xsd',
    '47': 'ecf-47.xsd',
  };

  private loadSchema(fileName: string): any {
    let schema = this.schemaCache.get(fileName);
    if (schema) return schema;

    const fullPath = path.join(SCHEMAS_DIR, fileName);
    const xsdContent = fs.readFileSync(fullPath, 'utf8');
    schema = libxmljs.parseXml(xsdContent);
    this.schemaCache.set(fileName, schema);
    return schema;
  }

  private validateAgainst(xml: string, schemaFile: string): XsdValidationResult {
    try {
      const schema = this.loadSchema(schemaFile);
      const doc = libxmljs.parseXml(xml);
      const valid = doc.validate(schema);
      if (!valid) {
        const errors = (doc.validationErrors || []).map((e: any) => String(e.message).trim());
        this.logger.warn(`Validación XSD fallida contra ${schemaFile}: ${errors.join(' | ')}`);
        return { valid: false, errors };
      }
      return { valid: true, errors: [] };
    } catch (err: any) {
      this.logger.error(`Error validando XML contra ${schemaFile}: ${err.message}`);
      return { valid: false, errors: [err.message] };
    }
  }

  /** Valida un e-CF ya firmado (ver nota de orden en la clase). `tipoDoc` es el código numérico ('31'..'47'). */
  validateEcf(signedXml: string, tipoDoc: string): XsdValidationResult {
    const schemaFile = this.ECF_SCHEMA_BY_TIPO[tipoDoc];
    if (!schemaFile) {
      return { valid: false, errors: [`No hay esquema XSD registrado para TipoeCF '${tipoDoc}'.`] };
    }
    return this.validateAgainst(signedXml, schemaFile);
  }

  /** Valida una ACECF SIN firmar (ver nota de orden en la clase). */
  validateAcecf(unsignedXml: string): XsdValidationResult {
    return this.validateAgainst(unsignedXml, 'acecf.xsd');
  }

  validateAnecf(unsignedXml: string): XsdValidationResult {
    return this.validateAgainst(unsignedXml, 'anecf.xsd');
  }

  validateArecf(xml: string): XsdValidationResult {
    return this.validateAgainst(xml, 'arecf.xsd');
  }

  validateRfce(signedXml: string): XsdValidationResult {
    return this.validateAgainst(signedXml, 'rfce-32.xsd');
  }
}
