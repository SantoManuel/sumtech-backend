import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { AppDataSource } from '../../config/database.config';
import { InvoicingService } from '../../modules/invoicing/invoicing.service';

async function debug() {
  await AppDataSource.initialize();
  console.log('DB init');

  const { InvoiceEntity } = require('../../modules/invoicing/entities/invoice.entity');
  const { SaleEntity } = require('../../modules/pos/entities/sale.entity');
  const { ClientEntity } = require('../../modules/clients/entities/client.entity');

  const invRepo = AppDataSource.getRepository(InvoiceEntity);
  const saleRepo = AppDataSource.getRepository(SaleEntity);
  const clientRepo = AppDataSource.getRepository(ClientEntity);

  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../../app.module');
  const { DgiiClientService } = require('../../modules/invoicing/dgii/dgii-client.service');
  const { TenantContextService } = require('../../common/tenancy/tenant-context.service');
  const { TenantConnectionManagerService } = require('../../common/tenancy/tenant-connection-manager.service');
  const { DgiiXmlGeneratorService } = require('../../modules/invoicing/dgii/dgii-xml-generator.service');
  const { DgiiXsdValidatorService } = require('../../modules/invoicing/dgii/dgii-xsd-validator.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const dgiiClient = app.get(DgiiClientService);
  const tenantContext = app.get(TenantContextService);
  const connMgr = app.get(TenantConnectionManagerService);
  const xmlGen = app.get(DgiiXmlGeneratorService);
  const validator = app.get(DgiiXsdValidatorService);

  const tenant = await connMgr.resolveTenantBySlug('sumtech');
  const tenantDs = await connMgr.getDataSourceForTenant(tenant);

  await tenantContext.run({ tenantId: tenant.id, slug: tenant.slug, dataSource: tenantDs }, async () => {
    const config = await dgiiClient.getConfig();
    console.log('Resolved config:', {
      rncEmisor: config.rncEmisor,
      environment: config.environment,
      certPath: config.certPath,
      hasPassword: !!config.certPassword,
    });

    const rfceRawXml = xmlGen.generateRfceXml(
      'E320000000002',
      config.rncEmisor,
      822.46,
      125.46,
      'XNkgdI',
      {
        razonSocialEmisor: config.razonSocialEmisor,
        fechaEmision: xmlGen.formatDateDgii(new Date()),
        rncComprador: '40212637678',
        razonSocialComprador: 'Test_123',
        montoGravadoTotal: 697.00,
        montoGravadoI1: 697.00,
        totalItbis1: 125.46,
      },
    );

    console.log('Calling submitRfce...');
    const result = await dgiiClient.submitRfce(rfceRawXml, 'E320000000002', 822.46);
    console.log('Result:', result);
  });

  await app.close();
  await AppDataSource.destroy();
}

debug().catch(console.error);

