export type DgiiEnvironmentType = 'testecf' | 'certecf' | 'ecf' | 'sandbox';

export interface DgiiConfig {
  environment: DgiiEnvironmentType;
  baseUrl: string;
  baseUrlRfce: string;
  certPath: string;
  certPassword?: string;
  rncEmisor: string;
  razonSocialEmisor: string;
  nombreComercial?: string;
  direccionEmisor?: string;
  municipioEmisor?: string;
  provinciaEmisor?: string;
  correoEmisor?: string;
  telefonoEmisor?: string;
  webSite?: string;
}

export const DEFAULT_DGII_CONFIG: DgiiConfig = {
  environment: 'testecf',
  baseUrl: 'https://ecf.dgii.gov.do/testecf/',
  baseUrlRfce: 'https://fc.dgii.gov.do/testecf/',
  certPath: './certs/22817887_identity.p12',
  certPassword: 'hagmauhig1255',
  rncEmisor: '131000000',
  razonSocialEmisor: 'SUMTECH TELECOM S.R.L.',
  nombreComercial: 'SUMTECH FIBRA & TV',
  direccionEmisor: 'Av. 27 de Febrero esq. Winston Churchill, Santo Domingo, D.N.',
  municipioEmisor: '010100', // Distrito Nacional
  provinciaEmisor: '010000', // Santo Domingo
  correoEmisor: 'facturacion@sumtech.com.do',
  telefonoEmisor: '809-555-0199',
  webSite: 'https://sumtech.com.do',
};
