import { Controller, Get, Post, Patch, Body, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { InvoicingService } from './invoicing.service';
import { EmitInvoiceDto } from './dto/emit-invoice.dto';
import { FindInvoicesDto } from './dto/find-invoices.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { DgiiClientService } from './dgii/dgii-client.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('invoicing')
@UseGuards(AuthGuard, RolesGuard)
export class InvoicingController {
  constructor(
    private readonly invoicingService: InvoicingService,
    private readonly dgiiClient: DgiiClientService,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async findAll(@Query() dto: FindInvoicesDto) {
    return this.invoicingService.findAll(dto);
  }

  @Post('emit')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async emitInvoice(@Body() emitInvoiceDto: EmitInvoiceDto) {
    return this.invoicingService.emitInvoice(emitInvoiceDto);
  }

  @Get('sale/:saleId')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async findBySaleId(@Param('saleId') saleId: string) {
    return this.invoicingService.findBySaleId(saleId);
  }

  @Get('sequences/available')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async getAvailableSequences() {
    return this.invoicingService.getAvailableSequences();
  }

  @Get('track/:trackId')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async queryTrackId(@Param('trackId') trackId: string) {
    return this.dgiiClient.queryTrackIdStatus(trackId);
  }

  @Patch(':id/void')
  @Roles(Role.ADMIN, Role.GERENTE)
  async voidInvoice(@Param('id') id: string) {
    return this.invoicingService.voidInvoice(id);
  }

  @Post(':id/credit-note')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async createCreditNote(
    @Param('id') id: string,
    @Body() dto: CreateCreditNoteDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('roles') roles: string[],
  ) {
    return this.invoicingService.createCreditNote(id, dto.razonModificacion, userId, roles);
  }

  @Get(':id/receipt')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async getReceiptMetadata(@Param('id') id: string) {
    return this.invoicingService.getReceiptMetadata(id);
  }

  @Get(':id/pdf')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async getInvoicePdf(@Param('id') id: string, @Res() res: Response) {
    const invoice = await this.invoicingService.findById(id);
    const pdfBuffer = await this.invoicingService.generateInvoicePdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Factura-${invoice.ncfNumber || id}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  @Get(':id/thermal-pdf')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async getInvoiceThermalPdf(@Param('id') id: string, @Res() res: Response) {
    const invoice = await this.invoicingService.findById(id);
    const pdfBuffer = await this.invoicingService.generateInvoiceThermalPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Ticket-80mm-${invoice.ncfNumber || id}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async findById(@Param('id') id: string) {
    return this.invoicingService.findById(id);
  }

  @Get('reports/607')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async getDGII607Report(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.invoicingService.getDGII607Report(startDate, endDate);
  }

  @Get('reports/sla')
  @Roles(Role.ADMIN, Role.GERENTE, Role.TECNICO)
  async getSlaReport(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    return this.invoicingService.getSlaReport(startDate, endDate);
  }

  @Get('reports/inventory')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO)
  async getInventoryValuationReport() {
    return this.invoicingService.getInventoryValuationReport();
  }

  @Get('reports/subscribers')
  @Roles(Role.ADMIN, Role.GERENTE, Role.AGENTE_CRM, Role.CAJERO)
  async getSubscribersReport() {
    return this.invoicingService.getSubscribersReport();
  }
}
