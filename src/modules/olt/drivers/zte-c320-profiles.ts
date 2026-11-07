import { Logger } from '@nestjs/common';
import { TcontProfile, TrafficProfile, OnuTypeProfile, DiscoveredTcontProfile, DiscoveredTrafficProfile } from '../ports/olt-driver.port';
import { ZteSessionLike } from './zte-telnet-session';
import { isOltErrorResponse, parseTcontProfilesFromOutput, parseTrafficProfilesFromOutput } from './zte-c320-parsers';


export async function findTcontProfileByNameWithSession(session: ZteSessionLike, name: string): Promise<TcontProfile | null> {
  const output = await session.executeCommand('show gpon profile tcont');
  const found = parseTcontProfilesFromOutput(output).find((p) => p.name === name);
  return found ? { name: found.name, fixedKbps: found.speedKbps } : null;
}


export async function ensureTcontProfileWithSession(session: ZteSessionLike, profile: TcontProfile): Promise<void> {
  const output = await session.executeCommand('show gpon profile tcont');
  const existing = parseTcontProfilesFromOutput(output).find((p) => p.name === profile.name);
  if (existing) {
    return;
  }
  await session.executeCommand('configure terminal');
  await session.executeCommand('gpon');
  const createOutput = await session.executeCommand(
    `profile tcont ${profile.name} type 5 fixed 64 assured 64 maximum ${profile.fixedKbps}`,
  );
  if (isOltErrorResponse(createOutput)) {
    throw new Error(`La OLT rechazó el perfil TCONT "${profile.name}": ${createOutput.trim()}`);
  }
  await session.executeCommand('exit');
  await session.executeCommand('exit');
  await session.executeCommand('write');
}

export async function ensureTrafficProfileWithSession(session: ZteSessionLike, profile: TrafficProfile): Promise<void> {
  // "show gpon profile traffic" -- mismo comando corregido que getTrafficProfiles
  // (bug real confirmado 2026-11-07, ver zte-c320-parsers.ts); antes se usaba
  // "show traffic-profile" junto al mismo parser ya reescrito para el formato
  // real, lo que haría que esta verificación de existencia SIEMPRE fallara en
  // silencio y reintentara crear perfiles que ya existen.
  const listOutput = await session.executeCommand('show gpon profile traffic');
  const existing = parseTrafficProfilesFromOutput(listOutput).find((p) => p.name === profile.name);
  if (existing) {
    return;
  }

  await session.executeCommand('configure terminal');
  const createOutput = await session.executeCommand(
    `traffic-profile ${profile.name} ip cir ${profile.downKbps} cbs 1000 pir ${profile.downKbps} pbs 1000`,
  );
  if (isOltErrorResponse(createOutput)) {
    // Salir de "(config)#" antes de lanzar
    try {
      await session.executeCommand('exit');
    } catch {
      /* best-effort */
    }
    throw new Error(`La OLT rechazó el traffic-profile "${profile.name}": ${createOutput.trim()}`);
  }
  await session.executeCommand('exit');
  await session.executeCommand('write');
}

export async function verifyOnuTypeProfileWithSession(session: ZteSessionLike, onuTypeName: string, logger: Logger): Promise<void> {
  const checkOutput = await session.executeCommand(`show onu-type gpon ${onuTypeName}`);
  const alreadyExists = !isOltErrorResponse(checkOutput) && checkOutput.includes(onuTypeName);
  if (!alreadyExists) {
    throw new Error(
      `El onu-type "${onuTypeName}" no existe en esta OLT. Créalo primero desde el catálogo de Tipos de ONU ` +
      `("Sincronizar con la OLT") antes de autorizar esta ONU -- Sumtech ya no lo crea automáticamente a ciegas.`,
    );
  }

  const maxVeipMatch = checkOutput.match(/Max VEIP:\s*(\d+)/i);
  const maxVeip = maxVeipMatch ? parseInt(maxVeipMatch[1], 10) : undefined;
  const maxIphostMatch = checkOutput.match(/Max\s*IP\s*-?\s*Host:\s*(\d+)/i);
  const maxIphost = maxIphostMatch ? parseInt(maxIphostMatch[1], 10) : undefined;

  const needsVeipFix = maxVeip !== undefined && maxVeip < 1;
  const needsIphostFix = maxIphost !== undefined && maxIphost < 2;
  if (!needsVeipFix && !needsIphostFix) {
    return;
  }

  let fixSucceeded = false;
  try {
    await session.executeCommand('configure terminal');
    await session.executeCommand('pon');
    if (needsVeipFix) {
      const fixOutput = await session.executeCommand(`onu-type ${onuTypeName} gpon max-veip 1`);
      if (isOltErrorResponse(fixOutput)) {
        logger.warn(
          `[diag] verifyOnuTypeProfileWithSession: no se pudo corregir "max-veip" del onu-type "${onuTypeName}" (mejor esfuerzo, no bloquea la autorización): ${fixOutput.trim()}`,
        );
      } else {
        fixSucceeded = true;
      }
    }
    if (needsIphostFix) {
      const fixOutput = await session.executeCommand(`onu-type ${onuTypeName} gpon max-iphost 2`);
      if (isOltErrorResponse(fixOutput)) {
        logger.warn(
          `[diag] verifyOnuTypeProfileWithSession: no se pudo corregir "max-iphost" del onu-type "${onuTypeName}" (mejor esfuerzo, no bloquea la autorización): ${fixOutput.trim()}`,
        );
      } else {
        fixSucceeded = true;
      }
    }
  } catch (err: any) {
    logger.warn(
      `[diag] verifyOnuTypeProfileWithSession: excepción corrigiendo "max-veip"/"max-iphost" del onu-type "${onuTypeName}" (mejor esfuerzo, no bloquea la autorización): ${err.message}`,
    );
  } finally {
    try {
      await session.executeCommand('exit');
    } catch {
      /* best-effort */
    }
    try {
      await session.executeCommand('exit');
    } catch {
      /* best-effort */
    }
  }
  if (fixSucceeded) {
    try {
      await session.executeCommand('write');
    } catch (err: any) {
      logger.warn(
        `[diag] verifyOnuTypeProfileWithSession: no se pudo guardar "write" tras corregir max-veip/max-iphost (mejor esfuerzo): ${err.message}`,
      );
    }
  }
}


