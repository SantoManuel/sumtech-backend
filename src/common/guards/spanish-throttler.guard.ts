import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException, ThrottlerLimitDetail } from '@nestjs/throttler';

/**
 * `ThrottlerGuard` por defecto lanza el mensaje en inglés ("ThrottlerException:
 * Too Many Requests"). El resto de la API responde siempre en español, así
 * que se sobreescribe el mensaje para mantener consistencia con el resto de
 * las respuestas de error que ve el usuario final del widget de chat público.
 *
 * Fuera de producción se omite el límite por completo (mismo criterio ya
 * usado en `Chatbot_sumtech` para su playground): en desarrollo, todo el
 * tráfico —el del propio desarrollador probando y el de cualquier otra
 * sesión local— sale de la misma IP, así que un límite pensado para frenar
 * abuso real en producción se agota casi de inmediato con uso normal y
 * legítimo, sin que haya ningún atacante de por medio.
 */
@Injectable()
export class SpanishThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.NODE_ENV !== 'production') {
      return true;
    }
    return super.canActivate(context);
  }

  protected async throwThrottlingException(
    _context: ExecutionContext,
    _throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new ThrottlerException('Demasiadas solicitudes. Por favor intenta de nuevo en unos minutos.');
  }
}
