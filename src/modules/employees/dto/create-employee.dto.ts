import { IsNotEmpty, IsUUID, IsPositive, IsDateString, IsOptional, IsUrl, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateEmployeeDto {
  @IsNotEmpty()
  @IsUUID('4')
  userId: string;

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

