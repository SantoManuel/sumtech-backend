import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { InvoicingService } from '../../modules/invoicing/invoicing.service';
import { TenantContextService } from '../../common/tenancy/tenant-context.service';
import { TenantConnectionManagerService } from '../../common/tenancy/tenant-connection-manager.service';
import { TenantEntity } from '../../modules/platform/entities/tenant.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ClientEntity } from '../../modules/clients/entities/client.entity';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const invoicingService = app.get(InvoicingService);
  const tenantContext = app.get(TenantContextService);
  const connectionManager = app.get(TenantConnectionManagerService);

  const tenant = await connectionManager.resolveTenantBySlug('sumtech');
  if (!tenant) throw new Error('Tenant sumtech not found');

  const tenantDs = await connectionManager.getDataSourceForTenant(tenant);

  await tenantContext.run(
    {
      tenantId: tenant.id,
      slug: tenant.slug,
      dataSource: tenantDs,
    },
    async () => {
      const clientRepo = tenantDs.getRepository(ClientEntity);
      const client = await clientRepo.findOne({ where: { docType: 'RNC' } });
      console.log('Testing emitDirect with client:', client?.name, client?.docNumber);

      try {
        const res = await invoicingService.emitDirect({
          clientId: client!.id,
          ncfType: 'E31',
          concept: 'Enlace Dedicado de Fibra Óptica Empresarial 300 Mbps',
          subtotal: 10000,
          paymentMethod: 'TRANSFER',
          userId: '186753cf-6c0c-4c4d-baa4-9a92db5ffec7',
        });
        console.log('SUCCESS! Emitted invoice:', res.id, res.ncfNumber, res.status);
      } catch (err: any) {
        console.error('CAUGHT ERROR IN emitDirect:');
        console.error('Message:', err.message);
        console.error('Stack:', err.stack);
      }
    },
  );

  await app.close();
}

main().catch(console.error);
