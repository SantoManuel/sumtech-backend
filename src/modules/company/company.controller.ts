import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { CompanyService } from './company.service';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Role } from '../../common/enums/role.enum';
import { TenantContextService } from '../../common/tenancy/tenant-context.service';

const ALLOWED_LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
];
const MAX_LOGO_SIZE_BYTES = 3 * 1024 * 1024; // 3 MB

@Controller('company')
@UseGuards(AuthGuard, RolesGuard)
export class CompanyController {
  constructor(
    private readonly companyService: CompanyService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Perfil de esta empresa (una sola fila por DB de tenant desde la Fase 4
   * del plan multi-tenant — ya no hay picker de "varias empresas").
   */
  @Get('config')
  @Roles(Role.ADMIN, Role.GERENTE, Role.CAJERO, Role.TECNICO)
  async getConfig() {
    const profile = await this.companyService.getProfile();
    // `dgiiCertPassword` nunca sale al navegador en claro — ni cifrado ni en
    // texto plano, para que enmascarar la columna en la DB (workstream de
    // cifrado en reposo) también signifique algo del lado de la API. El
    // frontend solo necesita saber SI hay una contraseña guardada para decidir
    // qué placeholder mostrar en el input, no su valor.
    const { dgiiCertPassword, ...safeProfile } = profile as any;

    // `features` del plan SaaS contratado (platform DB, ya resuelto por
    // request en TenantResolutionMiddleware) — el frontend lo usa para
    // ocultar módulos no contratados en Sidebar/RouteGuard (SaasFeatureGuard
    // ya lo hace cumplir del lado del backend; esto es solo para no mostrar
    // en el menú algo que el backend rechazaría de todas formas).
    const features = this.tenantContext.hasContext() ? this.tenantContext.getPlanFeatures() : {};

    return { ...safeProfile, hasDgiiCertPassword: !!dgiiCertPassword, features };
  }

  @Put('config')
  @Roles(Role.ADMIN)
  async updateConfig(@Body() dto: UpdateCompanyProfileDto) {
    return this.companyService.update(dto);
  }

  /**
   * Carga del logotipo corporativo de este tenant — se valida tipo de imagen y peso,
   * guardándose en MinIO y asociándose reactivamente al perfil.
   */
  @Post('config/logo')
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async uploadLogo(@UploadedFile() file: Express.Multer.File) {
    if (!file || !file.buffer) {
      throw new BadRequestException('Debes adjuntar un archivo de imagen para el logotipo.');
    }

    if (!ALLOWED_LOGO_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Formato "${file.mimetype}" no soportado. Se admiten PNG, JPG, WebP o SVG.`,
      );
    }

    if (file.size > MAX_LOGO_SIZE_BYTES) {
      throw new BadRequestException('El logotipo no debe superar los 3 MB.');
    }

    return this.companyService.uploadCompanyLogo(file.buffer, file.originalname, file.mimetype);
  }

  /**
   * Eliminación del logotipo personalizado del tenant — restablece el isotipo base.
   */
  @Delete('config/logo')
  @Roles(Role.ADMIN)
  async deleteLogo() {
    return this.companyService.deleteCompanyLogo();
  }

  /**
   * Transmisión pública directa del logotipo del tenant actual —
   * para su consumo por navegadores, el Sidebar, PDFs y portales sin expiración de tokens.
   */
  @Get('logo')
  @Public()
  async getLogo(@Res() res: Response) {
    const logoData = await this.companyService.getCompanyLogo();
    if (!logoData) {
      throw new NotFoundException('Esta empresa no tiene un logotipo personalizado configurado.');
    }

    res.setHeader('Content-Type', logoData.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    return res.send(logoData.buffer);
  }

  /**
   * Certificado digital DGII (.p12/.pfx) de este tenant — se guarda en MinIO,
   * nunca en disco local del servidor (cada ISP tiene el suyo propio).
   */
  @Post('config/dgii-cert')
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async uploadDgiiCert(
    @UploadedFile() file: Express.Multer.File,
    @Body('certPassword') certPassword?: string,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('Debes adjuntar el archivo .p12/.pfx del certificado DGII.');
    }
    return certPassword
      ? this.companyService.uploadDgiiCertificate(file.buffer, file.originalname, certPassword)
      : this.companyService.uploadDgiiCertificate(file.buffer, file.originalname);
  }
}

