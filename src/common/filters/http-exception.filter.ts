/**
 * ARCHIVO: src/common/filters/http-exception.filter.ts
 * CAPA: Filtros de Excepciones Globales (Common)
 * 
 * RESPONSABILIDAD:
 * - Captura de forma centralizada todas las excepciones HTTP (HttpException, BadRequestException, UnauthorizedException, etc.) y errores no controlados.
 * - Extrae mensajes legibles y detalles de validación de class-validator.
 * - Retorna un payload JSON estandarizado para errores:
 *   {
 *     "statusCode": number,
 *     "success": false,
 *     "error": string,
 *     "message": string | string[],
 *     "timestamp": string,
 *     "path": string
 *   }
 * 
 * MÉTODOS:
 * - catch(exception: HttpException | Error, host: ArgumentsHost): void
 */
export {};
