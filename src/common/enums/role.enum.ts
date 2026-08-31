/**
 * ARCHIVO: src/common/enums/role.enum.ts
 * CAPA: Enumeraciones de Dominio (Common Enums)
 * 
 * RESPONSABILIDAD:
 * - Define los roles canónicos para el control de acceso basado en roles (RBAC) en todo el ERP Sumtech.
 * 
 * VALORES:
 * - ADMIN: Acceso total al sistema, auditoría, configuración y gestión de usuarios.
 * - GERENTE: Visualización de métricas financieras, reportes, planes y aprobación de cierres.
 * - CAJERO: Operaciones en Punto de Venta (POS), cobros, facturación e impresión de tickets.
 * - TECNICO: Gestión de tickets asignados, instalaciones, cambio de seriales/MAC y resolución de averías.
 * - AGENTE_CRM: Gestión de leads, atención a llamadas de clientes, registro de interacciones.
 * - CLIENTE: Portal de autoservicio para consulta de servicios, pagos, tickets y cambio de plan.
 */
export enum Role {
  ADMIN = 'ADMIN',
  GERENTE = 'GERENTE',
  CAJERO = 'CAJERO',
  TECNICO = 'TECNICO',
  AGENTE_CRM = 'AGENTE_CRM',
  CLIENTE = 'CLIENTE',
}

