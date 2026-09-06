import { IsNotEmpty, IsString, IsOptional, IsEnum, IsBoolean, MaxLength } from 'class-validator';
import { ArticleType } from '../enums/category.enums';

export class CreateCategoryDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  code: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNotEmpty()
  @IsEnum(ArticleType)
  articleType: ArticleType;

  @IsOptional()
  @IsBoolean()
  defaultRequiresSerial?: boolean;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(ArticleType)
  articleType?: ArticleType;

  @IsOptional()
  @IsBoolean()
  defaultRequiresSerial?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
