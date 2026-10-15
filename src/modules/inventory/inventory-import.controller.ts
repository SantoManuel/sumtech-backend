import { Body, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsImportService } from './import/products-import.service';
import { SerialsImportService } from './import/serials-import.service';
import { ConfirmProductsImportDto } from './import/dto/confirm-products-import.dto';
import { ConfirmSerialsImportDto } from './import/dto/confirm-serials-import.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

const UPLOAD_LIMITS = { limits: { fileSize: 20 * 1024 * 1024 } };

/**
 * Importación masiva inteligente de inventario, en dos flujos independientes:
 * - /products: altas de catálogo (productos/SKU nuevos).
 * - /serials: recepción masiva de unidades serializadas (ej. un lote de ONUs).
 * Ambos son SÍNCRONOS (analyze -> confirm en el mismo ciclo request/response,
 * sin batch persistido ni cola en background) — a diferencia de la importación
 * de Clientes, el volumen esperado aquí es de decenas/cientos de filas, no
 * decenas de miles, así que no se justifica la infraestructura de BullMQ.
 */
@Controller('inventory/import')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.GERENTE)
export class InventoryImportController {
  constructor(
    private readonly productsImportService: ProductsImportService,
    private readonly serialsImportService: SerialsImportService,
  ) {}

  @Post('products/analyze')
  @UseInterceptors(FileInterceptor('file', UPLOAD_LIMITS))
  async analyzeProducts(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.productsImportService.analyze(file);
  }

  @Post('products/confirm')
  async confirmProducts(@Body() dto: ConfirmProductsImportDto) {
    return this.productsImportService.confirm(dto);
  }

  @Post('serials/analyze')
  @UseInterceptors(FileInterceptor('file', UPLOAD_LIMITS))
  async analyzeSerials(@UploadedFile() file: Express.Multer.File | undefined) {
    return this.serialsImportService.analyze(file);
  }

  @Post('serials/confirm')
  async confirmSerials(@Body() dto: ConfirmSerialsImportDto, @CurrentUser('sub') userId: string) {
    return this.serialsImportService.confirm(dto, userId);
  }
}
