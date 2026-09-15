import { Controller, Get, Post, Patch, Body, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { FindContractsDto } from './dto/find-contracts.dto';
import { FilterClientDto } from './dto/filter-client.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ContractSignaturesService } from '../contract-signatures/contract-signatures.service';
import { CreateContractSignatureDto } from '../contract-signatures/dto/create-contract-signature.dto';

const SIGNATURE_ROLES = [Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.AGENTE_CRM, Role.TECNICO];

@Controller('clients')
@UseGuards(AuthGuard, RolesGuard)
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly contractSignaturesService: ContractSignaturesService,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO, Role.AGENTE_CRM)
  async findAll(@Query() filterDto: FilterClientDto) {
    return this.clientsService.findAll(filterDto, filterDto.search);
  }

  // Debe declararse antes de ':id' — de lo contrario Nest interpretaría
  // "contracts" como el parámetro :id del handler findById.
  @Get('contracts')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.AGENTE_CRM)
  async findAllContracts(@Query() dto: FindContractsDto) {
    return this.clientsService.findAllContracts(dto);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO, Role.AGENTE_CRM)
  async findById(@Param('id') id: string) {
    return this.clientsService.findById(id);
  }

  @Get('doc/:docNumber')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.AGENTE_CRM)
  async findByDoc(@Param('docNumber') docNumber: string) {
    return this.clientsService.findByDocNumber(docNumber);
  }

  @Post()
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.AGENTE_CRM)
  async create(@Body() createClientDto: CreateClientDto) {
    return this.clientsService.create(createClientDto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.AGENTE_CRM)
  async update(@Param('id') id: string, @Body() updateClientDto: UpdateClientDto) {
    return this.clientsService.update(id, updateClientDto);
  }

  @Post(':id/reset-password')
  @Roles(Role.ADMIN, Role.GERENTE)
  async resetDigitalPassword(@Param('id') id: string) {
    return this.clientsService.resetDigitalPassword(id);
  }

  @Patch(':id/access')
  @Roles(Role.ADMIN, Role.GERENTE)
  async setDigitalAccess(@Param('id') id: string, @Body('isActive') isActive: boolean) {
    return this.clientsService.setDigitalAccess(id, isActive);
  }

  @Post(':clientId/addresses/:addressId/gps-request')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.AGENTE_CRM)
  async requestGpsLocation(
    @Param('clientId') clientId: string,
    @Param('addressId') addressId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.clientsService.requestGpsLocation(clientId, addressId, userId);
  }

  @Get(':id/contracts')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO, Role.AGENTE_CRM)
  async getContracts(@Param('id') id: string) {
    return this.clientsService.findContractsByClientId(id);
  }

  @Post(':id/contracts')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO)
  async addContract(
    @Param('id') id: string,
    @Body('planId') planId: string,
    @Body('addressId') addressId: string,
    @Body('billingDay') billingDay?: number,
  ) {
    return this.clientsService.addContract(id, planId, addressId, billingDay);
  }

  @Patch(':clientId/contracts/:id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async updateContract(
    @Param('clientId') clientId: string,
    @Param('id') id: string,
    @Body() dto: UpdateContractDto,
  ) {
    return this.clientsService.updateContract(clientId, id, dto);
  }

  @Patch(':clientId/contracts/:id/suspend')
  @Roles(Role.ADMIN, Role.GERENTE)
  async suspendContract(@Param('clientId') clientId: string, @Param('id') id: string) {
    return this.clientsService.suspendContract(clientId, id);
  }

  @Patch(':clientId/contracts/:id/reactivate')
  @Roles(Role.ADMIN, Role.GERENTE)
  async reactivateContract(@Param('clientId') clientId: string, @Param('id') id: string) {
    return this.clientsService.reactivateContract(clientId, id);
  }

  @Patch(':clientId/contracts/:id/terminate')
  @Roles(Role.ADMIN, Role.GERENTE)
  async terminateContract(@Param('clientId') clientId: string, @Param('id') id: string) {
    return this.clientsService.terminateContract(clientId, id);
  }

  @Get(':clientId/contracts/:id/pdf')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.AGENTE_CRM)
  async getContractPdf(
    @Param('clientId') clientId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.clientsService.generateContractPdf(clientId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Contrato-${id}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    res.end(pdfBuffer);
  }

  @Get(':clientId/contracts/:id/signatures')
  @Roles(...SIGNATURE_ROLES)
  async getContractSignatures(@Param('clientId') clientId: string, @Param('id') id: string) {
    return this.contractSignaturesService.getStatus(clientId, id);
  }

  @Post(':clientId/contracts/:id/signatures')
  @Roles(...SIGNATURE_ROLES)
  async createContractSignature(
    @Param('clientId') clientId: string,
    @Param('id') id: string,
    @Body() dto: CreateContractSignatureDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser('employeeId') employeeId: string | undefined,
    @CurrentUser('roles') roles: string[],
    @Req() req: Request,
  ) {
    return this.contractSignaturesService.create(clientId, id, dto, {
      userId,
      employeeId,
      roles: roles || [],
      ipAddress: req.ip,
    });
  }

  @Get(':id/invoices')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.AGENTE_CRM, Role.TECNICO)
  async getInvoices(@Param('id') id: string, @Query('status') status?: string) {
    return this.clientsService.getClientInvoices(id, status);
  }
}
