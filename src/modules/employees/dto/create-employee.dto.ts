import { IsNotEmpty, IsUUID, IsPositive, IsDateString, IsOptional, IsUrl, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { CreateUserDto } from '../../users/dto/create-user.dto';

export class CreateEmployeeDto {
  // A lo sumo uno de estos dos — nunca ambos. Ninguno de los dos significa
  // "colaborador sin acceso al sistema" (ej. conserjería).
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateUserDto)
  newUser?: CreateUserDto;

  @IsNotEmpty()
  cedula: string;

  @IsOptional()
  rnc?: string;

  @IsNotEmpty()
  jobTitle: string;

  @IsPositive()
  salary: number;

  @IsDateString()
  hireDate: string;

  @IsOptional()
  @IsUrl()
  photoUrl?: string;
}

export class FilterEmployeeDto extends PaginationDto {
  @IsOptional()
  @IsString()
  role?: string;
}

