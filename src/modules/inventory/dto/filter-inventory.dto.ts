import { IsOptional, IsString, IsUUID, IsEnum } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { EquipmentCondition, EquipmentLocationType } from '../enums/equipment.enums';

export class FilterProductDto extends PaginationDto {
  @IsOptional()
  @IsString()
  category?: string;
}

export class FilterSerialDto extends PaginationDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsEnum(EquipmentLocationType)
  locationType?: EquipmentLocationType;

  @IsOptional()
  @IsEnum(EquipmentCondition)
  condition?: EquipmentCondition;

  @IsOptional()
  @IsUUID('4')
  employeeId?: string;

  @IsOptional()
  @IsUUID('4')
  clientId?: string;
}
