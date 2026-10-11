import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Mismo tope conceptual que EXPORT_MAX_ROWS de Clientes, pero mucho más bajo:
 * la cardinalidad real de routers MikroTik de un ISP es órdenes de magnitud
 * menor que la de clientes. */
export const NETWORK_NODES_EXPORT_MAX_ROWS = 5000;

export class ExportNetworkNodesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La cantidad de routers a exportar debe ser un número entero' })
  @Min(1, { message: 'Debe exportar al menos 1 router' })
  @Max(NETWORK_NODES_EXPORT_MAX_ROWS, {
    message: `La cantidad de routers a exportar no puede superar ${NETWORK_NODES_EXPORT_MAX_ROWS}`,
  })
  limit?: number = NETWORK_NODES_EXPORT_MAX_ROWS;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  connectionMethod?: string;
}