export async function ensureOnuTypeProfileWithSession(session: ZteSessionLike, profile: OnuTypeProfile, logger: Logger): Promise<void> {
  const checkOutput = await session.executeCommand(`show onu-type gpon ${profile.name}`);
  const alreadyExists = !isOltErrorResponse(checkOutput) && checkOutput.includes(profile.name);
  if (alreadyExists) {
    const maxVeipMatch = checkOutput.match(/Max VEIP:\s*(\d+)/i);
    const maxVeip = maxVeipMatch ? parseInt(maxVeipMatch[1], 10) : undefined;
    const maxIphostMatch = checkOutput.match(/Max\s*IP\s*-?\s*Host:\s*(\d+)/i);
    const maxIphost = maxIphostMatch ? parseInt(maxIphostMatch[1], 10) : undefined;
    const needsVeipFix = maxVeip !== undefined && maxVeip < 1;
    const needsIphostFix = maxIphost !== undefined && maxIphost < 2;
    if (needsVeipFix || needsIphostFix) {
      let fixSucceeded = false;
      try {
        await session.executeCommand('configure terminal');
        await session.executeCommand('pon');
        if (needsVeipFix) {
          const fixOutput = await session.executeCommand(`onu-type ${profile.name} gpon max-veip 1`);
          if (isOltErrorResponse(fixOutput)) {
            logger.warn(
              `[diag] ensureOnuTypeProfileWithSession: no se pudo corregir "max-veip" del onu-type "${profile.name}" (mejor esfuerzo, no bloquea la autorización): ${fixOutput.trim()}`,
            );
          } else {
            fixSucceeded = true;
          }
        }
        if (needsIphostFix) {
          const fixOutput = await session.executeCommand(`onu-type ${profile.name} gpon max-iphost 2`);
          if (isOltErrorResponse(fixOutput)) {
            logger.warn(
              `[diag] ensureOnuTypeProfileWithSession: no se pudo corregir "max-iphost" del onu-type "${profile.name}" (mejor esfuerzo, no bloquea la autorización): ${fixOutput.trim()}`,
            );
          } else {
            fixSucceeded = true;
          }
        }
      } catch (err: any) {
        logger.warn(
          `[diag] ensureOnuTypeProfileWithSession: excepción corrigiendo "max-veip"/"max-iphost" del onu-type "${profile.name}" (mejor esfuerzo, no bloquea la autorización): ${err.message}`,
        );
      } finally {
        try {
          await session.executeCommand('exit');
        } catch {
          /* best-effort */
        }
        try {
          await session.executeCommand('exit');
        } catch {
          /* best-effort */
        }
      }
      if (fixSucceeded) {
        try {
          await session.executeCommand('write');
        } catch (err: any) {
          logger.warn(
            `[diag] ensureOnuTypeProfileWithSession: no se pudo guardar "write" tras corregir max-veip/max-iphost (mejor esfuerzo): ${err.message}`,
          );
        }
      }
    }
    return;
  }

  await session.executeCommand('configure terminal');
  await session.executeCommand('pon');
  const description = `${profile.ethPorts ?? 0}ETH,${profile.potsPorts ?? 0}POTS`;

  const createOutput = await session.executeCommand(
    `onu-type ${profile.name} gpon description ${description} max-tcont 8 max-gemport 32 max-switch-perslot 8 max-flow-perswitch 8 max-veip 1 max-iphost 2`,
  );
  if (isOltErrorResponse(createOutput)) {
    await session.executeCommand('exit');
    await session.executeCommand('exit');
    throw new Error(`La OLT rechazó el onu-type "${profile.name}": ${createOutput.trim()}`);
  }

  if (profile.ethPorts && profile.ethPorts > 0) {
    const ethOutput = await session.executeCommand(`onu-type-if ${profile.name} eth_0/1-${profile.ethPorts}`);
    if (isOltErrorResponse(ethOutput)) {
      await session.executeCommand('exit');
      await session.executeCommand('exit');
      throw new Error(`La OLT rechazó los puertos ETH del onu-type "${profile.name}": ${ethOutput.trim()}`);
    }
  }
  if (profile.potsPorts && profile.potsPorts > 0) {
    const potsOutput = await session.executeCommand(`onu-type-if ${profile.name} pots_0/1-${profile.potsPorts}`);
    if (isOltErrorResponse(potsOutput)) {
      await session.executeCommand('exit');
      await session.executeCommand('exit');
      throw new Error(`La OLT rechazó los puertos POTS del onu-type "${profile.name}": ${potsOutput.trim()}`);
    }
  }

  await session.executeCommand('exit');
  await session.executeCommand('exit');
  await session.executeCommand('write');
}
