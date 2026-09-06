import { IsOptional, IsString, IsUUID, IsEnum } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { EquipmentCondition, EquipmentLocationType } from '../enums/equipment.enums';
import { ArticleType } from '../enums/category.enums';

export class FilterProductDto extends PaginationDto {
  @IsOptional()
  @IsUUID('4')
  categoryId?: string;
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

  @IsOptional()
  @IsUUID('4')
  warehouseId?: string;

  @IsOptional()
  @IsEnum(ArticleType)
  articleType?: ArticleType;
}
