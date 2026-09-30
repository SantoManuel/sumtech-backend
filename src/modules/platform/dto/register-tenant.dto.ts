import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

// El ValidationPipe global es whitelist:true/forbidNonWhitelisted:true (ver
// main.ts) — cualquier campo del body que NO esté declarado aquí se
// descarta/rechaza en silencio, así que cada campo que TenantProvisioningService
// necesita debe estar explícito en este DTO (gotcha ya documentado en memoria
// del proyecto).
export class RegisterTenantDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la empresa es requerido' })
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  rnc?: string;

  // Subdominio del tenant (ej. "ispazua" -> ispazua.app.sumtech.com). Solo
  // minúsculas, números y guiones, sin empezar/terminar en guion.
  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, {
    message: 'El identificador (slug) solo puede tener minúsculas, números y guiones',
  })
  slug: string;

  @IsEmail({}, { message: 'El correo del administrador no tiene un formato válido' })
  adminEmail: string;

  @IsNotEmpty({ message: 'La contraseña del administrador es requerida' })
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  adminPassword: string;

  @IsString()
  @IsNotEmpty({ message: 'El nombre del administrador es requerido' })
  @MaxLength(150)
  adminName: string;

  @IsOptional()
  @IsUUID()
  planId?: string;
}
