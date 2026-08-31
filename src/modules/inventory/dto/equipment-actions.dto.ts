import { IsNotEmpty, IsUUID, IsString, IsOptional, IsEnum, MaxLength, MinLength, IsBoolean } from 'class-validator';
import { EquipmentCondition, EquipmentLocationType } from '../enums/equipment.enums';

export class AssignTechnicianDto {
  @IsNotEmpty()
  @IsUUID('4')
  employeeId: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

export class InstallAtClientDto {
  @IsNotEmpty()
  @IsUUID('4')
  contractId: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

export class UninstallDto {
  @IsNotEmpty()
  @IsUUID('4')
  employeeId: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  reason: string;

  @IsOptional()
  @IsEnum(EquipmentCondition)
  condition?: EquipmentCondition;
}

export class ReturnToWarehouseDto {
  @IsOptional()
  @IsUUID('4')
  warehouseId?: string;
}

export class TransferTechnicianDto {
  @IsNotEmpty()
  @IsUUID('4')
  toEmployeeId: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}

export class ReportDamageDto {
  @IsNotEmpty()
  @IsEnum(EquipmentCondition)
  condition: EquipmentCondition.DAMAGED | EquipmentCondition.DEFECTIVE;

  @IsNotEmpty()
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  reason: string;
}

export class SendToRepairDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  vendorName?: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  reason: string;
}

export class ReturnFromRepairDto {
  @IsNotEmpty()
  @IsBoolean()
  repaired: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;

  @IsOptional()
  @IsUUID('4')
  warehouseId?: string;
}

export class RetireEquipmentDto {
  @IsOptional()
  @IsBoolean()
  lost?: boolean;

  @IsNotEmpty()
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  reason: string;
}

export class AdjustEquipmentDto {
  @IsNotEmpty()
  @IsEnum(EquipmentLocationType)
  locationType: EquipmentLocationType;

  @IsNotEmpty()
  @IsEnum(EquipmentCondition)
  condition: EquipmentCondition;

  @IsOptional()
  @IsUUID('4')
  warehouseId?: string;

  @IsOptional()
  @IsUUID('4')
  employeeId?: string;

  @IsOptional()
  @IsUUID('4')
  clientId?: string;

  @IsOptional()
  @IsUUID('4')
  contractId?: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  reason: string;
}
