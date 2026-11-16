import { Controller, Get, Post, Patch, Delete, Body, Query, Param, UseGuards } from '@nestjs/common';
import { GeographyService } from './geography.service';
import {
  FilterProvinceDto,
  FilterMunicipalityDto,
  FilterSectorDto,
  CreateSectorDto,
  UpdateSectorDto,
  CreateMunicipalityDto,
  UpdateMunicipalityDto,
} from './dto/geography.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

const READ_ROLES = [Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO, Role.AGENTE_CRM];
const WRITE_ROLES = [Role.ADMIN, Role.GERENTE];

@Controller('geography')
@UseGuards(AuthGuard, RolesGuard)
export class GeographyController {
  constructor(private readonly geographyService: GeographyService) {}

  @Get('countries')
  @Roles(...READ_ROLES)
  async getCountries(@Query('activeOnly') activeOnly?: string) {
    return this.geographyService.findAllCountries(activeOnly !== 'false');
  }

  @Get('countries/:id')
  @Roles(...READ_ROLES)
  async getCountryById(@Param('id') id: string) {
    return this.geographyService.findCountryById(id);
  }

  @Get('provinces')
  @Roles(...READ_ROLES)
  async getProvinces(@Query() filter: FilterProvinceDto) {
    return this.geographyService.findProvinces(filter);
  }

  @Get('municipalities')
  @Roles(...READ_ROLES)
  async getMunicipalities(@Query() filter: FilterMunicipalityDto) {
    return this.geographyService.findMunicipalities(filter);
  }

  @Post('municipalities')
  @Roles(...WRITE_ROLES)
  async createMunicipality(@Body() dto: CreateMunicipalityDto) {
    return this.geographyService.createMunicipality(dto);
  }

  @Patch('municipalities/:id')
  @Roles(...WRITE_ROLES)
  async updateMunicipality(@Param('id') id: string, @Body() dto: UpdateMunicipalityDto) {
    return this.geographyService.updateMunicipality(id, dto);
  }

  @Get('sectors')
  @Roles(...READ_ROLES)
  async getSectors(@Query() filter: FilterSectorDto) {
    return this.geographyService.findSectors(filter);
  }

  @Get('sectors/stats')
  @Roles(...READ_ROLES)
  async getSectorsWithStats(@Query() filter: FilterSectorDto) {
    return this.geographyService.findSectorsWithStats(filter);
  }

  @Post('sectors')
  @Roles(...WRITE_ROLES)
  async createSector(@Body() dto: CreateSectorDto) {
    return this.geographyService.createSector(dto);
  }

  @Patch('sectors/:id')
  @Roles(...WRITE_ROLES)
  async updateSector(@Param('id') id: string, @Body() dto: UpdateSectorDto) {
    return this.geographyService.updateSector(id, dto);
  }

  @Delete('sectors/:id')
  @Roles(...WRITE_ROLES)
  async deleteSector(@Param('id') id: string) {
    return this.geographyService.deleteSector(id);
  }
}
