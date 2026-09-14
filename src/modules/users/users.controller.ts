import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ForbiddenException,
  UseGuards
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('users')
@UseGuards(AuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(Role.ADMIN, Role.GERENTE)
  async findAll(@Query() paginationDto: PaginationDto) {
    return this.usersService.findAll(paginationDto);
  }

  // Debe declararse antes de ':id' — de lo contrario Nest interpretaría
  // "roles" como el parámetro :id del handler findById (mismo cuidado que
  // clients/contracts y employees/directory).
  @Get('roles')
  @Roles(Role.ADMIN, Role.GERENTE)
  async findAllRoles(@Query('scope') scope?: string) {
    return this.usersService.findAllRoles(scope);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.GERENTE)
  async findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Patch(':id/password')
  async changePassword(
    @Param('id') id: string,
    @CurrentUser('sub') callerId: string,
    @CurrentUser('roles') callerRoles: string[],
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    if (id !== callerId && !callerRoles?.includes(Role.ADMIN)) {
      throw new ForbiddenException('Solo puedes cambiar tu propia contraseña, o ser administrador.');
    }
    return this.usersService.changePassword(id, changePasswordDto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async remove(@Param('id') id: string) {
    return this.usersService.softDelete(id);
  }
}
