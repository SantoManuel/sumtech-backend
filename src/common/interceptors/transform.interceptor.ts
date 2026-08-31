/**
 * ARCHIVO: src/common/interceptors/transform.interceptor.ts
 * CAPA: Interceptores Globales (Common)
 * 
 * RESPONSABILIDAD:
 * - Estandariza la estructura de todas las respuestas JSON exitosas generadas por cualquier controlador de la API.
 * - Envuelve la carga útil devuelta en un formato homogéneo:
 *   {
 *     "statusCode": number,
 *     "success": true,
 *     "data": T,
 *     "message": string,
 *     "timestamp": string
 *   }
 * 
 * MÉTODOS:
 * - intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>>
 */
export {};
