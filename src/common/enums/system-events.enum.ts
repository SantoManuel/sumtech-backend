/**
 * ARCHIVO: src/common/enums/system-events.enum.ts
 * CAPA: Nombres de Eventos de Dominio (Common Enums)
 * 
 * RESPONSABILIDAD:
 * - Centraliza los nombres de eventos emitidos a través de EventEmitter2 para evitar strings mágicos y asegurar consistencia en la arquitectura orientada a eventos.
 * 
 * VALORES:
 * - SALE_CONFIRMED: 'sale.confirmed' (Disparado tras cobro exitoso y timbrado fiscal).
 * - TICKET_CREATED: 'ticket.created' (Disparado al abrirse una avería o instalación).
 * - TICKET_RESOLVED: 'ticket.resolved' (Disparado cuando el técnico finaliza la labor).
 * - STOCK_LOW_ALERT: 'stock.low_alert' (Disparado cuando un producto cae por debajo del stock mínimo).
 * - SERVICE_ACTIVATED: 'service.activated' (Disparado para iniciar el ciclo recurrente).
 */
export enum SystemEvents {
  SALE_CONFIRMED = 'sale.confirmed',
  TICKET_CREATED = 'ticket.created',
  TICKET_RESOLVED = 'ticket.resolved',
  STOCK_LOW_ALERT = 'stock.low_alert',
  SERVICE_ACTIVATED = 'service.activated',
}
