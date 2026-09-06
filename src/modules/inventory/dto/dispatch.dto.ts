import { IsNotEmpty, IsUUID, IsOptional, IsString, IsEnum, IsNumber, IsPositive, IsBoolean, MaxLength, MinLength } from 'class-validator';
import { DispatchLineType } from '../enums/dispatch.enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateDispatchDto {
  @IsNotEmpty()
  @IsUUID('4')
  warehouseId: string;

  @IsNotEmpty()
  @IsUUID('4')
  technicianId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AddDispatchLineDto {
  @IsNotEmpty()
  @IsEnum(DispatchLineType)
  lineType: DispatchLineType;

  @IsOptional()
  @IsUUID('4')
  equipmentItemId?: string;

  @IsOptional()
  @IsUUID('4')
  productId?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  quantity?: number;
}

export class FilterDispatchDto extends PaginationDto {
  @IsOptional()
  @IsUUID('4')
  technicianId?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class RespondDispatchDto {
  @IsNotEmpty()
  @IsBoolean()
  accept: boolean;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  rejectionReason?: string;
}
