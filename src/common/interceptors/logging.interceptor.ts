/**
 * ARCHIVO: src/common/interceptors/logging.interceptor.ts
 * CAPA: Interceptores Globales (Common)
 * 
 * RESPONSABILIDAD:
 * - Registra cada solicitud HTTP entrante (Método, URL, IP de origen, Agente de usuario).
 * - Calcula el tiempo total de procesamiento en milisegundos una vez resuelta la petición.
 * - Emite logs formateados utilizando el Logger nativo de NestJS para auditoría y observabilidad del sistema.
 * 
 * MÉTODOS:
 * - intercept(context: ExecutionContext, next: CallHandler): Observable<any>
 */
export {};
