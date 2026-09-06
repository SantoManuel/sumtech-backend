import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { GeographyService } from './geography.service';
import { FilterProvinceDto, FilterMunicipalityDto, FilterSectorDto } from './dto/geography.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

const READ_ROLES = [Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO];

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

  @Get('sectors')
  @Roles(...READ_ROLES)
  async getSectors(@Query() filter: FilterSectorDto) {
    return this.geographyService.findSectors(filter);
  }
}
