import { Body, Controller, Get, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ClientsImportService } from './import/clients-import.service';
import { SubmitLocationMappingDto } from './dto/submit-location-mapping.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

/**
 * Importación masiva de clientes desde el archivo legacy (Excel/CSV). Vive
 * en un controlador aparte (no en ClientsController) por tamaño, pero está
 * registrado ANTES que ClientsController en ClientsModule — necesario porque
 * 'GET /clients/import' colisionaría con 'GET /clients/:id' si Nest lo
 * resolviera en el orden contrario (mismo motivo que el comentario sobre
 * 'contracts'/'export' en clients.controller.ts).
 */
@Controller('clients/import')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.GERENTE)
export class ClientsImportController {
  constructor(private readonly clientsImportService: ClientsImportService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async analyze(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser('sub') userId: string) {
    return this.clientsImportService.analyze(file, userId);
  }

  @Get()
  async listBatches(@Query() pagination: PaginationDto) {
    return this.clientsImportService.listBatches(pagination);
  }

  @Get(':batchId')
  async getStatus(@Param('batchId') batchId: string) {
    return this.clientsImportService.getStatus(batchId);
  }

  @Get(':batchId/errors')
  async getErrors(@Param('batchId') batchId: string, @Query() pagination: PaginationDto) {
    return this.clientsImportService.getErrors(batchId, pagination);
  }

  @Get(':batchId/credentials-report')
  async getCredentialsReport(@Param('batchId') batchId: string, @Res() res: Response) {
    const { buffer, filename } = await this.clientsImportService.getCredentialsReport(batchId);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Patch(':batchId/location-mapping')
  async submitLocationMapping(@Param('batchId') batchId: string, @Body() dto: SubmitLocationMappingDto) {
    return this.clientsImportService.submitLocationMapping(batchId, dto);
  }

  @Post(':batchId/confirm')
  async confirm(@Param('batchId') batchId: string) {
    await this.clientsImportService.confirm(batchId);
    return { status: 'QUEUED' };
  }
}
