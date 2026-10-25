import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { SaasFeatureGuard } from '../../../common/guards/saas-feature.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RequireFeature } from '../../../common/decorators/require-feature.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { GenieAcsFirmwareService } from '../services/genieacs-firmware.service';
import { UploadFirmwareMetadataDto } from '../dto/firmware.dto';

const MAX_FIRMWARE_SIZE_BYTES = 128 * 1024 * 1024; // 128 MB -- generoso para firmware real de ONU/router

/**
 * Catálogo de firmware (§3.17 del plan) -- SOLO ADMIN en todas sus
 * operaciones (ni GERENTE ni TECNICO), por ser la sección de mayor riesgo de
 * toda la pestaña TR-069/GenieACS.
 */
@Controller('genieacs/firmware')
@UseGuards(AuthGuard, RolesGuard, SaasFeatureGuard)
@RequireFeature('GENIEACS')
export class GenieAcsFirmwareController {
  constructor(private readonly firmwareService: GenieAcsFirmwareService) {}

  @Get()
  @Roles(Role.ADMIN)
  async list(@Query('vendor') vendor?: string) {
    return this.firmwareService.listFirmware(vendor);
  }

  @Post()
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FIRMWARE_SIZE_BYTES } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFirmwareMetadataDto,
    @CurrentUser('sub') userId: string,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException('Debes adjuntar el archivo de firmware.');
    }
    return this.firmwareService.uploadFirmware(file.buffer, file.originalname, dto, userId);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async remove(@Param('id') id: string) {
    await this.firmwareService.deleteFirmware(id);
    return { success: true };
  }
}
