import { IsIn, IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { SignatureMethod, SignatureParty } from '../entities/contract-signature.entity';

const SIGNATURE_PARTIES: SignatureParty[] = ['CLIENT', 'COMPANY'];
const SIGNATURE_METHODS: SignatureMethod[] = ['DRAW', 'TYPE', 'UPLOAD'];

// Tope de la CADENA base64 (no del binario ya decodificado). ~4/3 del límite
// real de 3MB en bytes que valida ContractSignaturesService tras decodificar
// — con margen para un eventual prefijo "data:image/png;base64,". Rechazar
// acá antes de decodificar evita construir un Buffer gigante innecesariamente
// con un payload que de todas formas se va a rechazar.
const MAX_BASE64_LENGTH = 4_500_000;

export class CreateContractSignatureDto {
  @IsIn(SIGNATURE_PARTIES, { message: 'party debe ser "CLIENT" o "COMPANY"' })
  party: SignatureParty;

  @IsNotEmpty({ message: 'La imagen de la firma es obligatoria.' })
  @IsString()
  @MaxLength(MAX_BASE64_LENGTH, { message: 'La imagen de la firma excede el tamaño máximo permitido.' })
  signatureImageBase64: string;

  @IsString()
  @Length(2, 150, { message: 'El nombre de quien firma debe tener entre 2 y 150 caracteres.' })
  signedByName: string;

  @IsIn(SIGNATURE_METHODS, { message: 'method debe ser "DRAW", "TYPE" o "UPLOAD"' })
  method: SignatureMethod;

  // Solo aplica cuando quien firma es un técnico en calle — se validan juntas
  // en el servicio (ambas presentes o ambas ausentes, ver assertGpsPairComplete).
  @IsOptional()
  @IsLatitude({ message: 'La latitud GPS no es válida.' })
  latitude?: number;

  @IsOptional()
  @IsLongitude({ message: 'La longitud GPS no es válida.' })
  longitude?: number;
}
