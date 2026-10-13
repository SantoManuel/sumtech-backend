import { Injectable } from '@nestjs/common';
import { PlanEntity } from '../plans/entities/plan.entity';
import { ServiceFeeEntity } from '../plans/entities/service-fee.entity';

export type TaxableItemType =
  | 'PLAN_SUBSCRIPTION'
  | 'PLAN_ACTIVATION'
  | 'PRODUCT_HARDWARE'
  | 'INSTALLATION_FEE'
  | 'REPAIR_FEE'
  | 'RECONNECTION_FEE';

export interface TaxCalculationInput {
  itemType: TaxableItemType;
  subtotal: number;
  // Presente cuando el ítem está ligado a un plan/contrato (PLAN_SUBSCRIPTION,
  // PLAN_ACTIVATION, y RECONNECTION_FEE vía el plan del contrato reconectado).
  plan?: Pick<PlanEntity, 'itbisRate' | 'cdtRate' | 'iscRate'> | null;
  // Presente para INSTALLATION_FEE / REPAIR_FEE (catálogo de Cargos de Servicio).
  serviceFee?: Pick<ServiceFeeEntity, 'itbisRate' | 'cdtRate' | 'iscRate'> | null;
  // Override manual (ej. cliente/documento con exención de ITBIS vigente).
  isExempt?: boolean;
}

export interface TaxCalculationResult {
  itbisAmount: number;
  cdtAmount: number;
  iscAmount: number;
}

/**
 * Única fuente de verdad para ITBIS/CDT/ISC — usada tanto por BillingCycleService
 * (facturación recurrente) como por PosService (ventas ad-hoc de mostrador), para
 * que un mismo tipo de ítem nunca termine gravado distinto según por dónde se cobre.
 * Ver Plan_Implementacion_CDT_ISC_Impuestos.md (sección 3) para las reglas de negocio
 * acordadas con el usuario.
 */
@Injectable()
export class TaxCalculationService {
  private static readonly DEFAULT_ITBIS_RATE = 0.18;

  calculateTaxes(input: TaxCalculationInput): TaxCalculationResult {
    const subtotal = Number(input.subtotal) || 0;

    if (input.isExempt) {
      return { itbisAmount: 0, cdtAmount: 0, iscAmount: 0 };
    }

    switch (input.itemType) {
      // Mercancía física: solo ITBIS. El CDT/ISC de telecomunicaciones
      // (Ley 153-98 / Ley 253-12) no aplica a la venta de un bien, solo a
      // servicios de telecomunicaciones facturados.
      case 'PRODUCT_HARDWARE':
        return this.round({
          itbisAmount: subtotal * TaxCalculationService.DEFAULT_ITBIS_RATE,
          cdtAmount: 0,
          iscAmount: 0,
        });

      // Mensualidad del servicio y su activación: heredan las tasas del plan
      // contratado tal cual (ITBIS/CDT/ISC), igual que la facturación recurrente.
      case 'PLAN_SUBSCRIPTION':
      case 'PLAN_ACTIVATION':
      case 'RECONNECTION_FEE': {
        const plan = input.plan;
        return this.round({
          itbisAmount: subtotal * this.rateOrDefault(plan?.itbisRate),
          cdtAmount: subtotal * Number(plan?.cdtRate || 0),
          iscAmount: subtotal * Number(plan?.iscRate || 0),
        });
      }

      // Cargos de servicio puntuales: tasas configurables por cada tipo de
      // cargo en /dashboard/planes → Cargos de Servicio (default 0 para CDT/ISC
      // hasta que un ADMIN decida activarlos para ese cargo en particular).
      case 'INSTALLATION_FEE':
      case 'REPAIR_FEE': {
        const fee = input.serviceFee;
        return this.round({
          itbisAmount: subtotal * this.rateOrDefault(fee?.itbisRate),
          cdtAmount: subtotal * Number(fee?.cdtRate || 0),
          iscAmount: subtotal * Number(fee?.iscRate || 0),
        });
      }

      default:
        return this.round({ itbisAmount: subtotal * TaxCalculationService.DEFAULT_ITBIS_RATE, cdtAmount: 0, iscAmount: 0 });
    }
  }

  private rateOrDefault(rate: number | undefined | null): number {
    return rate !== undefined && rate !== null ? Number(rate) : TaxCalculationService.DEFAULT_ITBIS_RATE;
  }

  private round(result: TaxCalculationResult): TaxCalculationResult {
    return {
      itbisAmount: Number(result.itbisAmount.toFixed(2)),
      cdtAmount: Number(result.cdtAmount.toFixed(2)),
      iscAmount: Number(result.iscAmount.toFixed(2)),
    };
  }
}
