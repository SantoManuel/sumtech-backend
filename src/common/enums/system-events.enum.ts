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
 * - INVOICE_GENERATED: 'invoice.generated' (Disparado cuando el motor de facturación
 *   recurrente crea una factura PENDING_PAYMENT para un contrato activo).
 * - PAYMENT_REMINDER_DUE: 'payment.reminder_due' (Disparado por el motor de
 *   morosidad para recordatorios preventivos o de factura vencida).
 * - CONTRACT_SUSPENDED: 'contract.suspended' (Disparado cuando el motor de
 *   morosidad suspende un contrato por facturas vencidas fuera del período de gracia).
 * - CONTRACT_REACTIVATED: 'contract.reactivated' (Disparado cuando un contrato
 *   suspendido vuelve a ACTIVE tras liquidarse sus facturas vencidas).
 * - CONTRACT_TERMINATED: 'contract.terminated' (Disparado cuando un contrato se
 *   termina definitivamente, vía ClientsService.terminateContract).
 * - CONTRACT_CREATED: 'contract.created' (Disparado al firmar un contrato nuevo
 *   vía ClientsService.addContract — dispara la orden de instalación automática).
 */
export enum SystemEvents {
  SALE_CONFIRMED = 'sale.confirmed',
  TICKET_CREATED = 'ticket.created',
  TICKET_RESOLVED = 'ticket.resolved',
  STOCK_LOW_ALERT = 'stock.low_alert',
  SERVICE_ACTIVATED = 'service.activated',
  INVOICE_GENERATED = 'invoice.generated',
  PAYMENT_REMINDER_DUE = 'payment.reminder_due',
  CONTRACT_SUSPENDED = 'contract.suspended',
  CONTRACT_REACTIVATED = 'contract.reactivated',
  CONTRACT_TERMINATED = 'contract.terminated',
  CONTRACT_CREATED = 'contract.created',
}
