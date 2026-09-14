import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { InvoicingService } from './src/modules/invoicing/invoicing.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const invoicingService = app.get(InvoicingService);
  try {
    const result = await invoicingService.createCreditNote(
      '01b7a285-5f21-4df6-97a3-f2210110f6a5',
      'Factura de prueba QA generada por error',
      'facb1701-2285-4a32-aff1-39f96279d067',
      ['ADMIN', 'GERENTE'],
    );
    console.log('EXITO:', JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error('ERROR MESSAGE:', err.message);
    console.error('ERROR STACK:', err.stack);
  }
  await app.close();
  process.exit(0);
}

main();
