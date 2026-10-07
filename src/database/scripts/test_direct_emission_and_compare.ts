import { DataSource } from 'typeorm';
import { InvoiceEntity } from '../../modules/invoicing/entities/invoice.entity';
import { ClientEntity } from '../../modules/clients/entities/client.entity';
import { InvoicingService } from '../../modules/invoicing/invoicing.service';
import { PdfGeneratorService } from '../../modules/printing/pdf-generator.service';
import { DgiiCertificationService } from '../../modules/invoicing/dgii/dgii-certification.service';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'sumtech_db',
  entities: [path.resolve(__dirname, '../../**/*.entity{.ts,.js}')],
  synchronize: false,
});

async function run() {
  await dataSource.initialize();
  console.log('Database connected.');

  const clientRepo = dataSource.getRepository(ClientEntity);
  const invoiceRepo = dataSource.getRepository(InvoiceEntity);

  const clientRnc = await clientRepo.findOne({ where: { docType: 'RNC' } });
  console.log('Client RNC found:', clientRnc?.name, clientRnc?.docNumber);

  const clientCedula = await clientRepo.findOne({ where: { docType: 'CEDULA' } });
  console.log('Client Cedula found:', clientCedula?.name, clientCedula?.docNumber);

  // Check issued invoices in DB
  const issued = await invoiceRepo.find({
    where: { status: 'ISSUED' },
    order: { issuedAt: 'DESC' },
    take: 5,
  });

  console.log('Recent ISSUED invoices:');
  for (const inv of issued) {
    console.log(`- ID: ${inv.id}, NCF: ${inv.ncfNumber}, Type: ${inv.ncfType}, Total: ${inv.grandTotal}, SecurityCode: ${inv.securityCode}, QR: ${inv.qrCodeContent ? 'YES' : 'NO'}`);
  }

  await dataSource.destroy();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
