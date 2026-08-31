import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { InvoicingService } from './invoicing.service';
import { EmitInvoiceDto } from './dto/emit-invoice.dto';
import { DgiiClientService } from './dgii/dgii-client.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('invoicing')
@UseGuards(AuthGuard, RolesGuard)
export class InvoicingController {
  constructor(
    private readonly invoicingService: InvoicingService,
    private readonly dgiiClient: DgiiClientService,
  ) {}

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

  @Get(':id/receipt')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async getReceiptMetadata(@Param('id') id: string) {
    return this.invoicingService.getReceiptMetadata(id);
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
