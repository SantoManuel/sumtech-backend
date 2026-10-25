import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { SaasFeatureGuard } from '../../../common/guards/saas-feature.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequireFeature } from '../../../common/decorators/require-feature.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { GenieAcsVendorParameterService } from '../services/genieacs-vendor-parameter.service';
import { CreateCpeVendorParameterDto } from '../dto/vendor-parameter.dto';

/**
 * Administración del catálogo de parámetros TR-069 de fabricante (ver
 * migración 096 y GenieAcsVendorParameterService) -- SOLO ADMIN, porque cada
 * fila acá es una afirmación de "esto se confirmó en vivo contra un equipo
 * real", no una config de UI cualquiera.
 */
@Controller('genieacs/vendor-parameters')
@UseGuards(AuthGuard, RolesGuard, SaasFeatureGuard)
@RequireFeature('GENIEACS')
export class GenieAcsVendorParametersController {
  constructor(private readonly vendorParameterService: GenieAcsVendorParameterService) {}

  @Get()
  @Roles(Role.ADMIN)
  async list(@Query('vendor') vendor?: string) {
    return this.vendorParameterService.listCatalog(vendor);
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(@Body() dto: CreateCpeVendorParameterDto, @CurrentUser('sub') userId: string) {
    return this.vendorParameterService.createCatalogEntry(dto, userId);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async remove(@Param('id') id: string) {
    await this.vendorParameterService.deleteCatalogEntry(id);
    return { success: true };
  }
}
